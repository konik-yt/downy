import { ManagerWindow, WIN } from "../components/Manager";
import { WelcomeDialog, WelcomeProps } from "./Welcome";

// Heights of each welcome step at 1:1, measured from a render.
export const DLG_H = { folder: 330, tools: 442, ext: 577 } as const;
export type Step = keyof typeof DLG_H;
export type Win = { x: number; y: number; z: number };

// The dialog is centered in the 1200 x 720 window, like showModal() does.
const dialogTop = (step: Step) => (WIN.h - DLG_H[step]) / 2;
const DIALOG_LEFT = (WIN.w - 520) / 2;

// A point inside a welcome step, in world pixels.
export const dlgPt = (w: Win, step: Step, dx: number, dy: number) => ({
  x: w.x + (DIALOG_LEFT + dx) * w.z,
  y: w.y + (dialogTop(step) + dy) * w.z,
});

// Points measured on each step at 1:1.
export const DP = {
  use: [434, 289],
  install: [461, 403],
  open: [441, 258],
  copy: [448, 413],
  status: [200, 491],
  done: [463, 537],
} as const;

// The Downy window, first-run state, at world position x, y and scale z.
export const DownyApp: React.FC<{ w: Win; backdrop: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ w, backdrop, style, children }) => (
  <div
    style={{
      position: "absolute",
      left: w.x / w.z,
      top: w.y / w.z,
      zoom: w.z,
      width: WIN.w,
      height: WIN.h,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: "0 0 0 1px #b4aaff22, 0 50px 120px -30px #000, 0 0 140px -40px #6f6cf066",
      ...style,
    }}
  >
    <ManagerWindow empty>
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: backdrop * 0.65 }} />
      {children}
    </ManagerWindow>
  </div>
);

// One welcome step placed in the window. `a` fades and lifts it in or out.
export const PlacedDialog: React.FC<{ a: number; dir?: number } & WelcomeProps> = ({ a, dir = 1, ...p }) =>
  a <= 0 ? null : (
    <div
      style={{
        position: "absolute",
        left: DIALOG_LEFT,
        top: dialogTop(p.step),
        opacity: a,
        translate: `0 ${(1 - a) * 14 * dir}px`,
        scale: String(0.985 + a * 0.015),
        filter: `blur(${(1 - a) * 6}px)`,
      }}
    >
      <WelcomeDialog {...p} />
    </div>
  );
