import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, path, tw } from "../anim";
import { Browser, PLAYER, homeCard } from "../components/Browser";
import { Cursor } from "../components/Cursor";
import { DownyOverlay } from "../components/Overlay";
import { PROMPT, PROMPT_FORMAT, PROMPT_GO, PROMPT_RECT, PromptCard } from "../components/PromptCard";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/Stage";

// Frames inside this scene.
export const T = {
  click1: 62,
  page: [68, 94] as [number, number],
  pill: 118,
  click2: 158,
  menu: [160, 176] as [number, number],
  items: [184, 196, 208] as number[], // the pointer reaches menu items 1, 2 and 3
  click3: 220,
  prompt: 240,
  click4: 326,
  end: 345,
};

// The video in the player keeps playing; Manager.tsx continues from the same clock.
export const playT = (f: number) => interpolate(f, [T.page[0], 900], [0, 1], clamp);

// Where the pointer is in world pixels.
export const POS = {
  start: [1560, 1010] as const,
  card: [homeCard(1).cx + 30, homeCard(1).cy + 20] as const,
  pill: [PLAYER.x + PLAYER.w - 205, PLAYER.y + 43] as const,
  item: (i: number) => [PLAYER.x + PLAYER.w - 250, PLAYER.y + 154 + i * 47.7] as const,
};

export const BackdropDim = (frame: number) => tw(frame, [T.prompt - 12, T.prompt + 14], [0, 1]);

export const Browse: React.FC = () => {
  const frame = useCurrentFrame();
  const page = tw(frame, T.page, [0, 1]);

  const camera = cam(frame, [
    [0, 1, 960, 540],
    [T.page[1], 1, 960, 540],
    [T.pill + 8, 1.55, 1010, 400],
    [T.click3 + 2, 1.55, 1010, 400],
    [T.prompt + 16, 1, 960, 540],
  ]);

  const p = path(frame, [
    [14, ...POS.start],
    [56, ...POS.card],
    [T.click1 + 6, ...POS.card],
    [T.page[1] + 6, 1180, 760],
    [T.pill + 4, 1140, 470],
    [T.click2 - 6, ...POS.pill],
    [T.menu[1] + 2, ...POS.pill],
    [T.items[0], ...POS.item(0)],
    [T.items[1], ...POS.item(1)],
    [T.items[2], ...POS.item(2)],
    [T.click3 + 4, ...POS.item(2)],
    [T.prompt + 10, 1320, 780],
    [282, PROMPT_FORMAT.x + 160, PROMPT_FORMAT.y + 8],
    [292, PROMPT_FORMAT.x + 160, PROMPT_FORMAT.y + 8],
    [T.click4 - 8, PROMPT_GO.x + 6, PROMPT_GO.y + 6],
  ]);

  const hoverCard = tw(frame, [46, 58], [0, 1]) * (1 - page);
  const press1 = interpolate(frame, [T.click1 - 3, T.click1, T.click1 + 6], [0, 1, 0], clamp);
  const showPill = tw(frame, [T.pill, T.pill + 12], [0, 1]);
  const hoverMain = interpolate(frame, [T.click2 - 10, T.click2 - 6, T.menu[1]], [0, 1, 1], clamp) * (frame < T.click3 ? 1 : 0);
  const menu = tw(frame, T.menu, [0, 1]) * (1 - tw(frame, [T.click3 + 2, T.click3 + 12], [0, 1]));
  const hoverItem = frame >= T.items[2] - 4 ? 2 : frame >= T.items[1] - 4 ? 1 : frame >= T.items[0] - 4 ? 0 : -1;
  const dim = BackdropDim(frame);
  const promptIn = tw(frame, [T.prompt, T.prompt + 22], [0, 1]);
  const hoverGo = tw(frame, [T.click4 - 12, T.click4 - 8], [0, 1]);
  const pressGo = interpolate(frame, [T.click4 - 2, T.click4 + 1, T.end], [0, 1, 1], clamp);
  const formatFocus = interpolate(frame, [276, 282, 296, 302], [0, 1, 1, 0], clamp);
  const enter = tw(frame, [0, 34], [0, 1]);

  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={165} />
      <div style={camStyle(camera)}>
        <Browser
          page={page}
          hover={1}
          hoverAmt={hoverCard}
          press={press1}
          playT={playT(frame)}
          style={{
            opacity: enter,
            transform: `perspective(2200px) rotateX(${(1 - enter) * 14}deg) translateY(${(1 - enter) * 120}px) scale(${0.9 + enter * 0.1})`,
            filter: `blur(${dim * 5}px) brightness(${1 - dim * 0.5})`,
          }}
          overlay={
            <DownyOverlay
              show={showPill}
              hoverMain={hoverMain}
              text={frame >= T.click3 + 4 ? "Confirm in Downy…" : "Download this video"}
              fill={0}
              menu={menu}
              hoverItem={hoverItem}
            />
          }
        />
        {promptIn > 0 ? (
          <div
            style={{
              position: "absolute",
              left: PROMPT_RECT.x / PROMPT.zoom,
              top: PROMPT_RECT.y / PROMPT.zoom,
              zoom: PROMPT.zoom,
              opacity: promptIn,
              transform: `translateY(${(1 - promptIn) * -28}px) scale(${0.96 + promptIn * 0.04})`,
              filter: `blur(${(1 - promptIn) * 8}px) drop-shadow(0 30px 60px #000000cc)`,
            }}
          >
            <PromptCard hoverGo={hoverGo} pressGo={pressGo} formatFocus={formatFocus} />
          </div>
        ) : null}
        <Cursor x={p.x} y={p.y} frame={frame} clicks={[T.click1, T.click2, T.click3, T.click4]} opacity={tw(frame, [12, 22], [0, 1])} />
      </div>

      <Sfx at={2} name="whoosh-soft" volume={0.35} />
      <Sfx at={T.click1} name="click" volume={0.9} />
      <Sfx at={T.page[0]} name="whoosh-soft" volume={0.4} />
      <Sfx at={T.pill} name="pop-up" volume={0.65} />
      <Sfx at={T.click2} name="click" volume={0.9} />
      <Sfx at={T.menu[0] + 1} name="pop-down" volume={0.4} />
      {T.items.map((f) => (
        <Sfx key={f} at={f - 4} name="tick" volume={0.35} />
      ))}
      <Sfx at={T.click3} name="click" volume={0.9} />
      <Sfx at={T.click3 + 6} name="whoosh" volume={0.4} />
      <Sfx at={T.prompt} name="chime" volume={0.55} />
      <Sfx at={T.prompt} name="pop-up" volume={0.4} />
      <Sfx at={282} name="tick-low" volume={0.3} />
      <Sfx at={T.click4} name="click" volume={1} />
    </AbsoluteFill>
  );
};
