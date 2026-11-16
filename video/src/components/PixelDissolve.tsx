import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill } from "remotion";
import { rand } from "../anim";

type Props = { cell: number };

const W = 1920;
const H = 1080;

// Each cell switches over at its own moment: a diagonal sweep with random jitter.
const threshold = (cx: number, cy: number, cols: number, rows: number) =>
  ((cx / cols) * 0.55 + (cy / rows) * 0.25) * 0.75 + rand(cx * 131 + cy * 17) * 0.25;

const Dissolve: React.FC<TransitionPresentationComponentProps<Props>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
  passedProps: { cell },
}) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  if (p >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  let mask = "";
  const sparks: React.ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = threshold(x, y, cols, rows);
      const local = (p * 1.25 - t) / 0.12;
      if (local > 0) mask += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      if (local > -0.3 && local < 1) {
        sparks.push(
          <div
            key={`${x}-${y}`}
            style={{
              position: "absolute",
              left: x * cell + 2,
              top: y * cell + 2,
              width: cell - 4,
              height: cell - 4,
              borderRadius: 3,
              background: "#c9c2ff",
              opacity: (1 - Math.abs(local - 0.35) / 0.65) * 0.3,
              boxShadow: "0 0 18px #8a7fe8",
            }}
          />,
        );
      }
    }
  }
  const url = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${mask}</svg>`,
  )}")`;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ maskImage: url, WebkitMaskImage: url, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}>
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none" }}>{sparks}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const pixelDissolve = (cell = 60): TransitionPresentation<Props> => ({
  component: Dissolve,
  props: { cell },
});
