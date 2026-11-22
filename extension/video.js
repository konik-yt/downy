(() => {
  if (window.__downyVideo || !/^https?:$/.test(location.protocol)) return;
  window.__downyVideo = true;
  if (/(^|\.)youtube(-nocookie)?\.com$/i.test(location.hostname) && !location.pathname.startsWith("/embed/")) return;

  const { Overlay } = globalThis.__downy;
  const MIN_W = 200;
  const MIN_H = 110;
  const LINGER = 1500;

  const overlay = new Overlay();
  overlay.requireFormats = true;
  overlay.host.style.position = "fixed";
  let target = null;
  let hoverUntil = 0;
  overlay.autoHidden = () => Date.now() > hoverUntil;

  function rectOf(v) {
    const r = v.getBoundingClientRect();
    const visible = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    return r.width >= MIN_W && r.height >= MIN_H && visible ? r : null;
  }

  function videoAt(x, y) {
    for (const v of document.querySelectorAll("video")) {
      const r = rectOf(v);
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  function place() {
    const r = target && rectOf(target);
    if (!r) return;
    overlay.host.style.top = `${Math.max(r.top, 0) + 12}px`;
    overlay.host.style.right = `${Math.max(innerWidth - r.right, 0) + 12}px`;
  }

  function show(v) {
    target = v;
    hoverUntil = Date.now() + LINGER;
    // Nothing outside the fullscreen element shows in fullscreen.
    overlay.attach({ id: location.href, url: location.href }, document.fullscreenElement || document.documentElement);
    overlay.prefetch();
    place();
  }

  let lastMove = 0;
  document.addEventListener("pointermove", (e) => {
    if (Date.now() - lastMove < 100) return;
    lastMove = Date.now();
    if (e.composedPath().includes(overlay.host)) {
      hoverUntil = Date.now() + LINGER;
      return;
    }
    const v = videoAt(e.clientX, e.clientY);
    if (v) show(v);
    overlay.updateVisibility();
  }, { passive: true, capture: true });

  document.addEventListener("fullscreenchange", () => {
    if (overlay.video) overlay.attach(overlay.video, document.fullscreenElement || document.documentElement);
    place();
  });
  addEventListener("scroll", place, { passive: true, capture: true });
  addEventListener("resize", place);

  setInterval(() => {
    if (overlay.video && overlay.video.id !== location.href && !overlay.busy) overlay.detach();
    if (target && !target.isConnected) target = null;
    if (overlay.updateVisibility()) place();
  }, 500);
})();
