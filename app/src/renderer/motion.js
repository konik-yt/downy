(() => {
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const still = (node) => calm.matches || !node.isConnected || !node.getClientRects().length;
  const SPRING = "cubic-bezier(.3, 1.45, .5, 1)";
  const SOFT = "cubic-bezier(.2, .7, .2, 1)";

  window.roll = (node, value) => {
    const text = String(value);
    const old = node.dataset.v ?? node.textContent;
    node.dataset.v = text;
    if (old === text) return;
    if (still(node) || !old || !text) {
      node.textContent = text;
      return;
    }
    const down = Number(text) < Number(old) ? -1 : 1;
    const out = document.createElement("span");
    const into = document.createElement("span");
    out.textContent = old;
    into.textContent = text;
    node.replaceChildren(out, into);
    node.classList.add("rolling");
    out.animate([
      { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
      { transform: `translateY(${-75 * down}%)`, opacity: 0, filter: "blur(3px)" },
    ], { duration: 220, easing: "ease-in", fill: "forwards" });
    into.animate([
      { transform: `translateY(${75 * down}%)`, opacity: 0, filter: "blur(3px)" },
      { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
    ], { duration: 380, easing: SPRING, fill: "backwards" }).finished.then(() => {
      if (node.dataset.v !== text) return;
      node.classList.remove("rolling");
      node.textContent = text;
    }, () => {});
  };

  window.morph = (node, text) => {
    const old = node.dataset.label ?? node.textContent;
    node.dataset.label = text;
    if (old === text && node.textContent === text) return;
    if (still(node) || !old) {
      node.textContent = text;
      return;
    }
    const host = node.closest("button") || node;
    const before = host.getBoundingClientRect().width;
    let same = 0;
    while (same < old.length && same < text.length && old[same] === text[same]) same++;
    node.replaceChildren(text.slice(0, same), ...[...text.slice(same)].map((ch, i) => {
      const s = document.createElement("span");
      s.className = "morph-ch";
      s.textContent = ch;
      s.animate([
        { opacity: 0, filter: "blur(4px)", transform: "translateY(3px)" },
        { opacity: 1, filter: "blur(0)", transform: "none" },
      ], { duration: 340, delay: i * 24, easing: SOFT, fill: "backwards" });
      return s;
    }));
    const after = host.getBoundingClientRect().width;
    if (Math.abs(after - before) < 1) return;
    host.style.overflow = "hidden";
    host.animate([{ width: `${before}px` }, { width: `${after}px` }], { duration: 440, easing: SPRING })
      .finished.then(() => host.style.removeProperty("overflow"), () => {});
  };

  window.popIcon = (host) => {
    const svg = host.querySelector(":scope > svg.ic");
    if (!svg || still(host)) return;
    svg.animate([
      { opacity: 0, transform: "scale(.4) rotate(-45deg)", filter: "blur(2px)" },
      { opacity: 1, transform: "none", filter: "blur(0)" },
    ], { duration: 380, easing: SPRING });
  };

  window.placePill = (bar, target) => {
    let pill = bar.querySelector(":scope > .pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "pill";
      pill.setAttribute("aria-hidden", "true");
      bar.prepend(pill);
    }
    pill.hidden = !target;
    if (!target) return;
    const to = { x: target.offsetLeft, w: target.offsetWidth };
    const from = pill.dataset.x ? { x: Number(pill.dataset.x), w: Number(pill.dataset.w) } : null;
    pill.dataset.x = to.x;
    pill.dataset.w = to.w;
    pill.style.transform = `translateX(${to.x}px)`;
    pill.style.width = `${to.w}px`;
    if (!from || (from.x === to.x && from.w === to.w) || still(bar)) return;
    const right = to.x > from.x;
    const fromR = from.x + from.w;
    const toR = to.x + to.w;
    const left = from.x + (to.x - from.x) * (right ? 0.2 : 0.8);
    const edge = fromR + (toR - fromR) * (right ? 0.8 : 0.2);
    pill.animate([
      { transform: `translateX(${from.x}px)`, width: `${from.w}px`, easing: "cubic-bezier(.5, 0, .7, .4)" },
      { transform: `translateX(${left}px) scaleY(.86)`, width: `${edge - left}px`, offset: 0.4, easing: SPRING },
      { transform: `translateX(${to.x}px)`, width: `${to.w}px` },
    ], { duration: 480 });
  };

  document.addEventListener("change", (e) => {
    if (e.target.matches?.("input.switch")) e.target.dataset.moved = "";
  });

  const tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("aria-hidden", "true");
  const tipText = document.createElement("span");
  tip.append(tipText);
  let current = null;
  let showTimer = 0;
  let hideTimer = 0;
  let hiddenAt = 0;

  const tipFor = (node) => {
    const b = node?.closest?.("button");
    if (!b || b.closest("dialog") || b.classList.contains("win-btn") || b.textContent.trim()) return null;
    if (b.title) {
      // Keep the words, but stop Chromium from showing its own tooltip as well.
      b.dataset.tip = b.title;
      if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", b.title);
      b.removeAttribute("title");
    }
    return b.dataset.tip || b.getAttribute("aria-label") ? b : null;
  };

  const place = (b, glide) => {
    const text = b.dataset.tip || b.getAttribute("aria-label");
    const old = tipText.dataset.label || "";
    tipText.textContent = text;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tipText.dataset.label = text;
    if (glide && old && old !== text) {
      tipText.dataset.label = old;
      tipText.textContent = old;
      window.morph(tipText, text);
    }
    const r = b.getBoundingClientRect();
    const below = r.top < 48;
    const x = Math.max(8 + w / 2, Math.min(innerWidth - 8 - w / 2, r.left + r.width / 2));
    const y = below ? r.bottom + 8 : r.top - 8 - h;
    tip.classList.toggle("glide", glide);
    tip.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    tip.dataset.side = below ? "below" : "above";
  };

  const show = (b) => {
    if (!document.body.contains(tip)) document.body.append(tip);
    const glide = tip.classList.contains("on");
    place(b, glide);
    tip.classList.add("on");
  };

  const hide = () => {
    clearTimeout(showTimer);
    if (tip.classList.contains("on")) hiddenAt = Date.now();
    tip.classList.remove("on");
    current = null;
  };

  const enter = (b) => {
    clearTimeout(hideTimer);
    if (b === current) return;
    current = b;
    clearTimeout(showTimer);
    if (tip.classList.contains("on") || Date.now() - hiddenAt < 400) show(b);
    else showTimer = setTimeout(() => current === b && b.isConnected && show(b), 500);
  };

  const leave = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 90);
  };

  document.addEventListener("pointerover", (e) => {
    const b = tipFor(e.target);
    if (b) enter(b);
    else if (current) leave();
  });
  document.addEventListener("pointerleave", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("focusin", (e) => {
    const b = tipFor(e.target);
    if (b?.matches(":focus-visible")) enter(b);
  });
  document.addEventListener("focusout", (e) => e.target === current && leave());

  const glow = document.createElement("div");
  glow.className = "drop-glow";
  glow.setAttribute("aria-hidden", "true");
  glow.innerHTML = `<p class="drop-hint">${window.icon("arrowDown")}<span>Drop the link to download it</span></p>`;
  const isLink = (e) => {
    const types = [...(e.dataTransfer?.types || [])];
    return !types.includes("application/x-downy-row") && !types.includes("Files")
      && (types.includes("text/uri-list") || types.includes("text/plain"));
  };
  const endDrag = () => document.body.classList.remove("drop-on");
  document.addEventListener("dragenter", (e) => {
    if (!isLink(e)) return;
    if (!document.body.contains(glow)) document.body.append(glow);
    document.body.classList.add("drop-on");
  });
  document.addEventListener("dragover", (e) => {
    if (!document.body.classList.contains("drop-on")) return;
    glow.style.setProperty("--x", `${e.clientX}px`);
    glow.style.setProperty("--y", `${e.clientY}px`);
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) endDrag();
  });
  document.addEventListener("drop", endDrag);
  document.addEventListener("dragend", endDrag);
})();
