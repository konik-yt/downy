import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, path, tw } from "../../anim";
import { Browser } from "../../components/Browser";
import { Cursor } from "../../components/Cursor";
import { DownyOverlay } from "../../components/Overlay";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { POS } from "../../scenes/Browse";
import { Captions, Hud } from "../ui";

// Step 5: the button is on YouTube now.
const PILL = 34;
const CLICK = 112;

export const TryIt: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = tw(frame, [0, 28], [0, 1]);
  const camera = cam(frame, [
    [0, 1, 960, 540],
    [20, 1, 960, 540],
    [70, 1.55, 1010, 420],
  ]);
  const p = path(frame, [
    [10, 1450, 900],
    [PILL + 10, 1150, 520],
    [CLICK - 8, POS.pill[0], POS.pill[1]],
    [CLICK + 20, POS.pill[0], POS.pill[1]],
    [150, POS.item(2)[0], POS.item(2)[1]],
  ]);
  const menu = tw(frame, [CLICK + 2, CLICK + 16], [0, 1]);
  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={1500} />
      <div style={camStyle(camera)}>
        <Browser
          page={1}
          playT={interpolate(frame, [0, 600], [0.1, 0.6], clamp)}
          style={{
            opacity: enter,
            transform: `perspective(2200px) rotateX(${(1 - enter) * 12}deg) translateY(${(1 - enter) * 100}px) scale(${0.92 + enter * 0.08})`,
          }}
          overlay={
            <DownyOverlay
              show={tw(frame, [PILL, PILL + 12], [0, 1])}
              hoverMain={tw(frame, [CLICK - 10, CLICK - 6], [0, 1])}
              text="Download this video"
              fill={0}
              menu={menu}
              hoverItem={frame >= 144 ? 2 : frame >= 136 ? 1 : frame >= 128 ? 0 : -1}
            />
          }
        />
        <Cursor x={p.x} y={p.y} frame={frame} clicks={[CLICK]} opacity={tw(frame, [10, 20], [0, 1])} />
      </div>
      <Hud frame={frame} step={4} progress={frame / 180} />
      <Captions
        frame={frame}
        cues={[
          [10, 96, "Now open any YouTube video"],
          [98, 180, "Click [Download this video] and pick a quality"],
        ]}
      />
      <Sfx at={2} name="whoosh-soft" volume={0.35} />
      <Sfx at={PILL} name="pop-up" volume={0.6} />
      <Sfx at={CLICK} name="click" volume={0.9} />
      <Sfx at={CLICK + 2} name="pop-down" volume={0.4} />
      {[128, 136, 144].map((f) => (
        <Sfx key={f} at={f} name="tick" volume={0.3} />
      ))}
    </AbsoluteFill>
  );
};
