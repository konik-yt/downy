import { Easing, interpolate } from "remotion";

export const ease = Easing.bezier(0.16, 1, 0.3, 1); // fast out, long settle
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const swift = Easing.bezier(0.4, 0, 0.2, 1);

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// interpolate with clamping and an easing.
export const tw = (frame: number, input: [number, number], output: [number, number], easing = ease) =>
  interpolate(frame, input, output, { ...clamp, easing });

// Keyframes: [[frame, value], ...], eased between each pair.
export function keys(frame: number, k: [number, number][], easing = inOut) {
  if (frame <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (frame <= k[i][0]) return tw(frame, [k[i - 1][0], k[i][0]], [k[i - 1][1], k[i][1]], easing);
  }
  return k[k.length - 1][1];
}

// A point that moves between waypoints [frame, x, y].
export function path(frame: number, pts: [number, number, number][], easing = inOut) {
  return {
    x: keys(frame, pts.map(([f, x]) => [f, x] as [number, number]), easing),
    y: keys(frame, pts.map(([f, , y]) => [f, y] as [number, number]), easing),
  };
}

// Seeded random in 0..1.
export function rand(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Camera: shows the world point (fx, fy) at the screen center, scaled by s.
export type Cam = { s: number; fx: number; fy: number };
export function camStyle({ s, fx, fy }: Cam, w = 1920, h = 1080): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    transformOrigin: "0 0",
    transform: `translate(${w / 2 - fx * s}px, ${h / 2 - fy * s}px) scale(${s})`,
  };
}
export function cam(frame: number, k: [number, number, number, number][], easing = inOut): Cam {
  return {
    s: keys(frame, k.map(([f, s]) => [f, s] as [number, number]), easing),
    fx: keys(frame, k.map(([f, , x]) => [f, x] as [number, number]), easing),
    fy: keys(frame, k.map(([f, , , y]) => [f, y] as [number, number]), easing),
  };
}
