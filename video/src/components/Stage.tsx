import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

// Downy's pixel aurora: the app's own sky image at 4x, with a black pixel grid over every cell.
export const Stage: React.FC<{ dim?: number; children?: React.ReactNode; drift?: number }> = ({
  dim = 0.55,
  drift = 0,
  children,
}) => {
  const frame = useCurrentFrame();
  const t = frame + drift;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <Img
        name="Sky"
        src={staticFile("sky.png")}
        style={{
          position: "absolute",
          width: 2112,
          height: 1188,
          left: -96 + Math.sin(t / 90) * 40,
          top: -54 + Math.cos(t / 110) * 22,
          imageRendering: "pixelated",
          filter: `hue-rotate(${Math.sin(t / 140) * 12}deg) brightness(${1 + Math.sin(t / 60) * 0.08})`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(90deg, #000 1px, #0000 1px), linear-gradient(0deg, #000 1px, #0000 1px)",
          backgroundSize: "4px 4px",
        }}
      />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: dim }} />
      <AbsoluteFill
        style={{ background: "radial-gradient(120% 90% at 50% 45%, #0000 40%, #000000c0 100%)" }}
      />
      {children}
    </AbsoluteFill>
  );
};
