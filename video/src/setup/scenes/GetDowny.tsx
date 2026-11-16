import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, path, tw } from "../../anim";
import { Cursor } from "../../components/Cursor";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { DownloadBubble, Installer, REL, ReleaseBrowser, SMART_MORE, SMART_RUN, SmartScreen, WIZ_NEXT } from "../Release";
import { Captions, Hud } from "../ui";

// Steps 1 and 2: download the installer from GitHub, get past SmartScreen, install.
const K = { asset: 62, open: 112, more: 175, run: 220, install: 280, finish: 345 };

export const GetDowny: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = tw(frame, [0, 30], [0, 1]);
  const camera = cam(frame, [
    [0, 1, 960, 540],
    [26, 1, 960, 540],
    [52, 1.4, 720, 520],
    [K.asset + 8, 1.4, 720, 520],
    [92, 1.5, 1480, 340],
    [K.open + 6, 1.5, 1480, 340],
    [136, 1, 960, 540],
    [K.run + 14, 1, 960, 540],
    [262, 1.18, 960, 520],
  ]);
  const p = path(frame, [
    [8, 1500, 1010],
    [54, REL.asset.x, REL.asset.y],
    [K.asset + 8, REL.asset.x, REL.asset.y],
    [96, REL.open.x - 30, REL.open.y + 60],
    [K.open - 6, REL.open.x, REL.open.y],
    [K.open + 8, REL.open.x, REL.open.y],
    [150, 1060, 720],
    [K.more - 8, SMART_MORE.x, SMART_MORE.y],
    [K.more + 10, SMART_MORE.x, SMART_MORE.y],
    [K.run - 8, SMART_RUN.x, SMART_RUN.y],
    [K.run + 8, SMART_RUN.x, SMART_RUN.y],
    [250, 1300, 860],
    [K.install - 8, WIZ_NEXT.x, WIZ_NEXT.y],
    [K.install + 8, WIZ_NEXT.x, WIZ_NEXT.y],
    [306, WIZ_NEXT.x + 40, WIZ_NEXT.y + 70],
    [K.finish - 8, WIZ_NEXT.x, WIZ_NEXT.y],
  ]);

  const hoverAsset = tw(frame, [46, 56], [0, 1]) * (1 - tw(frame, [K.asset + 10, K.asset + 20], [0, 1]));
  const pressAsset = interpolate(frame, [K.asset - 2, K.asset, K.asset + 6], [0, 1, 0], clamp);
  const bubble = tw(frame, [K.asset + 2, K.asset + 14], [0, 1]) * (1 - tw(frame, [K.open + 4, K.open + 14], [0, 1]));
  const dl = interpolate(frame, [K.asset + 4, 100], [0, 1], clamp);
  const smart = tw(frame, [126, 146], [0, 1]) * (1 - tw(frame, [K.run + 2, K.run + 14], [0, 1]));
  const more = tw(frame, [K.more + 1, K.more + 14], [0, 1]);
  const wiz = tw(frame, [K.run + 16, K.run + 36], [0, 1]) * (1 - tw(frame, [K.finish + 2, K.finish + 14], [0, 1]));
  const page = frame < K.install + 2 ? 0 : frame < 322 ? 1 : 2;
  const dim = tw(frame, [120, 146], [0, 1]);

  const nextHover = (k: number) => tw(frame, [k - 10, k - 6], [0, 1]) * (1 - tw(frame, [k + 4, k + 8], [0, 1]));
  const press = (k: number) => interpolate(frame, [k - 2, k, k + 6], [0, 1, 0], clamp);

  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={120} />
      <div style={camStyle(camera)}>
        <ReleaseBrowser
          hoverAsset={hoverAsset}
          press={pressAsset}
          style={{
            opacity: enter * (1 - tw(frame, [K.run + 10, K.run + 30], [0, 0.85])),
            transform: `perspective(2200px) rotateX(${(1 - enter) * 12}deg) translateY(${(1 - enter) * 100}px) scale(${0.92 + enter * 0.08})`,
            filter: `blur(${dim * 5}px) brightness(${1 - dim * 0.5})`,
          }}
        >
          <DownloadBubble show={bubble} progress={dl} hoverOpen={tw(frame, [K.open - 8, K.open - 4], [0, 1])} />
        </ReleaseBrowser>
        <SmartScreen show={smart} more={more} hoverRun={nextHover(K.run)} pressRun={press(K.run)} />
        <Installer
          show={wiz}
          page={page}
          progress={interpolate(frame, [K.install + 2, 320], [0, 1], clamp)}
          hoverNext={page === 1 ? 0 : Math.max(nextHover(K.install), nextHover(K.finish))}
          pressNext={Math.max(press(K.install), press(K.finish))}
        />
        <Cursor x={p.x} y={p.y} frame={frame} clicks={Object.values(K)} opacity={tw(frame, [8, 18], [0, 1])} />
      </div>

      <Hud frame={frame} step={frame < K.open ? 0 : 1} progress={frame < K.open ? frame / K.open : (frame - K.open) / (360 - K.open)} />
      <Captions
        frame={frame}
        cues={[
          [6, 50, "Open the latest release on [github.com/konik-yt/downy]"],
          [52, 104, "Click [Downy-Setup-2.2.1.exe] to download it"],
          [106, 140, "When it finishes, click [Open]"],
          [142, K.more - 4, "Windows warns you because Downy isn't code signed"],
          [K.more - 2, 232, "Click [More info], then [Run anyway]"],
          [236, 300, "Keep the folder and click [Install]"],
          [302, 360, "Leave [Run Downy] checked and click [Finish]"],
        ]}
      />

      {Object.values(K).map((k) => (
        <Sfx key={k} at={k} name="click" volume={0.9} />
      ))}
      <Sfx at={2} name="whoosh-soft" volume={0.35} />
      <Sfx at={K.asset + 2} name="pop-up" volume={0.5} />
      <Sfx at={100} name="tick-low" volume={0.4} />
      <Sfx at={124} name="whoosh-soft" volume={0.4} />
      <Sfx at={K.more + 2} name="pop-down" volume={0.3} />
      <Sfx at={K.run + 14} name="pop-up" volume={0.45} />
      <Sfx at={322} name="chime" volume={0.45} />
      <Sfx at={K.finish + 4} name="whoosh" volume={0.35} />
    </AbsoluteFill>
  );
};
