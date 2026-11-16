import { C, inter } from "../theme";
import { Icon } from "./Icon";
import { Art } from "./Thumb";

// The "ask before download" window, from app/src/renderer/prompt.html. Natural size 540 x 318.
export const PROMPT = { w: 540, h: 318, zoom: 1.6 };
export const PROMPT_RECT = {
  w: PROMPT.w * PROMPT.zoom,
  h: PROMPT.h * PROMPT.zoom,
  x: (1920 - PROMPT.w * PROMPT.zoom) / 2,
  y: 150,
};
// Center of the Download button, in world pixels.
export const PROMPT_GO = { x: PROMPT_RECT.x + 466 * PROMPT.zoom, y: PROMPT_RECT.y + 274 * PROMPT.zoom };
export const PROMPT_FORMAT = { x: PROMPT_RECT.x + 300 * PROMPT.zoom, y: PROMPT_RECT.y + 160 * PROMPT.zoom };

const box: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  height: 36,
  padding: "0 12px",
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  background: "#03030a8c",
  boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: 34,
  padding: "0 14px",
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  background: "#03030a8c",
  color: C.soft,
  fontSize: 13,
  boxSizing: "border-box",
};

export const PromptCard: React.FC<{ hoverGo?: number; pressGo?: number; formatFocus?: number; nameChars?: number }> = ({
  hoverGo = 0,
  pressGo = 0,
  formatFocus = 0,
}) => (
  <div
    style={{
      width: PROMPT.w,
      height: PROMPT.h,
      boxSizing: "border-box",
      borderRadius: 18,
      overflow: "hidden",
      fontFamily: inter,
      fontSize: 14,
      lineHeight: 1.45,
      color: C.text,
      background: "linear-gradient(160deg, #8a7fe824, #0000 40%), #0b0a1ef5",
      border: `1px solid ${C.lineAccent}`,
      boxShadow: "inset 0 1px 0 #ffffff12, inset 0 -18px 28px -20px #7864ff66",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 14px 12px" }}>
      <div style={{ width: 88, height: 49.5, borderRadius: 10, overflow: "hidden", flex: "none" }}>
        <Art v={1} t={0.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Sunrise above the Dolomites, a 4K drone film
        </div>
        <div style={{ marginTop: 2, color: C.muted, fontSize: 12.5 }}>Altitude · YouTube · 12:41</div>
      </div>
      <div style={{ width: 30, height: 30, display: "grid", placeItems: "center", color: C.muted, alignSelf: "flex-start" }}>
        <Icon name="x" size={16} />
      </div>
    </div>
    <div style={{ padding: "2px 14px 4px", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
        <span style={{ width: 58, flex: "none", color: C.muted, fontSize: 13 }}>Name</span>
        <span style={box}>
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>Sunrise above the Dolomites, a 4K drone film</span>
          <span style={{ color: C.faint, paddingLeft: 2 }}>.mp4</span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
        <span style={{ width: 58, flex: "none", color: C.muted, fontSize: 13 }}>Format</span>
        <span
          style={{
            ...box,
            justifyContent: "space-between",
            borderColor: formatFocus > 0.5 ? "#b4aaff55" : C.line,
            boxShadow: `0 0 0 ${3 * formatFocus}px #8a7fe826`,
          }}
        >
          <span>MP4 file, quality 1080p HD · 386 MB</span>
          <Icon name="chevron" size={14} color={C.muted} />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
        <span style={{ width: 58, flex: "none", color: C.muted, fontSize: 13 }}>Save to</span>
        <span style={{ ...box, color: C.soft, fontSize: 13 }}>C:\Users\you\Videos\Downy\YouTube\1080p</span>
        <span style={btn}>Change</span>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 14px" }}>
      <span style={{ flex: 1, color: C.faint, fontSize: 12 }}>Enter to download, Esc to cancel</span>
      <span style={btn}>Cancel</span>
      <span
        style={{
          ...btn,
          border: 0,
          color: "#fff",
          fontWeight: 600,
          padding: "0 16px 0 13px",
          background: hoverGo > 0.5 ? "linear-gradient(90deg, #948df0, #7f9bff)" : C.primary,
          boxShadow: `0 0 ${hoverGo * 24}px #8a7fe8aa`,
          scale: String(1 - pressGo * 0.06),
        }}
      >
        <Icon name="arrowDown" size={16} />
        Download
      </span>
    </div>
  </div>
);
