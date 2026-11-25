// Multi-connection download of one HTTP stream, like IDM does it.
//
// The file is split into segments and each segment is fetched over its own
// connection with Range requests. When a connection finishes its segment it
// takes half of the largest segment still running, so every connection stays
// busy until the end. Segment offsets live on the stream object, which the
// manager saves to disk, so a paused or interrupted download picks up where it
// stopped.
const fs = require("fs");
const { fetch: boundFetch } = require("undici");
const { agentFor } = require("./routes");

const CHUNK = 10 * 1024 * 1024; // YouTube slows down single requests bigger than about 10 MB.
const MIN_SPLIT = 1024 * 1024; // do not split segments that have less than 1 MB left per half.
const MAX_RETRIES = 8;
const DEAD_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EADDRNOTAVAIL",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function errorCode(err) {
  return err?.cause?.code || err?.code || err?.cause?.errors?.[0]?.code || "";
}

class AbortError extends Error {
  constructor() {
    super("Paused");
    this.name = "AbortError";
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const onAbort = () => {
    clearTimeout(t);
    reject(new AbortError());
  };
  const t = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

function split(size, n) {
  n = Math.max(1, Math.min(n, Math.ceil(size / MIN_SPLIT)));
  const part = Math.floor(size / n);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const start = i * part;
    const end = i === n - 1 ? size - 1 : start + part - 1;
    segs.push({ start, end, pos: start });
  }
  return segs;
}

function headersFor(st, range) {
  const h = { ...st.headers };
  delete h["Accept-Encoding"];
  if (range) h.Range = range;
  return h;
}

// Reads "attachment; filename*=UTF-8''name.zip" or 'filename="name.zip"'.
function dispositionName(header) {
  if (!header) return "";
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {}
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  return plain ? (plain[2] ?? plain[1]).trim() : "";
}

async function probe(st, signal) {
  const res = await fetch(st.url, { headers: headersFor(st, "bytes=0-0"), signal });
  try {
    const meta = {
      filename: dispositionName(res.headers.get("content-disposition")),
      type: (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
      finalUrl: res.url,
    };
    if (res.status === 206) {
      const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") || "");
      if (m) return { ...meta, size: Number(m[1]), ranges: true };
    }
    if (res.status === 200) return { ...meta, size: Number(res.headers.get("content-length") || 0), ranges: false };
    const err = new Error(`The server answered ${res.status}`);
    err.status = res.status;
    throw err;
  } finally {
    res.body?.cancel().catch(() => {});
  }
}

/**
 * Downloads `st` (a stream record) into st.path.
 * A stream with an offset holds only st.size bytes of the remote file, from st.offset on,
 * such as a few files out of a ZIP archive. It must come with its size and ranges set.
 * opts: connections, signal, onBytes(n), refresh() -> Promise that updates st.url/headers.
 */
async function downloadStream(st, opts) {
  const { signal } = opts;
  let refreshing = null;
  const refresh = () => (refreshing ??= opts.refresh().finally(() => setTimeout(() => (refreshing = null), 5000)));

  if (!st.size || st.ranges === undefined) {
    let info;
    try {
      info = await probe(st, signal);
    } catch (e) {
      if (signal.aborted) throw new AbortError();
      if (e.status === 403 || e.status === 410) {
        await refresh();
        info = await probe(st, signal);
      } else throw e;
    }
    st.ranges = info.ranges;
    if (info.size) st.size = info.size;
  }

  if (!st.ranges || !st.size) return single(st, opts);

  if (st.partial) {
    st.segments = null; // left over from a single-connection try
    delete st.partial;
  }
  const useRoutes = (opts.routes?.length || 0) >= 2;
  if (!st.segments || !st.segments.length) st.segments = split(st.size, opts.connections * (useRoutes ? opts.routes.length : 1));
  for (const s of st.segments) s.busy = false;

  const exists = fs.existsSync(st.path);
  const fh = await fs.promises.open(st.path, exists ? "r+" : "w+");
  try {
    const stat = await fh.stat();
    if (stat.size !== st.size) await fh.truncate(st.size);
    await runWorkers(st, fh, { ...opts, refresh });
  } finally {
    await fh.close();
  }
}

function runWorkers(st, fh, opts) {
  const { signal, onBytes, refresh, refreshRoute, routes } = opts;
  const connections = () => Math.max(1, opts.connections);
  const pool = routes?.length >= 2
    ? routes.map((route) => ({ route, running: 0, dead: false, refreshed: false, refreshing: null, agent: route.primary ? null : agentFor(route.address) }))
    : null;
  const local = new AbortController();
  const onAbort = () => local.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  return new Promise((resolve, reject) => {
    let running = 0;
    let failure = null;
    let lastRouteError = null;

    const steal = () => {
      let best = null;
      for (const s of st.segments) {
        const left = s.end - s.pos + 1;
        if (s.busy && left >= MIN_SPLIT * 2 && (!best || left > best.end - best.pos + 1)) best = s;
      }
      if (!best) return null;
      const mid = best.pos + Math.floor((best.end - best.pos + 1) / 2);
      const seg = { start: mid, end: best.end, pos: mid, busy: false };
      best.end = mid - 1;
      st.segments.splice(st.segments.indexOf(best) + 1, 0, seg);
      return seg;
    };

    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (signal.aborted) reject(new AbortError());
      else resolve();
    };

    const pickSlot = () => {
      let best = null;
      for (const s of pool) {
        if (!s.dead && s.running < connections() && (!best || s.running < best.running)) best = s;
      }
      return best;
    };

    const launch = () => {
      if (failure || signal.aborted) {
        if (!running) finish();
        return;
      }
      while (pool ? true : running < connections()) {
        const slot = pool ? pickSlot() : null;
        if (pool && !slot) break;
        const seg = st.segments.find((s) => !s.busy && s.pos <= s.end) || steal();
        if (!seg) break;
        seg.busy = true;
        running++;
        if (slot) slot.running++;
        worker(seg, slot).then(
          () => {},
          (err) => {
            if (!(err instanceof AbortError) && !signal.aborted && !failure) {
              failure = err;
              local.abort();
            }
          },
        ).finally(() => {
          seg.busy = false;
          running--;
          if (slot) slot.running--;
          launch();
        });
      }
      if (!running && pool && !failure && !signal.aborted && pool.every((s) => s.dead) && st.segments.some((s) => s.pos <= s.end)) {
        failure = lastRouteError || new Error("No live network routes");
      }
      if (!running) finish();
    };

    const worker = async (seg, slot) => {
      const route = slot?.route;
      const primary = !route || route.primary;
      const die = (err) => {
        if (err) lastRouteError = err;
        slot.dead = true;
      };
      let attempts = 0;
      while (seg.pos <= seg.end) {
        if (local.signal.aborted) throw new AbortError();
        if (slot?.dead) return;
        const to = Math.min(seg.end, seg.pos + CHUNK - 1);
        const at = st.offset || 0;
        const link = primary ? st : (st.links?.[route.address] || st);
        const init = {
          headers: headersFor(link, `bytes=${at + seg.pos}-${at + to}`),
          signal: local.signal,
          ...(slot?.agent ? { dispatcher: slot.agent } : {}),
        };
        try {
          const res = await (slot?.agent ? boundFetch : fetch)(link.url, init);
          if (res.status === 403 || res.status === 410) {
            res.body?.cancel().catch(() => {});
            if (!primary) {
              if (refreshRoute && !slot.refreshed) {
                if (!slot.refreshing) {
                  slot.refreshing = Promise.resolve(refreshRoute(route)).finally(() => {
                    slot.refreshed = true;
                    slot.refreshing = null;
                  });
                }
                try {
                  await slot.refreshing;
                } catch (e) {
                  if (local.signal.aborted) throw new AbortError();
                  return die(e);
                }
                continue;
              }
              return die(new Error(`The server answered ${res.status}`));
            }
            if (++attempts > 3) throw Object.assign(new Error("YouTube refused the download link. Try again later."), { retry: false });
            await refresh();
            continue;
          }
          if (res.status !== 206) {
            res.body?.cancel().catch(() => {});
            throw Object.assign(new Error(`The server answered ${res.status}`), { retry: res.status >= 500 || res.status === 429 });
          }
          const before = seg.pos;
          for await (const chunk of res.body) {
            const room = seg.end - seg.pos + 1; // another connection may have taken the tail
            if (room <= 0) break;
            let buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (buf.length > room) buf = buf.subarray(0, room);
            await fh.write(buf, 0, buf.length, seg.pos);
            seg.pos += buf.length;
            onBytes(buf.length);
          }
          if (seg.pos === before && seg.pos <= seg.end) throw new Error("The server sent no data");
          attempts = 0;
        } catch (e) {
          if (local.signal.aborted || e.name === "AbortError") throw new AbortError();
          if (!primary) {
            if (DEAD_CODES.has(errorCode(e)) || e.retry === false || ++attempts > MAX_RETRIES) return die(e);
          } else {
            if (e.retry === false) throw e;
            if (++attempts > MAX_RETRIES) throw e;
          }
          await sleep(Math.min(500 * 2 ** attempts, 15000), local.signal);
        }
      }
    };

    launch();
  });
}

// For servers without Range support: one connection, restarts from zero.
// st.partial stays set until the body has ended, so a stopped download is
// never taken for a finished one.
async function single(st, { signal, onBytes }) {
  st.partial = true;
  st.segments = [{ start: 0, end: st.size ? st.size - 1 : Number.MAX_SAFE_INTEGER, pos: 0 }];
  // Without a Range header fetch asks for gzip and unpacks it, which changes the file.
  const res = await fetch(st.url, { headers: { ...headersFor(st), "Accept-Encoding": "identity" }, signal });
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`The server answered ${res.status}`);
  }
  const out = fs.createWriteStream(st.path);
  let writeError = null;
  const failed = new Promise((_, reject) => out.once("error", (e) => reject((writeError = e))));
  failed.catch(() => {});
  try {
    for await (const chunk of res.body) {
      if (writeError) throw writeError;
      if (!out.write(Buffer.from(chunk))) await Promise.race([new Promise((r) => out.once("drain", r)), failed]);
      st.segments[0].pos += chunk.byteLength;
      onBytes(chunk.byteLength);
    }
  } catch (e) {
    if (writeError) throw writeError;
    if (signal.aborted) throw new AbortError();
    throw e;
  } finally {
    if (!out.destroyed) await new Promise((r) => out.end(r));
  }
  if (writeError) throw writeError;
  st.size = st.segments[0].pos;
  st.segments[0].end = st.size - 1;
  delete st.partial;
}

function streamDone(st) {
  return !st.partial && !!st.segments?.length && st.segments.every((s) => s.pos > s.end);
}

function streamBytes(st) {
  if (!st.segments) return 0;
  return st.segments.reduce((n, s) => n + Math.max(0, Math.min(s.pos, s.end + 1) - s.start), 0);
}

module.exports = { downloadStream, streamDone, streamBytes, probe, AbortError };
