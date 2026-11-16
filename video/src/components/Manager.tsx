import { Img, staticFile } from "remotion";
import { C, inter } from "../theme";
import { Icon } from "./Icon";
import { SegBar } from "./SegBar";
import { Art } from "./Thumb";

// The main Downy window, from app/src/renderer/index.html. Natural size 1200 x 720.
export const WIN = { w: 1200, h: 720 };

export type RowState = {
  status: "starting" | "downloading" | "merging" | "done";
  fills: number[];
  pct: number;
  speed: string;
  eta: string;
  got: string;
  post: number;
  appear: number;
  flash: number;
  hoverPause?: number;
};

const NavItem: React.FC<{ icon: string; label: string; count?: string | number; current?: boolean; live?: boolean; sub?: boolean }> = ({
  icon,
  label,
  count,
  current,
  live,
  sub,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: sub ? "7px 10px 7px 34px" : "7px 10px",
      borderRadius: 10,
      fontSize: sub ? 13 : 13.5,
      color: current ? C.text : C.soft,
      background: current ? "linear-gradient(90deg, #8a7fe852, #6f8cff1f 60%, #6f8cff00)" : "transparent",
      boxShadow: current ? "inset 0 -14px 22px -16px #7864ff8c, inset 0 1px 0 #ffffff0a" : undefined,
    }}
  >
    <Icon name={icon} size={sub ? 14 : 16} color={current ? C.ink : C.muted} />
    <span>{label}</span>
    {count != null ? (
      <span style={{ marginLeft: "auto", fontSize: 12, color: live ? C.hi : C.muted, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    ) : null}
  </div>
);

const rowBox = (active: boolean): React.CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "128px minmax(0, 1fr) auto",
  gap: 16,
  alignItems: "center",
  padding: "12px 14px 12px 12px",
  borderRadius: 16,
  background: active
    ? `${C.glassTint}, color-mix(in srgb, #0b0a1e 78%, #0000)`
    : "linear-gradient(90deg, #8a7fe81c, #6f8cff0a 60%, #0000), color-mix(in srgb, #07061a 74%, #0000)",
  boxShadow: active ? C.glassShadow : "inset 0 1px 0 #ffffff0a",
  border: active ? "1px solid #b4aaff14" : "1px solid #ffffff0a",
});

const Kind: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      left: 6,
      bottom: 6,
      padding: "1px 7px",
      borderRadius: 6,
      fontSize: 11.5,
      fontWeight: 600,
      background: "#000000b3",
      color: C.text,
    }}
  >
    {children}
  </div>
);

const DoneRow: React.FC<{ art?: number; kind: string; title: string; where: string; size: string; when: string; file: string }> = (p) => (
  <div style={rowBox(false)}>
    <div style={{ position: "relative", width: 128, height: 72, borderRadius: 10, overflow: "hidden", background: C.track }}>
      {p.art != null ? (
        <Art v={p.art} />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "linear-gradient(150deg, #2a2660, #0d0b26)" }}>
          <Icon name="file" size={26} color={C.hi} stroke={1.5} style={{ marginBottom: 10 }} />
        </div>
      )}
      <Kind>{p.kind}</Kind>
    </div>
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
      <div style={{ display: "flex", gap: 14, color: C.muted, fontSize: 12.5 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.mint }}>
          <Icon name="check" size={13} />
          Saved to {p.where}
        </span>
        <span>{p.size}</span>
        <span>{p.when}</span>
      </div>
      <div style={{ color: C.faint, fontSize: 12 }}>{p.file}</div>
    </div>
    <div style={{ display: "flex", gap: 4 }}>
      {["open", "folder", "trash"].map((i) => (
        <div key={i} style={{ width: 34, height: 34, display: "grid", placeItems: "center", color: C.muted }}>
          <Icon name={i === "trash" ? "x" : i} size={16} />
        </div>
      ))}
    </div>
  </div>
);

const ActiveRow: React.FC<{ r: RowState }> = ({ r }) => {
  const done = r.status === "done";
  const mode = r.status === "merging" ? "post" : "live";
  const state =
    r.status === "starting"
      ? { icon: "arrowDown", text: "Starting", color: C.muted }
      : r.status === "downloading"
        ? { icon: "arrowDown", text: `${r.got} of 386 MB`, color: C.muted }
        : r.status === "merging"
          ? { icon: "layers", text: `Joining video and audio ${Math.round(r.post * 100)}%`, color: C.muted }
          : { icon: "check", text: "Saved to YouTube\\1080p", color: C.mint };
  return (
    <div
      style={{
        ...rowBox(!done),
        opacity: r.appear,
        translate: `0 ${(1 - r.appear) * -24}px`,
        boxShadow: `${rowBox(!done).boxShadow}, 0 0 0 ${r.flash}px #b4aaffcc, 0 0 ${32 * r.flash}px -4px #8a7fe8`,
      }}
    >
      <div style={{ position: "relative", width: 128, height: 72, borderRadius: 10, overflow: "hidden" }}>
        <Art v={1} t={0.4} />
        <Kind>1080p</Kind>
      </div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Sunrise above the Dolomites, a 4K drone film
        </div>
        <div style={{ display: "flex", gap: 14, color: C.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: state.color }}>
            <Icon name={state.icon} size={13} />
            {state.text}
          </span>
          {done ? <span>386 MB</span> : null}
          {done ? <span>Just now</span> : null}
        </div>
        {done ? (
          <div style={{ color: C.faint, fontSize: 12 }}>Sunrise above the Dolomites, a 4K drone film.mp4</div>
        ) : (
          <>
            <SegBar fills={mode === "post" ? [r.post] : r.fills} mode={mode} />
            <div style={{ display: "flex", gap: 14, color: C.faint, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {r.status === "merging" ? (
                <span>ffmpeg is joining the 1080p video and the audio</span>
              ) : (
                <>
                  <span>{r.fills.length} connections</span>
                  <span>Video, part 1 of 2</span>
                  <span>{r.pct}%</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {r.status === "downloading" ? (
          <div style={{ textAlign: "right", minWidth: 84, fontVariantNumeric: "tabular-nums" }}>
            <b style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{r.speed}</b>
            <span style={{ display: "block", color: C.muted, fontSize: 12 }}>{r.eta}</span>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 4 }}>
          {(done ? ["open", "folder", "x"] : ["pause", "x"]).map((i) => (
            <div
              key={i}
              style={{
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                color: i === "pause" && r.hoverPause ? C.text : C.muted,
                borderRadius: 10,
                background: i === "pause" && r.hoverPause ? "#b4aaff17" : "transparent",
              }}
            >
              <Icon name={i} size={16} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Hero: React.FC = () => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 80, boxSizing: "border-box" }}>
    <div style={{ textAlign: "center", marginBottom: 26 }}>
      <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.01em" }}>What should we download?</div>
      <div style={{ marginTop: 10, color: C.muted, fontSize: 15 }}>Paste any link, or download in Chrome as usual and Downy takes over</div>
    </div>
    <Composer />
  </div>
);

const Composer: React.FC = () => (
  <div
    style={{
      padding: "14px 14px 12px 18px",
      borderRadius: 22,
      background: `${C.glassTint}, ${C.glass}`,
      boxShadow: C.glassShadow,
    }}
  >
    <div style={{ fontSize: 16, color: "#8f8cab", padding: "4px 0 10px" }}>Paste a YouTube link or a file link</div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, color: C.faint, fontSize: 13 }}>
        <Icon name="link" size={15} />
        YouTube files are sorted by format, other files go into Downloads
      </span>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "radial-gradient(100% 60% at 50% 0%, #ffffff1f, #0000 70%), linear-gradient(150deg, #8a7fe880, #6f8cff26 60%, #4a3cc426), #0d0b26",
          boxShadow: "inset 0 1px 0 #ffffff26, inset 0 -8px 14px -10px #a99fffcc, 0 0 0 1px #b4aaff33",
        }}
      >
        <Icon name="arrowUp" size={16} />
      </div>
    </div>
  </div>
);

// `empty` draws the first-run window with no downloads yet. `children` go over the whole window, like a dialog.
export const ManagerWindow: React.FC<{ row?: RowState; running?: number; finished?: number; empty?: boolean; children?: React.ReactNode }> = ({
  row,
  running = 0,
  finished = 0,
  empty,
  children,
}) => (
  <div
    style={{
      position: "relative",
      width: WIN.w,
      height: WIN.h,
      overflow: "hidden",
      fontFamily: inter,
      fontSize: 14,
      lineHeight: 1.45,
      color: C.text,
      background: "#000",
    }}
  >
    <Img
      src={staticFile("sky.png")}
      style={{ position: "absolute", right: 0, bottom: 0, width: 1440, height: 810, imageRendering: "pixelated" }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: "linear-gradient(90deg, #000 1px, #0000 1px), linear-gradient(0deg, #000 1px, #0000 1px)",
        backgroundSize: "3px 3px",
        backgroundPosition: "right bottom",
      }}
    />
    <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.62 }} />

    <div style={{ position: "relative", height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14.5 }}>
        <Img src={staticFile("icon.png")} style={{ width: 20, height: 20 }} />
        <span style={{ color: C.muted }}>Downy</span>
        <span style={{ color: C.faint }}>/</span>
        <span style={{ fontWeight: 500 }}>Downloads</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", height: "100%", color: C.muted }}>
        <div style={{ width: 32, display: "grid", placeItems: "center" }}>
          <Icon name="sliders" size={16} />
        </div>
        <div style={{ width: 12 }} />
        {["minus", "square", "x"].map((i) => (
          <div key={i} style={{ width: 46, height: "100%", display: "grid", placeItems: "center" }}>
            <Icon name={i} size={15} stroke={1.6} />
          </div>
        ))}
      </div>
    </div>

    <div style={{ position: "relative", display: "flex", height: WIN.h - 44 }}>
      <div
        style={{
          width: 236,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          padding: "8px 10px 12px",
          background: "color-mix(in srgb, #05050f 40%, #0000)",
          borderRight: "1px solid #0d0d16",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem icon="layers" label="All downloads" count={empty ? undefined : 3} current />
          <NavItem icon="activity" label="Running" count={running || undefined} live />
          <NavItem icon="pauseCircle" label="Paused" />
          <NavItem icon="check" label="Finished" count={finished} />
          <NavItem icon="alert" label="Failed" />
        </div>
        <div style={{ color: C.faint, fontSize: 12, fontWeight: 500, padding: "18px 10px 6px" }}>Folders</div>
        {empty ? (
          <div style={{ color: C.faint, fontSize: 12.5, padding: "4px 10px", lineHeight: 1.5 }}>
            Finished files show up here. Files from Chrome go in Downloads, videos are sorted by format.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <NavItem icon="video" label="YouTube" count={finished - 1} />
            <NavItem icon="folder" label="1080p" count={finished - 2 || undefined} sub />
            <NavItem icon="music" label="MP3" count={1} sub />
            <NavItem icon="video" label="Videos" />
            <NavItem icon="folder" label="Downloads" count={1} />
          </div>
        )}
        <div style={{ marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 12, border: `1px solid ${C.line}`, background: "#03030a8c", color: C.muted }}>
            <Icon name="folder" size={16} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 11.5, color: C.faint }}>Saving to</span>
              <span style={{ fontSize: 12.5, color: C.soft }}>C:\Users\you\Videos\Downy</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: "4px 28px 28px" }}>
        {empty || !row ? (
          <Hero />
        ) : (
          <>
        <Composer />

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 4px 10px" }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>All downloads</span>
            <span style={{ color: C.muted, fontSize: 13 }}>3 files</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ActiveRow r={row} />
            <div style={{ translate: `0 ${(row.appear - 1) * 94}px`, display: "flex", flexDirection: "column", gap: 8 }}>
              <DoneRow art={2} kind="MP3" title="Lofi beats to code and relax to" where="YouTube\MP3" size="92.4 MB" when="Today, 14:02" file="Lofi beats to code and relax to.mp3" />
              <DoneRow kind="EXE" title="Downy-Setup-2.2.0.exe" where="Downloads" size="88.1 MB" when="Yesterday" file="Downy-Setup-2.2.0.exe" />
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
    {children}
  </div>
);
