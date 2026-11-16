import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { pixelDissolve } from "./components/PixelDissolve";
import { Sfx } from "./components/Sfx";
import { AddExtension } from "./setup/scenes/AddExtension";
import { FirstStart } from "./setup/scenes/FirstStart";
import { GetDowny } from "./setup/scenes/GetDowny";
import { SetupIntro } from "./setup/scenes/SetupIntro";
import { SetupOutro } from "./setup/scenes/SetupOutro";
import { TryIt } from "./setup/scenes/TryIt";

// Scene lengths in frames; each dissolve overlaps two scenes by 20 frames.
export const SETUP = { intro: 120, get: 360, first: 360, ext: 650, tryIt: 180, outro: 150 };
const DISSOLVE = 20;
const LENGTHS = Object.values(SETUP);
export const SETUP_TOTAL = LENGTHS.reduce((a, b) => a + b, 0) - (LENGTHS.length - 1) * DISSOLVE;
const CUTS = LENGTHS.slice(0, -1).map((_, i) => LENGTHS.slice(0, i + 1).reduce((a, b) => a + b, 0) - (i + 1) * DISSOLVE);

export const DownySetup: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={120}>
        <SetupIntro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Get Downy" durationInFrames={360}>
        <GetDowny />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="First start" durationInFrames={360}>
        <FirstStart />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Add to Chrome" durationInFrames={650}>
        <AddExtension />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Try it" durationInFrames={180}>
        <TryIt />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pixelDissolve(60)} timing={linearTiming({ durationInFrames: 20 })} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={150}>
        <SetupOutro />
      </TransitionSeries.Sequence>
    </TransitionSeries>

    <Audio
      name="Music"
      src={staticFile("sfx/music-setup.wav")}
      volume={(f) => interpolate(f, [0, 20, SETUP_TOTAL - 40, SETUP_TOTAL - 2], [0, 0.45, 0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    />
    {CUTS.map((f) => (
      <Sfx key={f} at={f - 4} name="shimmer" volume={0.45} />
    ))}
  </AbsoluteFill>
);
