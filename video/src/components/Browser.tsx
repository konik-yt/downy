import { Img, staticFile } from "remotion";
import { C, inter } from "../theme";
import { Icon } from "./Icon";
import { Art, VIDEOS } from "./Thumb";

// Layout of the browser in world pixels (1920 x 1080 before the camera).
export const B = { x: 160, y: 70, w: 1600, h: 940, chrome: 96 };
export const HOME = { top: 88, pad: 40, gap: 28, cardW: 359, thumbH: 202, rowH: 300 };
export const homeCard = (i: number) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const x = B.x + HOME.pad + col * (HOME.cardW + HOME.gap);
  const y = B.y + B.chrome + HOME.top + row * HOME.rowH;
  return { x, y, cx: x + HOME.cardW / 2, cy: y + HOME.thumbH / 2 };
};
export const PLAYER = { x: B.x + 40, y: B.y + B.chrome + 24, w: 1060, h: 596 };

const Chrome: React.FC<{ url: string; tab: string }> = ({ url, tab }) => (
  <div style={{ height: B.chrome, background: "#0e0d1a", borderBottom: "1px solid #ffffff10" }}>
    <div style={{ height: 44, display: "flex", alignItems: "flex-end", padding: "0 14px", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignSelf: "center", marginRight: 14 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c, opacity: 0.85 }} />
        ))}
      </div>
      <div
        style={{
          height: 36,
          width: 260,
          borderRadius: "10px 10px 0 0",
          background: "#1b1a2c",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          color: C.soft,
          fontSize: 14,
        }}
      >
        <div style={{ width: 16, height: 16, borderRadius: 4, background: "#e5484d", display: "grid", placeItems: "center" }}>
          <div style={{ width: 0, height: 0, borderLeft: "6px solid #fff", borderTop: "4px solid transparent", borderBottom: "4px solid transparent", marginLeft: 1 }} />
        </div>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{tab}</span>
        <Icon name="x" size={14} color={C.muted} />
      </div>
    </div>
    <div style={{ height: 52, background: "#1b1a2c", display: "flex", alignItems: "center", gap: 14, padding: "0 16px" }}>
      <Icon name="chevLeft" size={20} color={C.muted} />
      <Icon name="chevRight" size={20} color={C.faint} />
      <Icon name="refresh" size={18} color={C.muted} />
      <div
        style={{
          flex: 1,
          height: 36,
          borderRadius: 18,
          background: "#0e0d1a",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          fontSize: 15,
          color: C.soft,
        }}
      >
        <Icon name="lock" size={14} color={C.muted} />
        <span>{url}</span>
      </div>
      <Img src={staticFile("icon.png")} style={{ width: 22, height: 22 }} />
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #8fdcc0, #6f8cff)" }} />
    </div>
  </div>
);

const Home: React.FC<{ hover: number; hoverAmt: number; press: number }> = ({ hover, hoverAmt, press }) => (
  <div style={{ position: "absolute", inset: 0, padding: `0 ${HOME.pad}px` }}>
    <div style={{ display: "flex", gap: 12, height: HOME.top, alignItems: "center" }}>
      {["All", "Travel", "Music", "Live", "Cooking", "Science", "Drone films", "Recently uploaded"].map((c, i) => (
        <div
          key={c}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 500,
            background: i === 0 ? C.text : "#ffffff14",
            color: i === 0 ? "#0b0a1e" : C.soft,
          }}
        >
          {c}
        </div>
      ))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(4, ${HOME.cardW}px)`, columnGap: HOME.gap, rowGap: HOME.rowH - HOME.thumbH - 98 }}>
      {VIDEOS.map((v, i) => {
        const h = i === hover ? hoverAmt : 0;
        return (
          <div key={i} style={{ height: HOME.thumbH + 98 }}>
            <div
              style={{
                position: "relative",
                height: HOME.thumbH,
                borderRadius: 14,
                overflow: "hidden",
                scale: String(1 + h * 0.035 - (i === hover ? press * 0.03 : 0)),
                boxShadow: h > 0 ? `0 0 0 ${3 * h}px #b4aaff, 0 20px 50px -10px #8a7fe8${Math.round(h * 160).toString(16).padStart(2, "0")}` : "none",
              }}
            >
              <Art v={i} />
              <div style={{ position: "absolute", right: 8, bottom: 8, padding: "2px 6px", borderRadius: 5, background: "#000000cc", color: "#fff", fontSize: 13, fontWeight: 600 }}>
                {v.len}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", flex: "none", background: `hsl(${i * 47 + 220} 60% 62%)` }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.text, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {v.title}
                </div>
                <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                  {v.channel} · {v.views}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const Watch: React.FC<{ t: number; children?: React.ReactNode }> = ({ t, children }) => {
  const v = VIDEOS[1];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          left: PLAYER.x - B.x,
          top: PLAYER.y - B.y - B.chrome,
          width: PLAYER.w,
          height: PLAYER.h,
          borderRadius: 16,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <Art v={1} t={t} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, background: "linear-gradient(#0000, #000000b0)" }} />
        <div style={{ position: "absolute", left: 20, right: 20, bottom: 50, height: 5, borderRadius: 3, background: "#ffffff40" }}>
          <div style={{ width: `${8 + t * 30}%`, height: "100%", borderRadius: 3, background: C.text }} />
        </div>
        <div style={{ position: "absolute", left: 22, bottom: 16, display: "flex", gap: 18, alignItems: "center", color: "#fff", fontSize: 15 }}>
          <Icon name="pause" size={20} color="#fff" />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            1:{String(Math.floor(2 + t * 9)).padStart(2, "0")} / 12:41
          </span>
        </div>
        {children}
      </div>
      <div style={{ position: "absolute", left: PLAYER.x - B.x, top: PLAYER.y - B.y - B.chrome + PLAYER.h + 20, width: PLAYER.w }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.text }}>{v.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "hsl(267 60% 62%)" }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>{v.channel}</div>
            <div style={{ fontSize: 14, color: C.muted }}>418K subscribers</div>
          </div>
          <div style={{ marginLeft: 18, padding: "9px 18px", borderRadius: 20, background: C.text, color: "#0b0a1e", fontWeight: 600, fontSize: 15 }}>Subscribe</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {[["thumb", "24K"], ["share", "Share"]].map(([ic, label]) => (
              <div key={label} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 16px", borderRadius: 20, background: "#ffffff14", color: C.soft, fontSize: 15 }}>
                <Icon name={ic} size={17} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: PLAYER.x - B.x + PLAYER.w + 32, top: 24, right: 40, display: "flex", flexDirection: "column", gap: 14 }}>
        {[7, 0, 5, 3, 6].map((i) => (
          <div key={i} style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 176, height: 99, borderRadius: 10, overflow: "hidden", flex: "none" }}>
              <Art v={i} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {VIDEOS[i].title}
              </div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{VIDEOS[i].channel}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{VIDEOS[i].views}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// The browser window. `page` goes from 0 (home) to 1 (watch page).
export const Browser: React.FC<{
  page: number;
  hover?: number;
  hoverAmt?: number;
  press?: number;
  playT?: number;
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ page, hover = -1, hoverAmt = 0, press = 0, playT = 0, overlay, style }) => (
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
    <Chrome
      url={page < 0.5 ? "youtube.com" : "youtube.com/watch?v=dlm4KSunrise"}
      tab={page < 0.5 ? "YouTube" : `${VIDEOS[1].title} - YouTube`}
    />
    <div style={{ position: "absolute", left: 0, right: 0, top: B.chrome, bottom: 0, overflow: "hidden" }}>
      {page < 1 ? (
        <div style={{ position: "absolute", inset: 0, opacity: 1 - page, translate: `0 ${-page * 40}px`, filter: `blur(${page * 8}px)` }}>
          <Home hover={hover} hoverAmt={hoverAmt} press={press} />
        </div>
      ) : null}
      {page > 0 ? (
        <div style={{ position: "absolute", inset: 0, opacity: page, translate: `0 ${(1 - page) * 40}px`, filter: `blur(${(1 - page) * 8}px)` }}>
          <Watch t={playT}>{overlay}</Watch>
        </div>
      ) : null}
    </div>
  </div>
);
