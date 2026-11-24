// The trimmer for downloading part of a video, shared by the main window and the confirm window.
// A filmstrip of the video with a handle at each end of the part to keep, like the trim bar in
// Apple Photos. Drag a handle, drag the middle to move the whole part, or click the strip to bring
// the nearest end there. On a handle, the arrow keys move one second, with Shift ten.
//
// trimmer({ duration, storyboard, onChange, screen }) returns { el, range }.
// storyboard comes from formats.js, or is null when the site has none, and then the strip is plain.
// onChange({ start, end }) runs when a drag ends or a key moves a handle.
// screen is an optional canvas that shows the frame under the handle while it moves. Without it,
// a small frame shows above the handle.
window.trimmer = ({ duration, storyboard, onChange, screen = null }) => {
  const max = Math.max(1, Math.floor(duration));
  let start = 0;
  let end = max;
  const sb = storyboard;
  const sheets = new Map(); // url -> Image, loaded as frames are needed

  const make = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  const el = make("div", "trim");
  const track = make("div", "trim-track");
  const strip = make("canvas", "trim-strip");
  const shadeL = make("div", "trim-shade l");
  const shadeR = make("div", "trim-shade r");
  const sel = make("div", "trim-sel");
  const handles = ["start", "end"].map((side) => {
    const h = make("div", `trim-handle ${side}`);
    h.tabIndex = 0;
    h.setAttribute("role", "slider");
    h.setAttribute("aria-label", side === "start" ? "Start of the part to download" : "End of the part to download");
    h.setAttribute("aria-valuemin", "0");
    h.setAttribute("aria-valuemax", String(max));
    h.dataset.side = side;
    return h;
  });
  const bubble = make("div", "trim-bubble");
  const bubbleFrame = make("canvas");
  const bubbleTime = make("span");
  bubble.append(bubbleFrame, bubbleTime);
  if (screen || !sb) bubbleFrame.hidden = true;
  sel.append(...handles);
  track.append(strip, shadeL, shadeR, sel, bubble);
  const times = make("div", "trim-times");
  // The ends of the strip at the sides, and the part to keep in the middle.
  const [tStart, tLength, tEnd] = ["span", "b", "span"].map((t) => make(t));
  tStart.textContent = formatTime(0);
  tEnd.textContent = formatTime(max);
  tLength.setAttribute("aria-live", "polite");
  times.append(tStart, tLength, tEnd);
  el.append(track, times);

  // ------------------------------------------------------------ frames

  function sheet(url) {
    if (!sheets.has(url)) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        drawStrip();
        if (screen?.dataset.t) drawFrame(screen, Number(screen.dataset.t));
      };
      img.src = url;
      sheets.set(url, img);
    }
    const img = sheets.get(url);
    return img.complete && img.naturalWidth ? img : null;
  }

  // Draws the storyboard frame shown at second t into a box of the canvas, cropped to fill it.
  function frame(ctx, t, x, y, w, h) {
    const per = sb.rows * sb.cols;
    const i = Math.max(0, Math.min(sb.count - 1, Math.floor(t * sb.fps)));
    const img = sheet(sb.sheets[Math.floor(i / per)]);
    if (!img) return;
    const k = i % per;
    let sx = (k % sb.cols) * sb.width;
    let sy = Math.floor(k / sb.cols) * sb.height;
    let sw = sb.width;
    let sh = sb.height;
    if (sw / sh > w / h) {
      sx += (sw - (sh * w) / h) / 2;
      sw = (sh * w) / h;
    } else {
      sy += (sh - (sw * h) / w) / 2;
      sh = (sw * h) / w;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return canvas.getContext("2d");
  }

  function drawStrip() {
    if (!sb || !strip.isConnected) return;
    const ctx = fit(strip);
    const { width: W, height: H } = strip;
    ctx.clearRect(0, 0, W, H);
    const fw = (H * sb.width) / sb.height;
    const n = Math.max(1, Math.ceil(W / fw));
    for (let j = 0; j < n; j++) frame(ctx, ((j + 0.5) / n) * max, j * (W / n), 0, W / n + 1, H);
  }

  function drawFrame(canvas, t) {
    canvas.dataset.t = String(t);
    if (!sb) return;
    const ctx = fit(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame(ctx, t, 0, 0, canvas.width, canvas.height);
  }

  new ResizeObserver(drawStrip).observe(strip);

  // ------------------------------------------------------------ the range

  const pct = (t) => `${(t / max) * 100}%`;

  function paint() {
    sel.style.left = pct(start);
    sel.style.right = `calc(100% - ${pct(end)})`;
    shadeL.style.width = pct(start);
    shadeR.style.left = pct(end);
    for (const h of handles) {
      const t = h.dataset.side === "start" ? start : end;
      h.setAttribute("aria-valuenow", String(t));
      h.setAttribute("aria-valuetext", formatTime(t));
    }
    tLength.textContent = start === 0 && end === max ? "Drag an end to trim" : `${formatTime(start)} to ${formatTime(end)}, ${timeInWords(end - start)}`;
    el.classList.toggle("cut", start > 0 || end < max);
  }

  // Shows the frame and the time at t while something moves, or hides them when t is null.
  function scrub(t, side) {
    bubble.classList.toggle("on", t != null);
    screen?.classList.toggle("on", t != null);
    if (t == null) return;
    bubbleTime.textContent = formatTime(t);
    bubble.style.left = pct(t);
    bubble.dataset.side = side;
    if (screen) drawFrame(screen, t);
    else if (sb) drawFrame(bubbleFrame, t);
  }

  function move(side, t) {
    t = Math.round(t);
    if (side === "start") start = Math.max(0, Math.min(t, end - 1));
    else end = Math.min(max, Math.max(t, start + 1));
    paint();
  }

  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * max;
  };

  // One drag at a time: a handle, the whole part, or a click on the strip that brings an end over.
  let drag = null;
  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.target.closest(".trim-handle");
    const t = timeAt(e.clientX);
    if (handle) drag = { side: handle.dataset.side, grab: t - (handle.dataset.side === "start" ? start : end) };
    else if (e.target === sel) drag = { side: "both", grab: t - start, length: end - start };
    else {
      drag = { side: Math.abs(t - start) < Math.abs(t - end) ? "start" : "end", grab: 0 };
      move(drag.side, t);
    }
    (handle || track).setPointerCapture(e.pointerId);
    (handle || handles[drag.side === "end" ? 1 : 0]).focus({ preventScroll: true });
    el.classList.add("dragging");
    scrub(drag.side === "end" ? end : start, drag.side);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const t = timeAt(e.clientX) - drag.grab;
    if (drag.side === "both") {
      start = Math.round(Math.max(0, Math.min(t, max - drag.length)));
      end = start + drag.length;
      paint();
    } else move(drag.side, t);
    scrub(drag.side === "end" ? end : start, drag.side);
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove("dragging");
    scrub(null);
    onChange?.({ start, end });
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("lostpointercapture", release);

  for (const h of handles) {
    h.addEventListener("keydown", (e) => {
      const side = h.dataset.side;
      const now = side === "start" ? start : end;
      const step = e.shiftKey ? 10 : 1;
      const to = { ArrowLeft: now - step, ArrowDown: now - step, ArrowRight: now + step, ArrowUp: now + step, PageDown: now - 60, PageUp: now + 60, Home: 0, End: max }[e.key];
      if (to == null) return;
      e.preventDefault();
      move(side, to);
      onChange?.({ start, end });
    });
  }

  paint();
  return { el, range: () => ({ start, end }) };
};
