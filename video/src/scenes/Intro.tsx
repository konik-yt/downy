import { AbsoluteFill, Interactive, useCurrentFrame } from "remotion";
import { tw } from "../anim";
import { PixelLogo } from "../components/PixelLogo";
import { Reveal } from "../components/Reveal";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/Stage";
import { C, inter } from "../theme";

// "You found the perfect video." Then the pixel arrow builds itself and Downy is named.
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const LOGO = 66;
  const NAME = 104;
  const shift = tw(frame, [NAME - 6, NAME + 22], [0, 1]);
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text }}>
      <Stage dim={tw(frame, [0, 60], [0.85, 0.6])} />
      <AbsoluteFill style={{ background: "#000", opacity: tw(frame, [0, 18], [1, 0]) }} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Reveal
          text="You found the perfect video."
          frame={frame}
          start={8}
          exit={56}
          stagger={4}
          accent={["perfect"]}
          style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.03em" }}
        />
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: 960 - 156 - shift * 300,
          top: 540 - 156 - shift * 20,
          scale: String(1 - shift * 0.3),
        }}
      >
        <PixelLogo frame={frame} start={LOGO} cell={14} spread={700} tileOpacity={tw(frame, [LOGO + 24, LOGO + 44], [0, 1])} />
      </div>

      <div style={{ position: "absolute", left: 960 - 120, top: 400, width: 900 }}>
        <Reveal
          text="Downy"
          frame={frame}
          start={NAME + 4}
          style={{ fontSize: 168, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}
        />
        <Interactive.Div
          name="Tagline"
          style={{
            marginTop: 22,
            fontSize: 44,
            fontWeight: 500,
            color: C.muted,
            letterSpacing: "-0.01em",
            opacity: tw(frame, [NAME + 18, NAME + 38], [0, 1]),
            translate: `0 ${tw(frame, [NAME + 18, NAME + 38], [20, 0])}px`,
            filter: `blur(${tw(frame, [NAME + 18, NAME + 38], [10, 0])}px)`,
          }}
        >
          Keep it. In one click.
        </Interactive.Div>
      </div>

      {[8, 12, 16, 20, 24].map((f, i) => (
        <Sfx key={f} at={f} name="tick-low" volume={0.18 + i * 0.03} />
      ))}
      <Sfx at={54} name="whoosh-soft" volume={0.45} />
      <Sfx at={LOGO} name="sparkle" volume={0.7} />
      <Sfx at={NAME} name="logo" volume={0.6} />
      <Sfx at={NAME - 2} name="thump" volume={0.55} />
    </AbsoluteFill>
  );
};
