import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cam, camStyle, clamp, inOut, path, rand, tw } from "../anim";
import { Browser } from "../components/Browser";
import { Cursor } from "../components/Cursor";
import { Icon } from "../components/Icon";
import { ManagerWindow, RowState, WIN } from "../components/Manager";
import { DownyOverlay } from "../components/Overlay";
import { PROMPT, PROMPT_GO, PROMPT_RECT, PromptCard } from "../components/PromptCard";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/Stage";
import { Art } from "../components/Thumb";
import { C, D, inter } from "../theme";
import { T, playT } from "./Browse";

// Where the big window ends up, in world pixels.
const WZ = 1520 / WIN.w;
const BIG = { x: (1920 - 1520) / 2, y: (1080 - WIN.h * WZ) / 2, w: 1520, h: WIN.h * WZ };
const ROW_CENTER = { x: BIG.x + 718 * WZ, y: BIG.y + 250 * WZ };

const M = {
  morph: [0, 34] as [number, number],
  row: 38,
  dl: [60, 192] as [number, number],
  merge: [196, 222] as [number, number],
  done: 224,
};

// Each connection runs at its own pace. When one finishes it helps the slowest, so they all end close together.
const SEG = Array.from({ length: 8 }, (_, i) => ({ d: rand(i + 40) * 14, e: rand(i + 50) * 22 }));

export const ManagerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const m = tw(frame, M.morph, [0, 1], inOut);
  const rect = {
    x: interpolate(m, [0, 1], [PROMPT_RECT.x, BIG.x]),
    y: interpolate(m, [0, 1], [PROMPT_RECT.y, BIG.y]),
    w: interpolate(m, [0, 1], [PROMPT_RECT.w, BIG.w]),
    h: interpolate(m, [0, 1], [PROMPT_RECT.h, BIG.h]),
  };

  const fills = SEG.map(({ d, e }) => tw(frame, [M.dl[0] + d, M.dl[1] - e], [0, 1], inOut));
  const progress = fills.reduce((a, b) => a + b, 0) / fills.length;
  const status: RowState["status"] =
    frame < M.dl[0] ? "starting" : frame < M.merge[0] ? "downloading" : frame < M.done ? "merging" : "done";
  const mbps = 24 + Math.sin(frame / 7) * 3.1 + Math.sin(frame / 3.3) * 1.4 + (frame > 80 && frame < 180 ? 6 : 0);
  const left = Math.max(1, Math.round(((1 - progress) * 386) / mbps));
  const row: RowState = {
    status,
    fills,
    pct: Math.floor(progress * 100),
    speed: `${mbps.toFixed(1)} MB/s`,
    eta: `${left} s left`,
    got: `${(progress * 386).toFixed(1)} MB`,
    post: tw(frame, M.merge, [0, 1], inOut),
    appear: tw(frame, [M.row, M.row + 16], [0, 1]),
    flash: interpolate(frame, [M.row, M.row + 6, M.row + 40], [0, 2, 0], clamp) + interpolate(frame, [M.done, M.done + 4, M.done + 40], [0, 2.5, 0], clamp),
  };

  const camera = cam(frame, [
    [0, 1, 960, 540],
    [M.dl[0] - 8, 1, 960, 540],
    [M.dl[0] + 30, 1.6, ROW_CENTER.x, ROW_CENTER.y],
    [M.done + 8, 1.6, ROW_CENTER.x, ROW_CENTER.y],
    [M.done + 40, 1, 960, 540],
  ]);

  const cursor = path(frame, [
    [0, PROMPT_GO.x + 6, PROMPT_GO.y + 6],
    [30, 1700, 1000],
  ]);

  const toast = tw(frame, [M.done + 30, M.done + 46], [0, 1]) * (1 - tw(frame, [D.manager - 18, D.manager - 4], [0, 1]));
  const segDone = SEG.map(({ e }) => Math.round(M.dl[1] - e));

  return (
    <AbsoluteFill>
      <Stage dim={0.6} drift={165 + 345} />
      <div style={camStyle(camera)}>
        <Browser
          page={1}
          playT={playT(T.end + frame)}
          style={{
            opacity: 1 - tw(frame, [6, 30], [0, 1]),
            filter: `blur(${5 + m * 10}px) brightness(0.5)`,
            scale: String(1 - m * 0.05),
          }}
          overlay={<DownyOverlay show={1} hoverMain={0} text="Confirm in Downy…" fill={0} menu={0} hoverItem={-1} />}
        />

        <div
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            borderRadius: interpolate(m, [0, 1], [18 * PROMPT.zoom, 22]),
            overflow: "hidden",
            boxShadow: `0 0 0 1px #b4aaff${m < 1 ? "33" : "22"}, 0 60px 140px -30px #000, 0 0 ${120 * Math.sin(m * Math.PI) + 60}px -20px #8a7fe8aa`,
            background: "#0b0a1e",
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, zoom: rect.w / WIN.w, opacity: tw(frame, [10, 28], [0, 1]) }}>
            <ManagerWindow row={row} running={status === "done" ? 0 : 1} finished={status === "done" ? 3 : 2} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              zoom: PROMPT.zoom,
              opacity: 1 - tw(frame, [2, 14], [0, 1]),
              filter: `blur(${tw(frame, [2, 14], [0, 6])}px)`,
            }}
          >
            <PromptCard hoverGo={1} pressGo={1 - tw(frame, [0, 6], [0, 1])} />
          </div>
        </div>

        <Cursor x={cursor.x} y={cursor.y} frame={frame} clicks={[]} opacity={1 - tw(frame, [8, 24], [0, 1])} />
      </div>

      <div
        style={{
          position: "absolute",
          right: 48,
          bottom: 48,
          width: 470,
          display: "flex",
          gap: 16,
          padding: 18,
          borderRadius: 16,
          fontFamily: inter,
          color: C.text,
          background: "linear-gradient(160deg, #8a7fe82a, #0000 45%), #0b0a1ef2",
          border: `1px solid ${C.lineAccent}`,
          boxShadow: "inset 0 1px 0 #ffffff0f, 0 30px 70px -20px #000",
          opacity: toast,
          translate: `${(1 - toast) * 60}px 0`,
          filter: `blur(${(1 - toast) * 6}px)`,
        }}
      >
        <div style={{ width: 120, height: 67, borderRadius: 10, overflow: "hidden", flex: "none" }}>
          <Art v={1} t={0.4} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 600 }}>
            <Icon name="check" size={18} color={C.mint} />
            Download finished
          </div>
          <div style={{ fontSize: 15, color: C.muted, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Saved to YouTube\1080p
          </div>
        </div>
      </div>

      <Sfx at={0} name="riser" volume={0.35} />
      <Sfx at={4} name="whoosh" volume={0.45} />
      <Sfx at={M.morph[1] - 4} name="thump" volume={0.4} />
      <Sfx at={M.row} name="pop-up" volume={0.6} />
      <Sfx at={M.dl[0] - 4} name="whoosh-soft" volume={0.3} />
      {segDone.map((f, i) => (
        <Sfx key={i} at={f} name="tick" volume={0.16 + i * 0.015} />
      ))}
      <Sfx at={M.merge[0]} name="tick-low" volume={0.35} />
      <Sfx at={M.done} name="success" volume={0.7} />
      <Sfx at={M.done + 30} name="pop-up" volume={0.45} />
      <Sfx at={M.done + 6} name="whoosh-soft" volume={0.3} />
    </AbsoluteFill>
  );
};

