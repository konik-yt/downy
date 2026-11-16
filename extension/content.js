// Puts the Downy button over the YouTube player, on watch pages and Shorts.
(() => {
  const { Overlay } = globalThis.__downy;

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

  const overlay = new Overlay();
  // Follow the YouTube controls, which fade out a few seconds after the mouse stops.
  overlay.autoHidden = () => !!overlay.container?.classList.contains("ytp-autohide");
  const classObserver = new MutationObserver(() => overlay.updateVisibility());

  function tick() {
    const v = currentVideo();
    if (v && v.player) {
      if (overlay.container !== v.player) {
        classObserver.disconnect();
        classObserver.observe(v.player, { attributes: true, attributeFilter: ["class"] });
      }
      overlay.attach(v, v.player);
    } else if (overlay.host.isConnected) {
      overlay.detach();
      classObserver.disconnect();
    }
  }

  document.addEventListener("yt-navigate-finish", tick);
  setInterval(tick, 1000);
  tick();
})();
