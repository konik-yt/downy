import { AbsoluteFill, Interactive, useCurrentFrame } from "remotion";
import { tw } from "../../anim";
import { PixelLogo } from "../../components/PixelLogo";
import { Reveal } from "../../components/Reveal";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { C, inter } from "../../theme";

export const SetupIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const T = 34;
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text }}>
      <Stage dim={tw(frame, [0, 50], [0.85, 0.6])} />
      <AbsoluteFill style={{ background: "#000", opacity: tw(frame, [0, 16], [1, 0]) }} />
      <div style={{ position: "absolute", left: 960 - 101, top: 214 }}>
        <PixelLogo frame={frame} start={4} cell={9} spread={600} tileOpacity={tw(frame, [24, 40], [0, 1])} />
      </div>
      <div style={{ position: "absolute", top: 470, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Reveal text="Setting up Downy" frame={frame} start={T} stagger={4} accent={["Downy"]} style={{ fontSize: 120, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1 }} />
      </div>
      <Interactive.Div
        name="Subtitle"
        style={{
          position: "absolute",
          top: 630,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 44,
          fontWeight: 500,
          color: C.muted,
          opacity: tw(frame, [T + 22, T + 42], [0, 1]),
          translate: `0 ${tw(frame, [T + 22, T + 42], [18, 0])}px`,
          filter: `blur(${tw(frame, [T + 22, T + 42], [10, 0])}px)`,
        }}
      >
        Five steps, about two minutes. Every click is shown.
      </Interactive.Div>
      <Sfx at={4} name="sparkle" volume={0.6} />
      <Sfx at={T - 4} name="thump" volume={0.5} />
      <Sfx at={T} name="logo" volume={0.55} />
    </AbsoluteFill>
  );
};
