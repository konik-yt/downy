import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { pixelDissolve } from "./components/PixelDissolve";
import { Sfx } from "./components/Sfx";
import { Browse } from "./scenes/Browse";
import { Features } from "./scenes/Features";
import { Intro } from "./scenes/Intro";
import { ManagerScene } from "./scenes/ManagerScene";
import { Outro } from "./scenes/Outro";
import { D, TOTAL } from "./theme";

const cut1 = D.intro - D.dissolve;
const cut2 = cut1 + D.browse + D.manager - D.dissolve;
const cut3 = cut2 + D.features - D.dissolve;

export const DownyPromo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={165}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Browse" durationInFrames={345}>
        <Browse />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence name="Manager" durationInFrames={300}>
        <ManagerScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Features" durationInFrames={240}>
        <Features />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={165}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>

    <Audio
      name="Music"
      src={staticFile("sfx/music.wav")}
      volume={(f) => interpolate(f, [0, 20, TOTAL - 40, TOTAL - 2], [0, 0.55, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    />
    {[cut1, cut2, cut3].map((f) => (
      <Sfx key={f} at={f - 4} name="shimmer" volume={0.5} />
    ))}
  </AbsoluteFill>
);
