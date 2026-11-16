import { interpolate } from "remotion";
import { clamp, ease } from "../anim";

// A pointer that dips when it clicks and leaves a ring behind.
export const Cursor: React.FC<{
  x: number;
  y: number;
  frame: number;
  clicks: number[];
  opacity?: number;
  size?: number;
}> = ({ x, y, frame, clicks, opacity = 1, size = 34 }) => {
  let press = 0;
  const rings: React.ReactNode[] = [];
  clicks.forEach((c, i) => {
    press = Math.max(press, interpolate(frame, [c - 3, c, c + 5], [0, 1, 0], clamp));
    const p = interpolate(frame, [c, c + 22], [0, 1], { ...clamp, easing: ease });
    if (frame >= c && frame < c + 22) {
      rings.push(
        <div
          key={i}
          style={{
            position: "absolute",
            left: x - 40,
            top: y - 40,
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "2px solid #c9c2ff",
            boxShadow: "0 0 24px #8a7fe8aa, inset 0 0 18px #8a7fe866",
            opacity: (1 - p) * opacity,
            scale: String(0.2 + p * 0.9),
          }}
        />,
      );
    }
  });
  return (
    <>
      {rings}
      <svg
        width={size}
        height={size * 1.25}
        viewBox="0 0 24 30"
        style={{
          position: "absolute",
          left: x - size * 0.16,
          top: y - size * 0.08,
          opacity,
          transformOrigin: "20% 10%",
          scale: String(1 - press * 0.16),
          filter: "drop-shadow(0 6px 10px #000000aa)",
          overflow: "visible",
        }}
      >
        <path
          d="M3.5 2.2v21.4c0 .8 1 1.2 1.6.6l5.1-5.2 3.6 8.2c.2.5.8.7 1.3.5l2.8-1.2c.5-.2.7-.8.5-1.3l-3.6-8.1h7.2c.9 0 1.3-1 .7-1.6L5.2 1.6c-.6-.6-1.7-.2-1.7.6Z"
          fill="#fff"
          stroke="#0b0a1e"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};
