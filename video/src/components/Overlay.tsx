import { C } from "../theme";

export const MENU = [
  { label: "MP4 file, quality 2160p 4K", size: "1.4 GB" },
  { label: "MP4 file, quality 1440p 2K", size: "792 MB" },
  { label: "MP4 file, quality 1080p HD", size: "386 MB" },
  { label: "MP4 file, quality 720p HD", size: "171 MB" },
  { label: "MP4 file, quality 480p", size: "88 MB" },
  { sep: true },
  { label: "M4A audio only", size: "11.6 MB" },
  { label: "MP3 audio only", size: "11.6 MB" },
] as const;

// The extension's button over the player, from extension/overlay.js, drawn at `zoom`.
export const ZOOM = 1.4;
export const PILL = { top: 14, right: 14, h: 33 };
export const ITEM_H = 34;
export const MENU_TOP = PILL.top + PILL.h + 6; // in unzoomed px, relative to the player
export const HEAD_H = 34;

export const DownyOverlay: React.FC<{
  show: number;
  hoverMain: number;
  text: string;
  fill: number;
  menu: number;
  hoverItem: number;
}> = ({ show, hoverMain, text, fill, menu, hoverItem }) => (
  <div
    style={{
      position: "absolute",
      top: PILL.top,
      right: PILL.right,
      zoom: ZOOM,
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 13,
      lineHeight: 1.35,
      opacity: show,
      translate: `0 ${(1 - show) * -8}px`,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        height: PILL.h,
        borderRadius: 8,
        overflow: "hidden",
        background: "#0d0b26",
        color: "#fff",
        boxShadow: `0 2px 10px rgba(0,0,0,.35), inset 0 -10px 16px -12px #7864ffcc, 0 0 ${hoverMain * 26}px #8a7fe8aa`,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 12px 0 10px",
          fontWeight: 600,
          overflow: "hidden",
          background: hoverMain > 0.5 ? "linear-gradient(90deg, #948df0, #7f9bff)" : "linear-gradient(90deg, #8a7fe8cc, #6f8cff99)",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fill * 100}%`, background: "rgba(255,255,255,.22)" }} />
        <svg viewBox="0 0 14 14" width="14" height="14" style={{ position: "relative" }}>
          <path d="M7 1v8M3.5 5.5 7 9l3.5-3.5M2 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ position: "relative", whiteSpace: "nowrap" }}>{text}</span>
      </div>
      {["?", "×"].map((s) => (
        <div key={s} style={{ display: "grid", placeItems: "center", width: 28, borderLeft: "1px solid rgba(255,255,255,.18)", color: "#e6e2ff", fontWeight: 700 }}>
          {s}
        </div>
      ))}
    </div>
    {menu > 0 ? (
      <div
        style={{
          position: "absolute",
          right: 0,
          top: PILL.h + 6,
          width: 310,
          background: "#0d0c20",
          color: C.text,
          borderRadius: 8,
          padding: "5px 0",
          boxShadow: "0 8px 28px rgba(0,0,0,.5), 0 0 0 1px #24224a",
          opacity: menu,
          transformOrigin: "top right",
          transform: `translateY(${(1 - menu) * -10}px) scale(${0.96 + menu * 0.04})`,
          clipPath: `inset(0 0 ${(1 - menu) * 100}% 0)`,
        }}
      >
        <div style={{ height: HEAD_H - 5, padding: "6px 14px 0", fontSize: 12, color: C.muted, borderBottom: "1px solid #24224a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Sunrise above the Dolomites, a 4K drone film
        </div>
        <div style={{ height: 4 }} />
        {MENU.map((m, i) =>
          "sep" in m ? (
            <div key={i} style={{ height: 1, background: "#24224a", margin: "4px 0" }} />
          ) : (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                height: ITEM_H,
                padding: "0 14px",
                background: i === hoverItem ? "#1e1b48" : "transparent",
              }}
            >
              <span style={{ color: "#8a948e", width: 16, fontVariantNumeric: "tabular-nums" }}>{i < 5 ? i + 1 : i}.</span>
              <span style={{ flex: 1 }}>{m.label}</span>
              <span style={{ color: C.muted, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{m.size}</span>
            </div>
          ),
        )}
      </div>
    ) : null}
  </div>
);
