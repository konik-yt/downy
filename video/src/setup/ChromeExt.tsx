import { Img, staticFile } from "remotion";
import { Chrome } from "../components/Browser";
import { Icon } from "../components/Icon";
import { C, inter } from "../theme";
import { VERSION } from "./Release";

// The Chrome window in the extension scene, in world pixels.
export const CH = { x: 1780, y: 90, w: 1500, h: 900, chrome: 96 };
const BODY = CH.y + CH.chrome;
export const CH_PT = {
  address: { x: CH.x + 420, y: CH.y + 70 },
  toggle: { x: CH.x + CH.w - 60, y: BODY + 32 },
  load: { x: CH.x + 115, y: BODY + 92 },
};
export const DLG = { x: CH.x + 270, y: CH.y + 150, w: 960, h: 620 };
export const DLG_PT = {
  input: { x: DLG.x + 420, y: DLG.y + DLG.h - 86 },
  select: { x: DLG.x + DLG.w - 204, y: DLG.y + DLG.h - 38 },
};

const Toggle: React.FC<{ on: number; glow?: number }> = ({ on, glow = 0 }) => (
  <div
    style={{
      position: "relative",
      width: 40,
      height: 22,
      borderRadius: 11,
      background: on > 0.5 ? "#8fb3ff" : "#4a4860",
      boxShadow: glow ? `0 0 0 ${glow * 3}px #b4aaff99, 0 0 ${glow * 20}px #8a7fe8` : undefined,
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 3,
        left: 3 + on * 18,
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: on > 0.5 ? "#0b1a3a" : "#c9c7d8",
      }}
    />
  </div>
);

const Card: React.FC<{ name: string; ver: string; desc: string; icon: React.ReactNode; from?: string; style?: React.CSSProperties; glow?: number }> = ({
  name,
  ver,
  desc,
  icon,
  from,
  style,
  glow = 0,
}) => (
  <div
    style={{
      position: "absolute",
      width: 440,
      height: 184,
      boxSizing: "border-box",
      padding: 20,
      borderRadius: 12,
      background: "#1d1c2e",
      boxShadow: `0 0 0 1px #ffffff12, 0 0 0 ${glow * 3}px #b4aaffaa, 0 0 ${glow * 50}px #8a7fe8`,
      ...style,
    }}
  >
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ width: 44, height: 44, flex: "none", borderRadius: 10, overflow: "hidden" }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{name}</span>
          <span style={{ fontSize: 13, color: C.muted }}>{ver}</span>
        </div>
        <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
        {from ? <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Loaded from: {from}</div> : null}
      </div>
    </div>
    <div style={{ position: "absolute", left: 20, right: 20, bottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
      {["Details", "Remove"].map((b) => (
        <span key={b} style={{ padding: "6px 14px", borderRadius: 16, border: "1px solid #ffffff22", fontSize: 13, color: "#8fb3ff" }}>
          {b}
        </span>
      ))}
      <span style={{ marginLeft: "auto" }}>
        <Toggle on={1} />
      </span>
    </div>
  </div>
);

export const ChromeWindow: React.FC<{
  page: "newtab" | "ext";
  address?: React.ReactNode;
  focusAddr?: number;
  dev: number;
  hlToggle?: number;
  hlLoad?: number;
  pressLoad?: number;
  downy: number;
  downyGlow?: number;
  dialog?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ page, address, focusAddr = 0, dev, hlToggle = 0, hlLoad = 0, pressLoad = 0, downy, downyGlow = 0, dialog, style }) => {
  const shift = 56 * dev;
  return (
    <div
      style={{
        position: "absolute",
        left: CH.x,
        top: CH.y,
        width: CH.w,
        height: CH.h,
        borderRadius: 18,
        overflow: "hidden",
        background: "#12111f",
        color: C.text,
        fontFamily: inter,
        boxShadow: "0 0 0 1px #ffffff1a, 0 50px 120px -30px #000, 0 0 140px -40px #6f6cf066",
        ...style,
      }}
    >
      <Chrome url="chrome://extensions" tab={page === "ext" ? "Extensions" : "New Tab"} icon={page === "ext" ? "ext" : "blank"} address={address} focus={focusAddr} />
      {page === "newtab" ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: CH.chrome, bottom: 0, display: "grid", placeItems: "center" }}>
          <div style={{ width: 560, height: 48, borderRadius: 24, background: "#1d1c2e", display: "flex", alignItems: "center", gap: 12, padding: "0 20px", color: C.faint, fontSize: 16, marginBottom: 120 }}>
            <Icon name="search" size={18} />
            Search or type a web address
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 0, right: 0, top: CH.chrome, bottom: 0 }}>
          <div style={{ height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 24px", borderBottom: "1px solid #ffffff10", background: "#18172a" }}>
            <Icon name="menu" size={22} color={C.muted} />
            <span style={{ fontSize: 22, fontWeight: 500 }}>Extensions</span>
            <div style={{ marginLeft: 220, width: 520, height: 40, borderRadius: 20, background: "#0e0d1a", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", color: C.faint, fontSize: 15 }}>
              <Icon name="search" size={16} />
              Search extensions
            </div>
            <span style={{ marginLeft: "auto", fontSize: 15, color: C.soft }}>Developer mode</span>
            <Toggle on={dev} glow={hlToggle} />
          </div>
          <div style={{ height: 56 * dev, overflow: "hidden", borderBottom: dev ? "1px solid #ffffff10" : undefined, opacity: dev }}>
            <div style={{ height: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 40px" }}>
              {["Load unpacked", "Pack extension", "Update"].map((b, i) => (
                <span
                  key={b}
                  style={{
                    width: i === 0 ? 150 : undefined,
                    padding: i === 0 ? "8px 0" : "8px 18px",
                    textAlign: "center",
                    borderRadius: 18,
                    border: "1px solid #ffffff26",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#8fb3ff",
                    background: i === 0 && hlLoad > 0.5 ? "#8fb3ff22" : undefined,
                    boxShadow: i === 0 && hlLoad ? `0 0 0 ${hlLoad * 2}px #b4aaff99, 0 0 ${hlLoad * 24}px #8a7fe8` : undefined,
                    scale: i === 0 ? String(1 - pressLoad * 0.06) : undefined,
                    boxSizing: "border-box",
                  }}
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 64 + shift + 24, bottom: 0 }}>
            <Card
              name="Downy"
              ver={VERSION}
              desc="Puts a Download this video button on videos and hands Chrome downloads to Downy."
              from="~\AppData\Roaming\Downy\Chrome extension"
              icon={<Img src={staticFile("icon.png")} style={{ width: 44, height: 44 }} />}
              glow={downyGlow}
              style={{ left: 40, top: 0, opacity: downy, scale: String(0.9 + downy * 0.1), filter: `blur(${(1 - downy) * 8}px)` }}
            />
            {[
              { name: "Tab Shelf", ver: "3.4.0", desc: "Saves your open tabs into tidy groups.", color: "linear-gradient(135deg, #8fdcc0, #3a8f7a)" },
              { name: "Quiet Read", ver: "1.9.2", desc: "Turns busy pages into calm, readable text.", color: "linear-gradient(135deg, #e8c27c, #b07a3a)" },
            ].map((c, i) => (
              <Card
                key={c.name}
                {...c}
                icon={<div style={{ width: 44, height: 44, background: c.color }} />}
                style={{ left: 40 + (i + Math.min(1, downy * 1.6)) * 470, top: 0 }}
              />
            ))}
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
};

const FOLDERS = ["Contacts", "Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos"];

// Windows' folder picker, in Downy's colors, drawn in Chrome window coordinates.
export const FolderDialog: React.FC<{ show: number; folder: React.ReactNode; focusInput: number; hlSelect: number; pressSelect: number }> = ({
  show,
  folder,
  focusInput,
  hlSelect,
  pressSelect,
}) => (
  <div
    style={{
      position: "absolute",
      left: DLG.x - CH.x,
      top: DLG.y - CH.y,
      width: DLG.w,
      height: DLG.h,
      borderRadius: 10,
      overflow: "hidden",
      background: "#1a1930",
      color: C.text,
      fontFamily: inter,
      boxShadow: "0 40px 120px -10px #000, 0 0 0 1px #ffffff24",
      opacity: show,
      scale: String(0.96 + show * 0.04),
      filter: `blur(${(1 - show) * 8}px)`,
    }}
  >
    <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 16px", fontSize: 14, background: "#121124" }}>
      Select the extension directory.
      <span style={{ marginLeft: "auto", color: C.muted }}>
        <Icon name="x" size={15} />
      </span>
    </div>
    <div style={{ height: 48, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", borderBottom: "1px solid #ffffff10", color: C.muted, fontSize: 14 }}>
      <Icon name="chevLeft" size={18} />
      <Icon name="chevRight" size={18} />
      <Icon name="arrowUp" size={16} />
      <div style={{ flex: 1, height: 32, borderRadius: 6, background: "#0e0d1a", display: "flex", alignItems: "center", padding: "0 12px", color: C.soft }}>
        This PC › Local Disk (C:) › Users › you
      </div>
    </div>
    <div style={{ display: "flex", height: DLG.h - 40 - 48 - 130 }}>
      <div style={{ width: 210, padding: "12px 8px", borderRight: "1px solid #ffffff10", fontSize: 14, color: C.soft, display: "flex", flexDirection: "column", gap: 4 }}>
        {["Home", "Desktop", "Downloads", "Documents", "Pictures", "This PC"].map((n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6 }}>
            <Icon name="folder" size={16} color="#e8c27c" />
            {n}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "8px 12px", fontSize: 14 }}>
        <div style={{ display: "flex", color: C.faint, fontSize: 13, padding: "4px 10px 8px" }}>
          <span style={{ flex: 1 }}>Name</span>
          <span style={{ width: 180 }}>Date modified</span>
        </div>
        {FOLDERS.map((n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, height: 32, padding: "0 10px", color: C.soft }}>
            <Icon name="folder" size={16} color="#e8c27c" />
            <span style={{ flex: 1 }}>{n}</span>
            <span style={{ width: 180, color: C.faint, fontSize: 13 }}>11/14/2026 9:12 PM</span>
          </div>
        ))}
      </div>
    </div>
    <div style={{ position: "absolute", left: 24, right: 24, bottom: 68, height: 36, display: "flex", alignItems: "center", gap: 14, fontSize: 14 }}>
      <span style={{ width: 52, color: C.soft }}>Folder:</span>
      <div
        style={{
          flex: 1,
          height: 36,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderRadius: 6,
          background: "#0e0d1a",
          border: `1px solid ${focusInput ? "#8fb3ff" : "#ffffff1a"}`,
          boxShadow: focusInput ? `0 0 0 ${focusInput * 3}px #8fb3ff44` : undefined,
          overflow: "hidden",
        }}
      >
        {folder}
      </div>
    </div>
    <div style={{ position: "absolute", right: 24, bottom: 20, display: "flex", gap: 10 }}>
      <span
        style={{
          width: 140,
          height: 36,
          display: "grid",
          placeItems: "center",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          color: "#0b0a1e",
          background: hlSelect > 0.5 ? "#c9d8ff" : "#a8c0ff",
          boxShadow: hlSelect ? `0 0 ${hlSelect * 24}px #8fb3ff` : undefined,
          scale: String(1 - pressSelect * 0.06),
        }}
      >
        Select Folder
      </span>
      <span style={{ width: 100, height: 36, display: "grid", placeItems: "center", borderRadius: 6, fontSize: 14, border: "1px solid #ffffff22", color: C.soft }}>Cancel</span>
    </div>
  </div>
);
