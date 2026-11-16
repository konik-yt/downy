import { Img, staticFile } from "remotion";
import { B, Chrome } from "../components/Browser";
import { Icon } from "../components/Icon";
import { C, inter } from "../theme";

export const VERSION = "2.2.1";
export const SETUP_EXE = `Downy-Setup-${VERSION}.exe`;
const BODY_Y = B.y + B.chrome;

// World positions of the things the pointer clicks.
export const REL = {
  asset: { x: B.x + 190, y: BODY_Y + 354 },
  bubble: { x: B.x + B.w - 396, y: BODY_Y + 8, w: 380 },
  open: { x: B.x + B.w - 66, y: BODY_Y + 84 },
};
export const SMART = { x: 580, y: 230, w: 760, h: 440 };
export const SMART_MORE = { x: SMART.x + 92, y: SMART.y + 222 };
export const SMART_RUN = { x: SMART.x + 495, y: SMART.y + SMART.h - 50 };
export const WIZ = { x: 550, y: 230, w: 820, h: 540 };
export const WIZ_NEXT = { x: WIZ.x + WIZ.w - 199, y: WIZ.y + WIZ.h - 43 };

const ASSETS = [
  { name: SETUP_EXE, size: "92.1 MB", icon: "file" },
  { name: `Downy-${VERSION}-portable.exe`, size: "91.8 MB", icon: "file" },
  { name: "latest.yml", size: "0.4 KB", icon: "file" },
  { name: "Source code (zip)", size: "", icon: "folder" },
];

export const ReleasePage: React.FC<{ hoverAsset: number; press: number }> = ({ hoverAsset, press }) => (
  <div style={{ position: "absolute", inset: 0, top: B.chrome, padding: "0 40px", color: C.text, fontFamily: inter }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 64, fontSize: 20 }}>
      <Icon name="folder" size={20} color={C.muted} />
      <span style={{ color: "#8fb3ff" }}>konik-yt</span>
      <span style={{ color: C.faint }}>/</span>
      <span style={{ color: "#8fb3ff", fontWeight: 600 }}>downy</span>
      <span style={{ marginLeft: 10, padding: "1px 9px", border: `1px solid ${C.line}`, borderRadius: 12, fontSize: 13, color: C.muted }}>Public</span>
    </div>
    <div style={{ display: "flex", gap: 26, fontSize: 15, color: C.muted, borderBottom: "1px solid #ffffff14", height: 40 }}>
      {["Code", "Issues", "Pull requests", "Actions", "Releases"].map((t) => (
        <span key={t} style={{ color: t === "Releases" ? C.text : C.muted, borderBottom: t === "Releases" ? "2px solid #e8a07c" : undefined, paddingBottom: 10 }}>
          {t}
        </span>
      ))}
    </div>
    <div style={{ marginTop: 28, width: 1100, border: "1px solid #ffffff18", borderRadius: 12, background: "#0f0e1c" }}>
      <div style={{ padding: "22px 24px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 32, fontWeight: 700 }}>Downy {VERSION}</span>
          <span style={{ padding: "2px 10px", border: "1px solid #3fb950", color: "#3fb950", borderRadius: 14, fontSize: 13, fontWeight: 600 }}>Latest</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 14, color: C.muted }}>konik-yt released this 2 days ago · v{VERSION}</div>
        <div style={{ marginTop: 16, fontSize: 16, color: C.soft, lineHeight: 1.6 }}>
          Download <b>{SETUP_EXE}</b> to install Downy, or the portable exe to run it without installing.
        </div>
      </div>
      <div style={{ borderTop: "1px solid #ffffff14", padding: "14px 24px 6px", fontSize: 18, fontWeight: 600 }}>
        Assets <span style={{ marginLeft: 6, padding: "0 8px", borderRadius: 10, background: "#ffffff14", fontSize: 13, color: C.muted }}>4</span>
      </div>
      <div style={{ padding: "4px 12px 14px" }}>
        {ASSETS.map((a, i) => (
          <div
            key={a.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              height: 52,
              padding: "0 12px",
              borderRadius: 8,
              borderTop: i ? "1px solid #ffffff0d" : undefined,
              background: i === 0 ? `rgba(138,127,232,${hoverAsset * 0.16})` : undefined,
              boxShadow: i === 0 && hoverAsset ? `0 0 0 ${hoverAsset * 2}px #b4aaff88` : undefined,
              scale: i === 0 ? String(1 - press * 0.015) : undefined,
            }}
          >
            <Icon name={a.icon} size={18} color={C.muted} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#8fb3ff", textDecoration: i === 0 && hoverAsset > 0.5 ? "underline" : undefined }}>{a.name}</span>
            <span style={{ marginLeft: "auto", fontSize: 14, color: C.muted }}>{a.size}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const ReleaseBrowser: React.FC<{ hoverAsset: number; press: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  hoverAsset,
  press,
  style,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: B.x,
      top: B.y,
      width: B.w,
      height: B.h,
      borderRadius: 18,
      overflow: "hidden",
      background: "#0b0a14",
      fontFamily: inter,
      boxShadow: "0 0 0 1px #ffffff1a, 0 50px 120px -30px #000, 0 0 140px -40px #6f6cf066",
      ...style,
    }}
  >
    <Chrome url={`github.com/konik-yt/downy/releases/tag/v${VERSION}`} tab={`Release Downy ${VERSION}`} icon="gh" />
    <ReleasePage hoverAsset={hoverAsset} press={press} />
    {children}
  </div>
);

// Chrome's download bubble under the toolbar, in browser coordinates.
export const DownloadBubble: React.FC<{ show: number; progress: number; hoverOpen: number }> = ({ show, progress, hoverOpen }) => {
  const done = progress >= 1;
  return (
    <div
      style={{
        position: "absolute",
        left: REL.bubble.x - B.x,
        top: REL.bubble.y - B.y,
        width: REL.bubble.w,
        borderRadius: 14,
        background: "#1f1e33",
        boxShadow: "0 20px 50px -10px #000, 0 0 0 1px #ffffff14",
        color: C.text,
        fontFamily: inter,
        opacity: show,
        translate: `0 ${(1 - show) * -10}px`,
        transformOrigin: "top right",
        scale: String(0.95 + show * 0.05),
      }}
    >
      <div style={{ padding: "14px 18px 6px", fontSize: 14, fontWeight: 600 }}>Recent download history</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px 16px" }}>
        <div style={{ position: "relative", width: 36, height: 36, flex: "none" }}>
          <svg width="36" height="36" viewBox="0 0 36 36" style={{ position: "absolute", inset: 0 }}>
            <circle cx="18" cy="18" r="15" fill="none" stroke="#ffffff1a" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke={done ? C.mint : "#8fb3ff"}
              strokeWidth="3"
              strokeDasharray={`${Math.min(1, progress) * 94.2} 94.2`}
              transform="rotate(-90 18 18)"
              strokeLinecap="round"
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <Icon name={done ? "file" : "arrowDown"} size={15} color={done ? C.mint : "#8fb3ff"} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{SETUP_EXE}</div>
          <div style={{ fontSize: 13, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
            {done ? "92.1 MB · Done" : `${(progress * 92.1).toFixed(1)} of 92.1 MB`}
          </div>
        </div>
        <div
          style={{
            padding: "7px 14px",
            borderRadius: 16,
            fontSize: 13,
            fontWeight: 600,
            color: done ? "#0b0a1e" : C.faint,
            background: done ? (hoverOpen > 0.5 ? "#c9d8ff" : "#a8c0ff") : "#ffffff10",
          }}
        >
          Open
        </div>
      </div>
    </div>
  );
};

// The SmartScreen warning for an unsigned app, drawn in Downy's colors.
export const SmartScreen: React.FC<{ show: number; more: number; hoverRun: number; pressRun: number }> = ({ show, more, hoverRun, pressRun }) => (
  <div
    style={{
      position: "absolute",
      left: SMART.x,
      top: SMART.y,
      width: SMART.w,
      height: SMART.h,
      boxSizing: "border-box",
      padding: "34px 40px",
      background: "linear-gradient(160deg, #1f4f9a, #123a7a)",
      color: "#fff",
      fontFamily: inter,
      boxShadow: "0 40px 120px -20px #000, 0 0 0 1px #ffffff26",
      opacity: show,
      scale: String(0.96 + show * 0.04),
      filter: `blur(${(1 - show) * 8}px)`,
    }}
  >
    <div style={{ fontSize: 36, fontWeight: 300, letterSpacing: "-0.01em" }}>Windows protected your PC</div>
    <div style={{ marginTop: 22, fontSize: 18, lineHeight: 1.5, color: "#e3ecff" }}>
      Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.
    </div>
    <div style={{ position: "absolute", left: 40, top: 208, fontSize: 18, textDecoration: "underline", color: "#fff", opacity: 1 - more }}>More info</div>
    <div style={{ position: "absolute", left: 40, top: 208, fontSize: 18, lineHeight: 1.7, color: "#e3ecff", opacity: more, translate: `0 ${(1 - more) * 8}px` }}>
      <div>
        App: <span style={{ color: "#fff" }}>{SETUP_EXE}</span>
      </div>
      <div>
        Publisher: <span style={{ color: "#fff" }}>Unknown publisher</span>
      </div>
    </div>
    <div style={{ position: "absolute", right: 28, bottom: 28, display: "flex", gap: 12 }}>
      <div
        style={{
          width: 150,
          height: 44,
          display: "grid",
          placeItems: "center",
          fontSize: 17,
          border: "2px solid #ffffffb0",
          background: hoverRun > 0.5 ? "#ffffff2a" : "transparent",
          opacity: more,
          scale: String(1 - pressRun * 0.05),
        }}
      >
        Run anyway
      </div>
      <div style={{ width: 150, height: 44, display: "grid", placeItems: "center", fontSize: 17, border: "2px solid #ffffffb0" }}>Don't run</div>
    </div>
  </div>
);

// The installer, one page at a time: 0 install location, 1 installing, 2 finished.
export const Installer: React.FC<{ show: number; page: number; progress: number; hoverNext: number; pressNext: number }> = ({
  show,
  page,
  progress,
  hoverNext,
  pressNext,
}) => {
  const head =
    page === 0
      ? ["Choose Install Location", "Choose the folder in which to install Downy."]
      : page === 1
        ? ["Installing", "Please wait while Downy is being installed."]
        : ["Completing Downy Setup", "Downy has been installed on your computer."];
  const btn = (label: string, primary = false, disabled = false): React.ReactNode => (
    <div
      style={{
        width: 110,
        height: 38,
        display: "grid",
        placeItems: "center",
        borderRadius: 8,
        fontSize: 15,
        fontWeight: primary ? 600 : 400,
        color: disabled ? C.faint : primary ? "#fff" : C.soft,
        background: primary && !disabled ? (hoverNext > 0.5 ? "linear-gradient(90deg, #948df0, #7f9bff)" : C.primary) : "#ffffff0d",
        border: primary && !disabled ? "none" : `1px solid ${C.line}`,
        scale: primary ? String(1 - pressNext * 0.05) : undefined,
        boxShadow: primary && !disabled ? `0 0 ${hoverNext * 22}px #8a7fe8aa` : undefined,
      }}
    >
      {label}
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: WIZ.x,
        top: WIZ.y,
        width: WIZ.w,
        height: WIZ.h,
        borderRadius: 12,
        overflow: "hidden",
        background: "#12112a",
        color: C.text,
        fontFamily: inter,
        boxShadow: "0 40px 120px -20px #000, 0 0 0 1px #b4aaff2a",
        opacity: show,
        scale: String(0.95 + show * 0.05),
        translate: `0 ${(1 - show) * 30}px`,
        filter: `blur(${(1 - show) * 8}px)`,
      }}
    >
      <div style={{ height: 40, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", background: "#0b0a1e", fontSize: 14, color: C.muted }}>
        <Img src={staticFile("icon.png")} style={{ width: 18, height: 18 }} />
        Downy Setup
        <span style={{ marginLeft: "auto" }}>
          <Icon name="x" size={15} />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "22px 28px", borderBottom: `1px solid ${C.line}`, background: "linear-gradient(90deg, #8a7fe81c, #0000)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{head[0]}</div>
          <div style={{ fontSize: 15, color: C.muted, marginTop: 4 }}>{head[1]}</div>
        </div>
        <Img src={staticFile("icon.png")} style={{ width: 54, height: 54 }} />
      </div>
      <div style={{ padding: "26px 28px", fontSize: 15, color: C.soft, height: 300, boxSizing: "border-box" }}>
        {page === 0 ? (
          <>
            <div style={{ lineHeight: 1.6 }}>Setup will install Downy in the following folder. To install in a different folder, click Browse and select another folder.</div>
            <div style={{ marginTop: 34, fontSize: 14, color: C.muted }}>Destination Folder</div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <div style={{ flex: 1, height: 40, display: "flex", alignItems: "center", padding: "0 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#03030a8c" }}>
                C:\Users\you\AppData\Local\Programs\Downy
              </div>
              {btn("Browse...")}
            </div>
            <div style={{ marginTop: 22, fontSize: 14, color: C.muted }}>Space required: 312 MB</div>
          </>
        ) : page === 1 ? (
          <>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 12 }}>Extract: Downy.exe... {Math.round(progress * 100)}%</div>
            <div style={{ height: 14, borderRadius: 4, background: "#1d1a4a", overflow: "hidden" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", background: "linear-gradient(90deg, #6f6cf0, #a99fff)" }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ lineHeight: 1.6 }}>Click Finish to close Setup.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 30 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: C.primary }}>
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 7.5 6 10l5-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{ fontSize: 16, color: C.text }}>Run Downy</span>
            </div>
          </>
        )}
      </div>
      <div style={{ position: "absolute", right: 24, bottom: 24, display: "flex", gap: 10 }}>
        {btn("< Back", false, page !== 0)}
        {btn(page === 0 ? "Install" : page === 1 ? "Next >" : "Finish", true, page === 1)}
        {btn("Cancel", false, page === 2)}
      </div>
    </div>
  );
};
