// Downy's pixel segment bar. Each block is one connection's part of the file.
export const SegBar: React.FC<{
  fills: number[];
  height?: number;
  mode?: "live" | "post" | "paused" | "done";
  cell?: number;
  radius?: number;
  glow?: number;
}> = ({ fills, height = 12, mode = "live", cell = 3, radius = 3, glow = 0 }) => {
  const n = fills.length;
  const fillBg =
    mode === "post"
      ? "linear-gradient(90deg, #6f8cff, #9aa6ff)"
      : mode === "paused"
        ? "#6b5a3c"
        : mode === "done"
          ? "linear-gradient(90deg, #5fbf9c, #8fdcc0)"
          : "linear-gradient(90deg, #6f6cf0, #a99fff)";
  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: radius,
        background: "#1d1a4a",
        overflow: "hidden",
        boxShadow: glow ? `0 0 ${glow}px #8a7fe866` : undefined,
      }}
    >
      {fills.map((f, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(i / n) * 100}%`,
            width: `${100 / n}%`,
            background: "#262260",
            borderLeft: i ? `${Math.max(2, cell * 0.7)}px solid #000` : undefined,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(0, Math.min(1, f)) * 100}%`,
              background: f >= 1 && mode === "live" ? "#5d57c9" : fillBg,
              boxShadow: f > 0 && f < 1 && mode === "live" ? "2px 0 0 #e6e2ff" : undefined,
            }}
          />
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "linear-gradient(90deg, #000 1px, #0000 1px), linear-gradient(0deg, #000 1px, #0000 1px)",
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: "right bottom",
        }}
      />
    </div>
  );
};
