// Puts a "Download this video" button over the YouTube player.
(() => {
  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: "Downy was reloaded. Refresh this page." });
        else resolve(res);
      });
    } catch {
      resolve({ ok: false, error: "Downy was reloaded. Refresh this page." });
    }
  });

  const CSS = `
    :host { all: initial; position: absolute; top: 12px; right: 12px; z-index: 2147483000;
      font: 13px/1.35 "Segoe UI", system-ui, sans-serif; transition: opacity .2s ease; }
    :host(.hidden) { opacity: 0; pointer-events: none; }
    * { box-sizing: border-box; }
    .pill { display: flex; align-items: stretch; border-radius: 8px; overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,.35), inset 0 -10px 16px -12px #7864ffcc; background: #0d0b26; color: #fff; user-select: none; }
    .main { position: relative; display: flex; align-items: center; gap: 7px; padding: 7px 12px 7px 10px;
      background: linear-gradient(90deg, #8a7fe8cc, #6f8cff99); border: 0; color: inherit; font: inherit; font-weight: 600; cursor: pointer; overflow: hidden; }
    .main:hover { background: linear-gradient(90deg, #948df0, #7f9bff); }
    .main .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(255,255,255,.22); transition: width .4s ease; }
    .main span { position: relative; white-space: nowrap; }
    .arrow { position: relative; width: 14px; height: 14px; flex: none; }
    .side { display: grid; place-items: center; width: 28px; border: 0; border-left: 1px solid rgba(255,255,255,.18);
      background: transparent; color: #e6e2ff; font: inherit; font-weight: 700; cursor: pointer; }
    .side:hover { background: rgba(255,255,255,.12); color: #fff; }
    .menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 280px; max-width: 360px; max-height: 60vh; overflow: auto;
      background: #fff; color: #1b1f1c; border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.4); padding: 5px 0; display: none; }
    .menu.open { display: block; }
    .menu .head { padding: 6px 14px 8px; font-size: 12px; color: #66706a; border-bottom: 1px solid #e6e8e4; margin-bottom: 4px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu button { display: flex; width: 100%; gap: 10px; align-items: baseline; padding: 7px 14px; border: 0; background: none;
      font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .menu button:hover, .menu button:focus-visible { background: #ece9ff; outline: none; }
    .menu .n { color: #8a948e; width: 16px; flex: none; font-variant-numeric: tabular-nums; }
    .menu .label { flex: 1; }
    .menu .size { color: #66706a; font-size: 12px; font-variant-numeric: tabular-nums; }
    .menu .sep { height: 1px; background: #e6e8e4; margin: 4px 0; }
    .menu .note { padding: 10px 14px; color: #66706a; }
    .menu .note.bad { color: #b42318; }
    @media (prefers-color-scheme: dark) {
      .menu { background: #0d0c20; color: #f1f0ff; }
      .menu .head, .menu .sep { border-color: #24224a; }
      .menu .sep { background: #24224a; }
      .menu button:hover, .menu button:focus-visible { background: #1e1b48; }
      .menu .head, .menu .size, .menu .note { color: #a6a3c0; }
      .menu .note.bad { color: #ff8a7a; }
    }
  `;

  const ARROW = "M7 1v8M3.5 5.5 7 9l3.5-3.5M2 12.5h10";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function arrowIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("class", "arrow");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", ARROW);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.8");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
    return svg;
  }

  function currentVideo() {
    const u = new URL(location.href);
    if (u.pathname === "/watch" && u.searchParams.get("v")) {
      const id = u.searchParams.get("v");
      return { id, url: `https://www.youtube.com/watch?v=${id}`, player: document.querySelector("#movie_player") };
    }
    const m = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (m) {
      const player = document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player")
        || document.querySelector("#shorts-player");
      return { id: m[1], url: `https://www.youtube.com/shorts/${m[1]}`, player };
    }
    return null;
  }

  function size(n) {
    if (!n) return "";
    const u = ["B", "KB", "MB", "GB"]; let i = 0;
    while (n >= 1024 && i < 3) { n /= 1024; i++; }
    return (i < 2 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
  }

  class Overlay {
    constructor() {
      this.host = document.createElement("downy-overlay");
      const root = this.host.attachShadow({ mode: "closed" });
      const style = el("style"); style.textContent = CSS;

      this.pill = el("div", "pill");
      this.main = el("button", "main");
      this.main.title = "Download this video with Downy";
      this.fill = el("div", "fill");
      this.text = el("span", "", "Download this video");
      this.main.append(this.fill, arrowIcon(), this.text);
      const help = el("button", "side", "?"); help.title = "Open the Downy app";
      const close = el("button", "side", "×"); close.title = "Hide for this video";
      this.pill.append(this.main, help, close);
      this.menu = el("div", "menu");
      root.append(style, this.pill, this.menu);

      this.main.addEventListener("click", () => this.onMainClick());
      this.main.addEventListener("mouseenter", () => this.prefetch());
      help.addEventListener("click", () => send({ type: "manager" }));
      close.addEventListener("click", () => { this.dismissed = this.video?.id; this.closeMenu(); this.updateVisibility(); });

      // Keep clicks and keys from reaching the YouTube player (which would pause or seek).
      for (const ev of ["click", "mousedown", "mouseup", "dblclick", "pointerdown", "pointerup", "keydown", "wheel"]) {
        this.host.addEventListener(ev, (e) => e.stopPropagation());
      }
      document.addEventListener("click", (e) => { if (!e.composedPath().includes(this.host)) this.closeMenu(); });

      this.classObserver = new MutationObserver(() => this.updateVisibility());
      this.video = null;
      this.formats = null;
      this.formatsFor = null;
      this.loading = null;
      this.activeId = null;
      this.pollTimer = null;
      this.missing = 0;
      this.doneId = null;
      this.doneTimer = null;
    }

    onMainClick() {
      if (this.doneId) {
        send({ type: "open", id: this.doneId });
        this.clearDone();
        return;
      }
      this.toggleMenu();
    }

    clearDone() {
      clearTimeout(this.doneTimer);
      this.doneId = null;
      this.setIdle();
      this.updateVisibility();
    }

    attach(video) {
      if (video.id !== this.video?.id) {
        this.video = video;
        this.formats = null;
        this.formatsFor = null;
        this.loading = null;
        this.activeId = null;
        clearTimeout(this.pollTimer);
        clearTimeout(this.doneTimer);
        this.doneId = null;
        this.setIdle();
        this.closeMenu();
      }
      if (this.host.parentElement !== video.player) {
        video.player.append(this.host);
        this.classObserver.disconnect();
        this.classObserver.observe(video.player, { attributes: true, attributeFilter: ["class"] });
      }
      this.updateVisibility();
    }

    detach() {
      this.host.remove();
      this.classObserver.disconnect();
      this.video = null;
    }

    // Follow the YouTube controls: hide when they auto hide, unless the menu is open
    // or a download is running.
    updateVisibility() {
      const p = this.video?.player;
      const autohide = p?.classList.contains("ytp-autohide");
      const busy = this.menu.classList.contains("open") || this.activeId || this.doneId;
      const hide = this.dismissed === this.video?.id || (autohide && !busy);
      this.host.classList.toggle("hidden", !!hide);
    }

    setIdle() {
      this.text.textContent = "Download this video";
      this.fill.style.width = "0";
    }

    prefetch() {
      if (!this.video || this.formatsFor === this.video.id || this.loading) return this.loading;
      const vid = this.video.id;
      this.loading = send({ type: "formats", url: this.video.url }).then((res) => {
        if (this.video?.id !== vid) return;
        this.loading = null;
        if (res?.ok) { this.formats = res.data; this.formatsFor = vid; }
        return res;
      });
      return this.loading;
    }

    // Downy is not running: open it through its downy:// link (this still counts as
    // part of the click, so Chrome allows it), then wait for it to answer.
    async launchApp() {
      this.menu.replaceChildren(el("div", "note", "Starting Downy…"));
      location.href = "downy://show";
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await send({ type: "status" });
        if (st?.ok) {
          this.loading = null;
          this.menu.replaceChildren(el("div", "note", "Reading formats from YouTube…"));
          return this.prefetch();
        }
      }
      return { ok: false, error: "Downy did not start. Open the Downy app from the Start menu, then try again." };
    }

    closeMenu() {
      this.menu.classList.remove("open");
      this.updateVisibility();
    }

    async toggleMenu() {
      if (this.menu.classList.contains("open")) return this.closeMenu();
      this.menu.classList.add("open");
      this.updateVisibility();
      const vid = this.video?.id;
      if (this.formatsFor === vid && this.formats) return this.renderFormats();
      this.menu.replaceChildren(el("div", "note", "Reading formats from YouTube…"));
      let res = await this.prefetch();
      if (res && !res.ok && res.offline && this.video?.id === vid) res = await this.launchApp();
      // The user may have moved to another video while this was loading.
      if (!this.menu.classList.contains("open") || this.video?.id !== vid) return;
      if (res && !res.ok) this.menu.replaceChildren(el("div", "note bad", res.error));
      else if (this.formatsFor === vid && this.formats) this.renderFormats();
    }

    renderFormats() {
      const info = this.formats;
      const items = [el("div", "head", info.title || "")];
      let n = 0, lastKind = null;
      for (const o of info.options) {
        if (lastKind === "video" && o.kind !== "video") items.push(el("div", "sep"));
        lastKind = o.kind;
        n += 1;
        const b = el("button");
        b.append(el("span", "n", `${n}.`), el("span", "label", o.label), el("span", "size", o.sizeText || ""));
        b.addEventListener("click", () => this.start(o));
        items.push(b);
      }
      if (!info.options.length) items.push(el("div", "note", "No downloadable formats were found."));
      this.menu.replaceChildren(...items);
    }

    async start(option) {
      this.closeMenu();
      this.text.textContent = "Starting…";
      const vid = this.video.id;
      const res = await send({ type: "download", url: this.video.url, option: option.id });
      if (this.video?.id !== vid) return; // the button now belongs to another video
      if (!res?.ok) {
        this.text.textContent = "Download failed";
        this.menu.replaceChildren(el("div", "note bad", res?.error || "Unknown error"));
        this.menu.classList.add("open");
        setTimeout(() => this.setIdle(), 4000);
        return;
      }
      this.activeId = res.data.id;
      this.missing = 0;
      this.poll();
    }

    async poll() {
      clearTimeout(this.pollTimer);
      const id = this.activeId;
      if (!id) return;
      const res = await send({ type: "list" });
      if (id !== this.activeId) return;
      const d = res?.ok && res.data.downloads.find((x) => x.id === id);
      if (!d) {
        // Removed from the list, or Downy closed: stop following it after a few tries.
        if (++this.missing > 4) {
          this.activeId = null;
          this.setIdle();
          this.updateVisibility();
          return;
        }
        this.pollTimer = setTimeout(() => this.poll(), 1500);
        return;
      }
      this.missing = 0;
      const pct = Math.round(d.progress * 100);
      this.fill.style.width = `${pct}%`;
      if (d.status === "downloading" || d.status === "queued") {
        this.text.textContent = `Downloading ${pct}%  ${d.speed ? size(d.speed) + "/s" : ""}`.trim();
      } else if (d.status === "merging") {
        this.text.textContent = "Joining video and audio…";
      } else if (d.status === "paused") {
        this.text.textContent = `Paused at ${pct}%`;
      } else if (d.status === "converting") {
        this.text.textContent = "Converting to MP3…";
      } else {
        this.activeId = null;
        this.fill.style.width = d.status === "done" ? "100%" : "0";
        this.text.textContent = d.status === "done" ? "Saved. Show file" : d.status === "cancelled" ? "Cancelled" : "Download failed";
        if (d.status === "done") {
          this.doneId = d.id;
          this.doneTimer = setTimeout(() => this.clearDone(), 8000);
        } else if (d.status === "error") {
          this.menu.replaceChildren(el("div", "note bad", d.error || "Download failed"));
          this.menu.classList.add("open");
          setTimeout(() => this.setIdle(), 4000);
        }
        this.updateVisibility();
        return;
      }
      this.pollTimer = setTimeout(() => this.poll(), 800);
    }
  }

  const overlay = new Overlay();

  function tick() {
    const v = currentVideo();
    if (v && v.player) overlay.attach(v);
    else if (overlay.host.isConnected) overlay.detach();
  }

  document.addEventListener("yt-navigate-finish", tick);
  setInterval(tick, 1000);
  tick();
})();
