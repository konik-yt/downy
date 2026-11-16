import { Audio } from "@remotion/media";
import { Sequence, staticFile } from "remotion";

export type SoundName =
  | "click"
  | "click-soft"
  | "tick"
  | "tick-low"
  | "pop-up"
  | "pop-down"
  | "whoosh"
  | "whoosh-soft"
  | "riser"
  | "chime"
  | "success"
  | "logo"
  | "thump"
  | "sparkle"
  | "shimmer";

// Plays one sound effect starting at `at`, a frame in the parent's timeline.
export const Sfx: React.FC<{ at: number; name: SoundName; volume?: number }> = ({ at, name, volume = 1 }) => (
  <Sequence from={Math.round(at)} durationInFrames={120} layout="none" name={`sfx ${name}`}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);
