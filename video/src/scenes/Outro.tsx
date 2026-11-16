import { AbsoluteFill, Interactive, useCurrentFrame, useVideoConfig } from "remotion";
import { tw } from "../anim";
import { PixelLogo } from "../components/PixelLogo";
import { Reveal } from "../components/Reveal";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/Stage";
import { C, inter, mono } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const LAND = 34;
  const pulse = tw(frame, [LAND, LAND + 6], [0, 1]) * (1 - tw(frame, [LAND + 6, LAND + 40], [0, 1]));
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text }}>
      <Stage dim={0.62} drift={1050} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(40% 40% at 50% 38%, #8a7fe8${Math.round(pulse * 90).toString(16).padStart(2, "0")}, #0000 70%)`,
        }}
      />
      <div style={{ position: "absolute", left: 960 - 126, top: 150, scale: String(1 + pulse * 0.04) }}>
        <PixelLogo frame={frame} start={2} cell={11.25} spread={900} tileOpacity={tw(frame, [LAND - 6, LAND + 10], [0, 1])} />
      </div>
      <div style={{ position: "absolute", top: 452, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Reveal text="Downy" frame={frame} start={LAND + 8} style={{ fontSize: 150, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }} />
      </div>
      <Interactive.Div
        name="Tagline"
        style={{
          position: "absolute",
          top: 632,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 46,
          fontWeight: 500,
          color: C.soft,
          letterSpacing: "-0.01em",
          opacity: tw(frame, [LAND + 26, LAND + 46], [0, 1]),
          translate: `0 ${tw(frame, [LAND + 26, LAND + 46], [18, 0])}px`,
          filter: `blur(${tw(frame, [LAND + 26, LAND + 46], [10, 0])}px)`,
        }}
      >
        The download manager for Windows. Free.
      </Interactive.Div>
      <Interactive.Div
        name="Link"
        style={{
          position: "absolute",
          top: 740,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: tw(frame, [LAND + 44, LAND + 62], [0, 1]),
          translate: `0 ${tw(frame, [LAND + 44, LAND + 62], [14, 0])}px`,
        }}
      >
        <div
          style={{
            padding: "14px 28px",
            borderRadius: 999,
            fontFamily: mono,
            fontSize: 30,
            color: C.ink,
            background: `${C.glassTint}, ${C.glass}`,
            boxShadow: `${C.glassShadow}, 0 0 0 1px #b4aaff2a`,
          }}
        >
          github.com/konik-yt/downy
        </div>
      </Interactive.Div>
      <AbsoluteFill style={{ background: "#000", opacity: tw(frame, [durationInFrames - 22, durationInFrames - 1], [0, 1]) }} />

      <Sfx at={2} name="sparkle" volume={0.6} />
      <Sfx at={LAND - 2} name="thump" volume={0.7} />
      <Sfx at={LAND} name="logo" volume={0.6} />
      <Sfx at={LAND + 44} name="tick-low" volume={0.3} />
    </AbsoluteFill>
  );
};
