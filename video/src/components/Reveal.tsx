import { interpolate } from "remotion";
import { clamp, ease } from "../anim";

// Words that rise out of a blur one after another, and leave the same way.
export const Reveal: React.FC<{
  text: string;
  frame: number;
  start: number;
  exit?: number;
  stagger?: number;
  style?: React.CSSProperties;
  accent?: string[];
}> = ({ text, frame, start, exit = 1e6, stagger = 3, style, accent = [] }) => {
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: "0.26em", ...style }}>
      {words.map((w, i) => {
        const s = start + i * stagger;
        const p = interpolate(frame, [s, s + 20], [0, 1], { ...clamp, easing: ease });
        const e = interpolate(frame, [exit + i * 1.5, exit + i * 1.5 + 14], [0, 1], { ...clamp, easing: ease });
        const on = accent.includes(w.replace(/[.,]/g, ""));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p * (1 - e),
              transform: `translateY(${(1 - p) * 0.5 - e * 0.35}em)`,
              filter: `blur(${(1 - p) * 14 + e * 10}px)`,
              ...(on
                ? {
                    background: "linear-gradient(90deg, #c9c2ff, #8fa5ff)",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }
                : null),
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
