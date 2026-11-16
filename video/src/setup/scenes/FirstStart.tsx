import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, path, tw } from "../../anim";
import { Cursor } from "../../components/Cursor";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { DP, DownyApp, PlacedDialog, Win, dlgPt } from "../DownyApp";
import { Captions, Hud } from "../ui";
import { Tool } from "../Welcome";

// Step 3: Downy's first start. Pick the folder, then let Downy install yt-dlp, ffmpeg and Deno.
const W: Win = { x: 160, y: 60, z: 4 / 3 };
const K = { use: 70, install: 122, next: 322 };
const TOOLS: [string, number, number, number][] = [
  // name, MB, start, end
  ["yt-dlp", 18.6, 124, 172],
  ["ffmpeg", 94.2, 172, 242],
  ["Deno", 41.8, 242, 282],
];

export const FirstStart: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = tw(frame, [0, 26], [0, 1]);
  const use = dlgPt(W, "folder", ...DP.use);
  const inst = dlgPt(W, "tools", ...DP.install);

  const camera = cam(frame, [
    [0, 1, 960, 540],
    [18, 1, 960, 540],
    [46, 1.4, 960, 560],
    [K.use + 6, 1.4, 960, 560],
    [98, 1.3, 960, 560],
    [K.next + 6, 1.3, 960, 560],
    [356, 1, 960, 575],
  ]);
  const p = path(frame, [
    [8, 1460, 960],
    [60, use.x, use.y],
    [K.use + 6, use.x, use.y],
    [104, inst.x + 50, inst.y + 70],
    [K.install - 6, inst.x, inst.y],
    [K.install + 8, inst.x, inst.y],
    [190, inst.x + 70, inst.y + 100],
    [300, inst.x + 70, inst.y + 100],
    [K.next - 6, inst.x, inst.y],
  ]);

  const tools: Tool[] = TOOLS.map(([name, mb, a, b]) => {
    if (frame >= b) return { name, state: "found", text: "Found" };
    if (frame >= a) {
      const bar = interpolate(frame, [a, b - 4], [0, 1], clamp);
      return { name, state: "busy", text: `${(bar * mb).toFixed(1)} MB of ${mb} MB`, bar };
    }
    return { name, state: "missing", text: "Not found, Downy installs it" };
  });
  const busy = TOOLS.find(([, , a, b]) => frame >= a && frame < b);
  const ready = frame >= TOOLS[2][3];
  const hlAt = (k: number) => tw(frame, [k - 10, k - 5], [0, 1]) * (1 - tw(frame, [k + 6, k + 12], [0, 1]));
  const pressAt = (k: number) => interpolate(frame, [k - 2, k, k + 6], [0, 1, 0], clamp);
  const hl = frame < 100 ? "use" : "install";
  const hlAmt = frame < 100 ? hlAt(K.use) : Math.max(hlAt(K.install), hlAt(K.next));
  const press = frame < 100 ? pressAt(K.use) : Math.max(pressAt(K.install), pressAt(K.next));

  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={480} />
      <div style={camStyle(camera)}>
        <DownyApp
          w={W}
          backdrop={1}
          style={{ opacity: enter, translate: `0 ${(1 - enter) * 50}px`, scale: String(0.94 + enter * 0.06), filter: `blur(${(1 - enter) * 10}px)` }}
        >
          <PlacedDialog step="folder" frame={frame} a={tw(frame, [12, 30], [0, 1]) * (1 - tw(frame, [K.use + 4, K.use + 14], [0, 1]))} dir={-1} hl={hl} hlAmt={hlAmt} press={press} />
          <PlacedDialog
            step="tools"
            frame={frame}
            a={tw(frame, [K.use + 10, K.use + 26], [0, 1]) * (1 - tw(frame, [K.next + 2, K.next + 12], [0, 1]))}
            hl={hl}
            hlAmt={hlAmt}
            press={press}
            tools={tools}
            installLabel={frame < K.install ? "Install" : ready ? "Next" : "Installing"}
            toolStatus={ready ? { text: "All tools are ready", tone: "ok" } : busy ? { text: `Installing ${busy[0]}`, tone: "wait" } : { text: "", tone: "" }}
          />
          <PlacedDialog step="ext" frame={frame} a={tw(frame, [K.next + 8, K.next + 24], [0, 1])} />
        </DownyApp>
        <Cursor x={p.x} y={p.y} frame={frame} clicks={Object.values(K)} opacity={tw(frame, [10, 20], [0, 1])} />
      </div>

      <Hud frame={frame} step={2} progress={frame / 360} />
      <Captions
        frame={frame}
        cues={[
          [10, 48, "Downy opens and asks where to save your downloads"],
          [50, K.use + 10, "Click [Use this folder], or [Choose folder] to pick another"],
          [K.use + 14, K.install + 2, "Downy needs yt-dlp, ffmpeg and Deno. Click [Install]"],
          [K.install + 4, 282, "Downy installs them with winget. It takes a minute or two"],
          [284, K.next + 4, "When all three say Found, click [Next]"],
        ]}
      />

      {Object.values(K).map((k) => (
        <Sfx key={k} at={k} name="click" volume={0.9} />
      ))}
      <Sfx at={4} name="whoosh-soft" volume={0.35} />
      <Sfx at={12} name="pop-up" volume={0.45} />
      <Sfx at={K.use + 8} name="whoosh-soft" volume={0.3} />
      {TOOLS.map(([n, , , b]) => (
        <Sfx key={n} at={b} name="tick" volume={0.4} />
      ))}
      <Sfx at={TOOLS[2][3] + 2} name="success" volume={0.55} />
      <Sfx at={K.next + 6} name="whoosh-soft" volume={0.3} />
    </AbsoluteFill>
  );
};
