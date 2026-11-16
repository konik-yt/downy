import { AbsoluteFill, Interactive, useCurrentFrame, useVideoConfig } from "remotion";
import { tw } from "../../anim";
import { PixelLogo } from "../../components/PixelLogo";
import { Reveal } from "../../components/Reveal";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { C, inter, mono } from "../../theme";

export const SetupOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const T = 30;
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text }}>
      <Stage dim={0.62} drift={1700} />
      <div style={{ position: "absolute", left: 960 - 101, top: 170 }}>
        <PixelLogo frame={frame} start={2} cell={9} spread={700} tileOpacity={tw(frame, [T - 8, T + 8], [0, 1])} />
      </div>
      <div style={{ position: "absolute", top: 430, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Reveal text="You're all set." frame={frame} start={T + 4} stagger={4} accent={["set"]} style={{ fontSize: 130, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1 }} />
      </div>
      <Interactive.Div
        name="Hint"
        style={{
          position: "absolute",
          top: 598,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 40,
          fontWeight: 500,
          color: C.soft,
          opacity: tw(frame, [T + 24, T + 44], [0, 1]),
          translate: `0 ${tw(frame, [T + 24, T + 44], [18, 0])}px`,
          filter: `blur(${tw(frame, [T + 24, T + 44], [10, 0])}px)`,
        }}
      >
        Need these steps again? Settings, Chrome extension, Set up.
      </Interactive.Div>
      <Interactive.Div
        name="Link"
        style={{
          position: "absolute",
          top: 700,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: tw(frame, [T + 40, T + 58], [0, 1]),
          translate: `0 ${tw(frame, [T + 40, T + 58], [14, 0])}px`,
        }}
      >
        <div style={{ padding: "14px 28px", borderRadius: 999, fontFamily: mono, fontSize: 30, color: C.ink, background: `${C.glassTint}, ${C.glass}`, boxShadow: `${C.glassShadow}, 0 0 0 1px #b4aaff2a` }}>
          github.com/konik-yt/downy
        </div>
      </Interactive.Div>
      <AbsoluteFill style={{ background: "#000", opacity: tw(frame, [durationInFrames - 22, durationInFrames - 1], [0, 1]) }} />
      <Sfx at={2} name="sparkle" volume={0.55} />
      <Sfx at={T - 2} name="thump" volume={0.6} />
      <Sfx at={T} name="logo" volume={0.55} />
    </AbsoluteFill>
  );
};
