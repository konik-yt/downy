// Downloading part of a video.
//
// A clip is { start, end } in whole seconds. YouTube serves its mp4 and m4a streams as DASH
// files that begin with ftyp, moov and sidx. The sidx lists the byte size and duration of
// every fragment, so the fragments that cover a clip can be fetched with Range requests.
// Those bytes, behind the init bytes (everything before the first fragment), play as a file.
const { AbortError } = require("./segmented");

const HEAD = 64 * 1024; // the index sits in the first few KB, so one small read usually holds it
const MAX_HEAD = 4 * 1024 * 1024; // give up looking for the index past this

// ---------------------------------------------------------------- the range

function timecode(s) {
  const h = Math.floor(s / 3600);
  const rest = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0") + ":" + String(s % 60).padStart(2, "0");
  return h ? `${h}:${rest}` : rest;
}

// The one place that accepts a range from outside. Returns { start, end }, or null when the
// range is the whole video, and throws an Error the user can read when it is not usable.
// duration is in seconds and 0 when the site did not say.
function parseClip(raw, duration = 0) {
  if (raw == null) return null;
  if (typeof raw !== "object" || !Number.isFinite(raw.start) || !Number.isFinite(raw.end)) {
    throw new Error("Enter the start and the end as times, like 1:15");
  }
  const clip = { start: Math.round(raw.start), end: Math.round(raw.end) };
  if (clip.start < 0) throw new Error("The start can't be before 0:00");
  if (clip.end <= clip.start) throw new Error("The end must come after the start");
  if (duration > 0 && clip.end > Math.ceil(duration)) throw new Error(`The end is past the end of the video, ${timecode(Math.round(duration))}`);
  if (!Number.isSafeInteger(clip.end)) throw new Error("That time is too long");
  if (clip.start === 0 && duration > 0 && clip.end >= Math.floor(duration)) return null;
  return clip;
}

// "1m00s-2m30s", or "1h02m05s-1h10m00s" past an hour. Safe in a Windows file name.
function label(clip) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h${pad(m)}m${pad(s % 60)}s` : `${m}m${pad(s % 60)}s`;
  };
  return `${stamp(clip.start)}-${stamp(clip.end)}`;
}

// The size of a clip, as a share of the size of the whole stream.
function estimate(size, clip, duration) {
  if (!clip) return size;
  return size && duration > 0 ? Math.round((size * (clip.end - clip.start)) / duration) : 0;
}

// ---------------------------------------------------------------- the index

// The top level boxes at the start of an mp4, up to the first fragment. A box is
// { type, at, size, head } and the last one may run past the end of the buffer.
function topBoxes(buf) {
  const boxes = [];
  let at = 0;
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > buf.length) break;
      head = 16;
      const big = buf.readBigUInt64BE(at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { boxes, stopped: true };
      size = Number(big);
    }
    const type = buf.toString("latin1", at + 4, at + 8);
    if (size < head) return { boxes, stopped: true }; // not an mp4, or a box that runs to the end of the file
    if (type === "moof" || type === "mdat") return { boxes, stopped: true };
    boxes.push({ type, at, size, head });
    at += size;
  }
  return { boxes, stopped: false };
}

function readSidx(buf, box) {
  const end = box.at + box.size;
  let p = box.at + box.head;
  if (p + 12 > end) return null;
  const version = buf[p];
  p += 8; // version, flags, reference_ID
  const timescale = buf.readUInt32BE(p);
  p += 4;
  let ept, first;
  if (version === 0) {
    if (p + 12 > end) return null;
    ept = buf.readUInt32BE(p);
    first = buf.readUInt32BE(p + 4);
    p += 8;
  } else {
    if (p + 20 > end) return null;
    ept = Number(buf.readBigUInt64BE(p));
    first = Number(buf.readBigUInt64BE(p + 8));
    p += 16;
  }
  p += 2; // reserved
  const count = buf.readUInt16BE(p);
  p += 2;
  if (!timescale || p + count * 12 > end) return null;
  const refs = [];
  for (let i = 0; i < count; i++, p += 12) {
    const word = buf.readUInt32BE(p);
    if (word >>> 31) return null; // points at another index, which Downy does not follow
    refs.push({ size: word, duration: buf.readUInt32BE(p + 4) });
  }
  return { timescale, ept, first, refs, end };
}

// What the start of a stream says about its fragments. Returns null when the stream has no
// usable index, or { need } when the buffer is too short to tell.
function readIndex(buf) {
  const { boxes, stopped } = topBoxes(buf);
  if (boxes[0]?.type !== "ftyp") return null;
  const moov = boxes.find((b) => b.type === "moov");
  const sidx = boxes.find((b) => b.type === "sidx");
  if (moov && sidx) {
    if (moov.at > sidx.at) return null;
    const need = Math.max(moov.at + moov.size, sidx.at + sidx.size);
    if (need > buf.length) return { need };
    const index = readSidx(buf, sidx);
    return index && { ...index, initEnd: moov.at + moov.size };
  }
  if (stopped) return null;
  const last = boxes[boxes.length - 1];
  return { need: last.at + last.size + 16 };
}

// Which bytes of a stream hold a clip. buf is the start of the stream.
// Returns { init: { offset, size }, data: { offset, size }, t0 }, where t0 is the second
// the first fragment starts at. Also null when the stream has no index, or { need: bytes }
// when buf is too short to hold it.
function plan(buf, clip) {
  const index = readIndex(buf);
  if (!index || index.need) return index;
  const from = clip.start * index.timescale;
  const to = clip.end * index.timescale;
  let offset = index.end + index.first;
  let ticks = index.ept;
  let a = -1;
  let b = -1;
  let t0 = 0;
  for (const r of index.refs) {
    if (a < 0 && ticks + r.duration > from) {
      a = offset;
      t0 = ticks;
    }
    if (a >= 0 && ticks < to) b = offset + r.size;
    offset += r.size;
    ticks += r.duration;
  }
  if (a < 0 || b < 0) return null;
  return { init: { offset: 0, size: index.initEnd }, data: { offset: a, size: b - a }, t0: t0 / index.timescale };
}

// A stream, cut into the stream records of its init bytes and its clip bytes.
function split(st, p) {
  const base = { ...st, path: "", segments: null, ranges: true };
  delete base.partial;
  return [
    { ...base, part: "init", offset: p.init.offset, size: p.init.size },
    { ...base, part: "data", offset: p.data.offset, size: p.data.size, t0: p.t0 },
  ];
}

async function fetchHead(st, bytes, { signal, refresh }) {
  for (let retried = false; ; retried = true) {
    const headers = { ...st.headers, Range: `bytes=0-${bytes - 1}` };
    delete headers["Accept-Encoding"];
    let res;
    try {
      res = await fetch(st.url, { headers, signal });
    } catch (e) {
      if (signal?.aborted) throw new AbortError();
      throw e;
    }
    if ((res.status === 403 || res.status === 410) && !retried) {
      res.body?.cancel().catch(() => {});
      await refresh();
      continue;
    }
    if (res.status !== 206) {
      res.body?.cancel().catch(() => {});
      if (res.status === 200) return null; // no Range support, so the stream stays whole
      throw new Error(`The server answered ${res.status}`);
    }
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) throw new AbortError();
      throw e;
    }
  }
}

// Reads the start of a stream and plans its clip, growing the read when the index runs past
// it. Returns null when the stream has to be downloaded whole.
async function planStream(st, clip, opts) {
  let want = HEAD;
  for (;;) {
    const buf = await fetchHead(st, want, opts);
    if (!buf) return null;
    const p = plan(buf, clip);
    if (!p?.need) return p;
    if (p.need > MAX_HEAD || buf.length < want) return null;
    want = p.need;
  }
}

module.exports = { parseClip, label, estimate, timecode, plan, split, planStream };
