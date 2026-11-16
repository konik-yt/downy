import { AbsoluteFill, Freeze, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp } from "../anim";
import { AddExtension } from "./scenes/AddExtension";
import { FirstStart } from "./scenes/FirstStart";
import { GetDowny } from "./scenes/GetDowny";
import { TryIt } from "./scenes/TryIt";

// Short silent loops for the README, one per written step. Each plays a frame range of a
// setup scene, holds the last frame so the caption can be read, then fades to black so the
// jump back to the start doesn't show.
const SCENES = { GetDowny, FirstStart, AddExtension, TryIt };
export type ClipProps = { scene: keyof typeof SCENES; from: number; to: number };

export const CLIP_HOLD = 36;
const FADE_IN = 8;
const FADE_OUT = 10;

// Each range starts as a caption comes in and stops while the last caption is still fully shown.
export const CLIPS: (ClipProps & { id: string })[] = [
  { id: "download", scene: "GetDowny", from: 0, to: 222 },
  { id: "install", scene: "GetDowny", from: 233, to: 347 },
  { id: "first-start", scene: "FirstStart", from: 0, to: 324 },
  { id: "chrome-extensions", scene: "AddExtension", from: 0, to: 216 },
  { id: "load-unpacked", scene: "AddExtension", from: 216, to: 500 },
  { id: "connected", scene: "AddExtension", from: 500, to: 601 },
  { id: "try-it", scene: "TryIt", from: 0, to: 178 },
];

export const clipLength = (c: ClipProps) => c.to - c.from + CLIP_HOLD;

export const StepClip: React.FC<ClipProps> = ({ scene, from, to }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const Scene = SCENES[scene];
  const a = interpolate(frame, [0, FADE_IN, durationInFrames - FADE_OUT, durationInFrames - 1], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: a }}>
        {/* Freeze clamps its frame to the composition length, so the offset into the scene comes from the Sequence. */}
        <Freeze frame={to - from} active={frame > to - from}>
          <Sequence from={-from} layout="none">
            <Scene />
          </Sequence>
        </Freeze>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
