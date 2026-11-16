import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, path, tw } from "../../anim";
import { Cursor } from "../../components/Cursor";
import { Sfx } from "../../components/Sfx";
import { Stage } from "../../components/Stage";
import { CH, CH_PT, ChromeWindow, DLG, DLG_PT, FolderDialog } from "../ChromeExt";
import { DP, DownyApp, PlacedDialog, Win, dlgPt } from "../DownyApp";
import { Captions, Hud, Keys, Pasted, Toast } from "../ui";
import { EXT_DIR } from "../Welcome";

// Step 4: add the extension. The camera moves between Downy on the left and Chrome on the right.
const W: Win = { x: 80, y: 90, z: 1.25 };
const K = { open: 46, address: 106, toggle: 204, copy: 268, load: 338, input: 384, select: 440, done: 598 };
const KEYS = { paste1: 120, enter: 148, paste2: 398 };
const CONNECTED = 548;
const CARD = { x: CH.x + 260, y: CH.y + CH.chrome + 64 + 56 + 24 + 92 };

export const AddExtension: React.FC = () => {
  const frame = useCurrentFrame();
  const open = dlgPt(W, "ext", ...DP.open);
  const copy = dlgPt(W, "ext", ...DP.copy);
  const done = dlgPt(W, "ext", ...DP.done);
  const status = dlgPt(W, "ext", ...DP.status);

  const camera = cam(frame, [
    [0, 1.05, 830, 568],
    [K.open + 12, 1.05, 830, 568],
    [96, 1.45, CH.x + 560, CH.y + 250],
    [150, 1.45, CH.x + 560, CH.y + 250],
    [176, 1, CH.x + 750, 540],
    [186, 1, CH.x + 750, 540],
    [200, 1.7, CH_PT.toggle.x - 300, CH_PT.toggle.y + 120],
    [K.toggle + 14, 1.7, CH_PT.toggle.x - 300, CH_PT.toggle.y + 120],
    [252, 1.35, copy.x - 120, copy.y - 40],
    [K.copy + 10, 1.35, copy.x - 120, copy.y - 40],
    [318, 1.35, CH_PT.load.x + 380, CH_PT.load.y + 160],
    [K.load + 6, 1.35, CH_PT.load.x + 380, CH_PT.load.y + 160],
    [366, 1.2, DLG.x + 480, DLG.y + 335],
    [K.select + 10, 1.2, DLG.x + 480, DLG.y + 335],
    [476, 1.35, CARD.x + 320, CARD.y + 40],
    [504, 1.35, CARD.x + 320, CARD.y + 40],
    [532, 1.5, status.x + 140, status.y - 40],
    [574, 1.5, status.x + 140, status.y - 40],
    [592, 1.05, 830, 568],
    [K.done + 4, 1.05, 830, 568],
    [640, 1, 830, 540],
  ]);
  const p = path(frame, [
    [0, open.x + 120, open.y + 170],
    [K.open - 8, open.x, open.y],
    [K.open + 8, open.x, open.y],
    [K.address - 8, CH_PT.address.x, CH_PT.address.y],
    [K.address + 8, CH_PT.address.x, CH_PT.address.y],
    [156, CH_PT.address.x + 60, CH_PT.address.y + 60],
    [K.toggle - 8, CH_PT.toggle.x, CH_PT.toggle.y],
    [K.toggle + 8, CH_PT.toggle.x, CH_PT.toggle.y],
    [K.copy - 8, copy.x, copy.y],
    [K.copy + 8, copy.x, copy.y],
    [K.load - 8, CH_PT.load.x, CH_PT.load.y],
    [K.load + 8, CH_PT.load.x, CH_PT.load.y],
    [K.input - 8, DLG_PT.input.x, DLG_PT.input.y],
    [K.input + 8, DLG_PT.input.x, DLG_PT.input.y],
    [K.select - 8, DLG_PT.select.x, DLG_PT.select.y],
    [K.select + 10, DLG_PT.select.x, DLG_PT.select.y],
    [500, CARD.x + 520, CARD.y + 160],
    [560, status.x + 470, status.y - 20],
    [K.done - 8, done.x, done.y],
  ]);

  const hlAt = (k: number) => tw(frame, [k - 10, k - 5], [0, 1]) * (1 - tw(frame, [k + 6, k + 12], [0, 1]));
  const pressAt = (k: number) => interpolate(frame, [k - 2, k, k + 6], [0, 1, 0], clamp);
  const [hl, hk] = frame < 150 ? ["open", K.open] : frame < 400 ? ["copy", K.copy] : ["done", K.done];
  const chrome = tw(frame, [56, 80], [0, 1]);
  const ext = frame >= KEYS.enter + 6;
  const leave = tw(frame, [K.done + 4, K.done + 18], [0, 1]);

  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={840 + camera.fx * 0.05} />
      <div style={camStyle(camera)}>
        <DownyApp w={W} backdrop={1 - leave}>
          <PlacedDialog step="ext" frame={frame} a={tw(frame, [0, 10], [0, 1]) * (1 - leave)} hl={hl} hlAmt={hlAt(hk)} press={pressAt(hk)} extOk={frame >= CONNECTED ? 1 : 0} />
          <Toast frame={frame} from={K.open + 4} to={130} text="Chrome is opening. chrome://extensions is copied, so paste it into the address bar." />
          <Toast frame={frame} from={K.copy + 4} to={340} text="Folder copied. Paste it into the Folder box after you click Load unpacked." />
        </DownyApp>

        <ChromeWindow
          page={ext ? "ext" : "newtab"}
          address={
            ext ? undefined : <Pasted frame={frame} at={KEYS.paste1 + 4} text="chrome://extensions" placeholder="Search or type a web address" caretFrom={K.address} color="#f1f0ff" />
          }
          focusAddr={frame >= K.address && !ext ? 1 : 0}
          dev={tw(frame, [K.toggle + 1, K.toggle + 10], [0, 1])}
          hlToggle={hlAt(K.toggle)}
          hlLoad={hlAt(K.load)}
          pressLoad={pressAt(K.load)}
          downy={tw(frame, [452, 470], [0, 1])}
          downyGlow={interpolate(frame, [452, 470, 520], [0, 1, 0], clamp)}
          style={{ opacity: chrome, scale: String(0.94 + chrome * 0.06), filter: `blur(${(1 - chrome) * 10}px)` }}
          dialog={
            <FolderDialog
              show={tw(frame, [K.load + 6, K.load + 22], [0, 1]) * (1 - tw(frame, [K.select + 2, K.select + 14], [0, 1]))}
              folder={<Pasted frame={frame} at={KEYS.paste2 + 4} text={EXT_DIR} caretFrom={K.input} color="#f1f0ff" />}
              focusInput={frame >= K.input ? 1 : 0}
              hlSelect={hlAt(K.select)}
              pressSelect={pressAt(K.select)}
            />
          }
        />
        <Cursor x={p.x} y={p.y} frame={frame} clicks={Object.values(K)} opacity={1 - tw(frame, [K.done + 10, K.done + 24], [0, 1])} />
      </div>

      <Keys frame={frame} at={KEYS.paste1} keys={["Ctrl", "V"]} x={960} y={780} />
      <Keys frame={frame} at={KEYS.enter} keys={["Enter"]} x={960} y={780} />
      <Keys frame={frame} at={KEYS.paste2} keys={["Ctrl", "V"]} x={960} y={780} />

      <Hud frame={frame} step={3} progress={frame / 650} />
      <Captions
        frame={frame}
        cues={[
          [4, K.open + 4, "Last step: the Chrome extension. Click [Open Chrome]"],
          [K.open + 8, K.address - 4, "Chrome opens, and [chrome://extensions] is copied for you"],
          [K.address - 2, 154, "Click the address bar, press [Ctrl] + [V], then [Enter]"],
          [158, 216, "Turn on [Developer mode] at the top right"],
          [220, 284, "Back in Downy, click [Copy folder]"],
          [288, 350, "In Chrome, click [Load unpacked]"],
          [354, 430, "Click the [Folder] box and press [Ctrl] + [V]"],
          [434, 500, "Click [Select Folder]. Downy shows up in your extensions"],
          [504, 584, "Back in Downy, the status turns green"],
          [588, 650, "Click [Done]. That's the whole setup"],
        ]}
      />

      {Object.values(K).map((k) => (
        <Sfx key={k} at={k} name="click" volume={0.9} />
      ))}
      <Sfx at={K.open + 4} name="tick-low" volume={0.35} />
      <Sfx at={58} name="whoosh" volume={0.4} />
      <Sfx at={60} name="pop-up" volume={0.4} />
      <Sfx at={KEYS.paste1} name="key" volume={0.7} />
      <Sfx at={KEYS.paste1 + 3} name="key" volume={0.8} />
      <Sfx at={KEYS.enter} name="key" volume={0.9} />
      <Sfx at={KEYS.enter + 6} name="whoosh-soft" volume={0.3} />
      <Sfx at={K.toggle + 1} name="toggle" volume={0.9} />
      <Sfx at={222} name="whoosh-soft" volume={0.35} />
      <Sfx at={K.copy + 4} name="tick-low" volume={0.35} />
      <Sfx at={292} name="whoosh-soft" volume={0.35} />
      <Sfx at={K.load + 6} name="pop-up" volume={0.45} />
      <Sfx at={KEYS.paste2} name="key" volume={0.7} />
      <Sfx at={KEYS.paste2 + 3} name="key" volume={0.8} />
      <Sfx at={K.select + 4} name="pop-down" volume={0.35} />
      <Sfx at={452} name="sparkle" volume={0.45} />
      <Sfx at={454} name="pop-up" volume={0.55} />
      <Sfx at={506} name="whoosh-soft" volume={0.35} />
      <Sfx at={CONNECTED} name="success" volume={0.65} />
      <Sfx at={K.done + 6} name="whoosh-soft" volume={0.3} />
      <Sfx at={K.done + 2} name="thump" volume={0.3} />
    </AbsoluteFill>
  );
};
