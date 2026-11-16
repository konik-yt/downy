import { Easing, interpolate } from "remotion";
import { clamp, rand } from "../anim";

// The cells of Downy's pixel arrow icon, on a 16 x 17 grid.
export const CELLS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 0; r <= 5; r++) for (let c = 5; c <= 10; c++) out.push([c, r]);
  for (let r = 6; r <= 13; r++) {
    const inset = r - 6;
    for (let c = inset; c <= 15 - inset; c++) out.push([c, r]);
  }
  for (let r = 15; r <= 16; r++) for (let c = 0; c <= 15; c++) out.push([c, r]);
  return out;
})();

// The arrow, assembled cell by cell starting at `start`. Each cell flies in from a scattered spot.
export const PixelLogo: React.FC<{
  frame: number;
  start: number;
  cell?: number;
  spread?: number;
  tile?: boolean;
  tileOpacity?: number;
}> = ({ frame, start, cell = 18, spread = 520, tile = true, tileOpacity = 1 }) => {
  const size = cell * 16;
  const pad = cell * 3.2;
  const box = size + pad * 2;
  return (
    <div style={{ position: "relative", width: box, height: box }}>
      {tile ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: box * 0.23,
            background: "linear-gradient(160deg, #2c2a72, #12113a 70%)",
            boxShadow: "inset 0 2px 0 #ffffff1c, inset 0 -30px 50px -30px #8a7fe8aa, 0 30px 90px -20px #6f6cf099",
            opacity: tileOpacity,
            scale: String(interpolate(tileOpacity, [0, 1], [0.8, 1])),
          }}
        />
      ) : null}
      {CELLS.map(([c, r], i) => {
        const delay = r * 1.3 + rand(i) * 9;
        const p = interpolate(frame - start - delay, [0, 26], [0, 1], {
          ...clamp,
          easing: Easing.bezier(0.2, 0.9, 0.25, 1),
        });
        const a = rand(i + 99) * Math.PI * 2;
        const d = spread * (0.4 + rand(i + 7) * 0.6);
        const glow = interpolate(frame - start - delay, [18, 26, 40], [0, 1, 0], clamp);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: pad + c * cell,
              top: pad + r * cell,
              width: cell - Math.max(1.5, cell * 0.1),
              height: cell - Math.max(1.5, cell * 0.1),
              borderRadius: cell * 0.12,
              background: glow > 0.01 ? `color-mix(in srgb, #ffffff ${glow * 70}%, #aaa7ff)` : "#aaa7ff",
              boxShadow: `0 0 ${cell * 0.8}px #b4aaff${Math.round(40 + glow * 150).toString(16).padStart(2, "0")}`,
              opacity: p,
              transform: `translate(${Math.cos(a) * d * (1 - p)}px, ${Math.sin(a) * d * (1 - p)}px) rotate(${(1 - p) * (rand(i + 3) * 360 - 180)}deg) scale(${0.3 + p * 0.7})`,
            }}
          />
        );
      })}
    </div>
  );
};
