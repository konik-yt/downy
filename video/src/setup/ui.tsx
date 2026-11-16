import { Img, interpolate, staticFile } from "remotion";
import { clamp, ease, tw } from "../anim";
import { SegBar } from "../components/SegBar";
import { C, inter, mono } from "../theme";

export const STEPS = ["Download Downy", "Run the installer", "First start", "Add to Chrome", "Try it"];

// Text in [brackets] is a button or label on screen, and shows in the accent color.
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\[[^\]]+\])/).map((part, i) =>
      part.startsWith("[") ? (
        <span key={i} style={{ color: C.ink, background: "#8a7fe833", boxShadow: "inset 0 0 0 1px #b4aaff40", borderRadius: 10, padding: "0 12px", margin: "0 2px" }}>
          {part.slice(1, -1)}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    )}
  </>
);

export type Cue = [from: number, to: number, text: string];

// One instruction at a time at the bottom of the screen.
export const Captions: React.FC<{ frame: number; cues: Cue[] }> = ({ frame, cues }) => (
  <>
    {cues.map(([from, to, text]) => {
      if (frame < from - 1 || frame > to + 14) return null;
      const i = tw(frame, [from, from + 14], [0, 1]);
      const o = tw(frame, [to, to + 12], [0, 1]);
      return (
        <div key={from} style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div
            style={{
              padding: "18px 34px",
              borderRadius: 24,
              fontFamily: inter,
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.3,
              color: C.text,
              letterSpacing: "-0.01em",
              background: "linear-gradient(160deg, #8a7fe82e, #0000 50%), #07061ae6",
              boxShadow: "inset 0 1px 0 #ffffff14, inset 0 -18px 28px -20px #7864ff88, 0 0 0 1px #b4aaff26, 0 30px 70px -20px #000",
              opacity: i * (1 - o),
              translate: `0 ${(1 - i) * 24 - o * 10}px`,
              filter: `blur(${(1 - i) * 10 + o * 8}px)`,
            }}
          >
            <Rich text={text} />
          </div>
        </div>
      );
    })}
  </>
);

// The chapter bar at the top: which step this is, and a pixel bar with one block per step.
export const Hud: React.FC<{ frame: number; step: number; progress: number; show?: number }> = ({ frame, step, progress, show = 1 }) => {
  const fills = STEPS.map((_, i) => (i < step ? 1 : i === step ? progress : 0));
  const a = tw(frame, [0, 16], [0, 1]) * show;
  return (
    <>
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 170, background: "linear-gradient(#000000e6, #000000a0 45%, #0000)", opacity: a }} />
    <div style={{ position: "absolute", left: 56, right: 56, top: 40, display: "flex", alignItems: "center", gap: 18, fontFamily: inter, opacity: a }}>
      <Img src={staticFile("icon.png")} style={{ width: 40, height: 40 }} />
      <span style={{ fontSize: 24, fontWeight: 600, color: C.text }}>Setting up Downy</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontFamily: mono, fontSize: 20, color: C.hi }}>
        {step + 1}/{STEPS.length}
      </span>
      <span style={{ fontSize: 24, fontWeight: 500, color: C.soft, minWidth: 230 }}>{STEPS[step]}</span>
      <div style={{ width: 300 }}>
        <SegBar fills={fills} height={14} cell={3} radius={4} />
      </div>
    </div>
    </>
  );
};

// Keycaps that press down, for Ctrl+V and Enter.
export const Keys: React.FC<{ frame: number; at: number; keys: string[]; x: number; y: number }> = ({ frame, at, keys, x, y }) => {
  const a = interpolate(frame, [at - 6, at, at + 16, at + 24], [0, 1, 1, 0], clamp);
  if (a <= 0) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", gap: 12, alignItems: "center", opacity: a, translate: `-50% ${(1 - a) * 16}px`, fontFamily: inter }}>
      {keys.map((k, i) => {
        const down = interpolate(frame, [at + i * 3, at + i * 3 + 2, at + 16], [0, 1, 0], clamp);
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {i ? <span style={{ color: C.muted, fontSize: 34, fontWeight: 600 }}>+</span> : null}
            <div
              style={{
                minWidth: 76,
                height: 70,
                padding: "0 20px",
                boxSizing: "border-box",
                display: "grid",
                placeItems: "center",
                borderRadius: 14,
                fontSize: 28,
                fontWeight: 600,
                color: C.text,
                background: "linear-gradient(#2a2760, #17153c)",
                boxShadow: `0 ${8 - down * 6}px 0 #0b0a24, 0 ${12 - down * 6}px 24px #000000aa, inset 0 1px 0 #ffffff26, 0 0 ${down * 30}px #8a7fe8aa`,
                translate: `0 ${down * 6}px`,
              }}
            >
              {k}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// A small toast, like the ones Downy shows at the bottom of its window.
export const Toast: React.FC<{ frame: number; from: number; to: number; text: string; style?: React.CSSProperties }> = ({ frame, from, to, text, style }) => {
  const a = tw(frame, [from, from + 10], [0, 1], ease) * (1 - tw(frame, [to, to + 10], [0, 1]));
  if (a <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        translate: `-50% ${(1 - a) * 12}px`,
        maxWidth: 560,
        padding: "10px 16px",
        borderRadius: 12,
        fontFamily: inter,
        fontSize: 13.5,
        color: C.text,
        background: "linear-gradient(160deg, #8a7fe81f, #0000 45%), color-mix(in srgb, #0b0a1e 92%, #0000)",
        border: `1px solid ${C.lineAccent}`,
        boxShadow: "inset 0 1px 0 #ffffff0f, 0 24px 60px -20px #000000e6",
        opacity: a,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

// Text that appears as if pasted: a selection flash, then the characters.
export const Pasted: React.FC<{ frame: number; at: number; text: string; placeholder?: string; caretFrom?: number; color?: string }> = ({
  frame,
  at,
  text,
  placeholder = "",
  caretFrom = -1,
  color,
}) => {
  const on = frame >= at;
  const caret = caretFrom >= 0 && frame >= caretFrom && Math.floor((frame - caretFrom) / 15) % 2 === 0;
  const flash = interpolate(frame, [at, at + 12], [1, 0], clamp);
  return (
    <span style={{ position: "relative", whiteSpace: "nowrap", color: on ? color : C.faint }}>
      <span style={{ background: on ? `rgba(138,127,232,${flash * 0.55})` : undefined, borderRadius: 3 }}>{on ? text : placeholder}</span>
      {caret ? <span style={{ display: "inline-block", width: 1.5, height: "1.1em", verticalAlign: "-0.15em", background: C.text, marginLeft: 1 }} /> : null}
    </span>
  );
};
