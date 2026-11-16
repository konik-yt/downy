import { Img, staticFile } from "remotion";
import { Icon } from "../components/Icon";
import { C, inter, mono } from "../theme";

// The first-run dialog from app/src/renderer/index.html, drawn inside the 1200 x 720 window.
export type Tool = { name: string; state: "missing" | "busy" | "found"; text: string; bar?: number };
export type WelcomeProps = {
  step: "folder" | "tools" | "ext";
  hl?: string; // the button the pointer is on
  hlAmt?: number;
  press?: number;
  tools?: Tool[];
  toolStatus?: { text: string; tone: "" | "wait" | "ok" };
  installLabel?: string;
  extOk?: number; // 0 waiting, 1 connected
  frame: number;
};

export const EXT_DIR = "C:\\Users\\you\\AppData\\Roaming\\Downy\\Chrome extension";

const Btn: React.FC<{ id: string; p: WelcomeProps; primary?: boolean; ghost?: boolean; children: React.ReactNode }> = ({ id, p, primary, ghost, children }) => {
  const on = p.hl === id ? (p.hlAmt ?? 0) : 0;
  const press = p.hl === id ? (p.press ?? 0) : 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: primary ? "8px 16px" : "6px 12px",
        borderRadius: 9,
        fontSize: 13,
        whiteSpace: "nowrap",
        flex: "none",
        fontWeight: primary ? 600 : 400,
        color: primary ? "#fff" : ghost ? C.muted : on ? C.text : C.soft,
        border: primary || ghost ? "1px solid #0000" : `1px solid ${on ? C.lineAccent : C.line}`,
        background: primary ? (on > 0.5 ? "linear-gradient(90deg, #948df0, #7f9bff)" : C.primary) : ghost ? "transparent" : on > 0.5 ? "#0d0b26" : "#03030a8c",
        boxShadow: on ? `0 0 0 ${on * 2}px #b4aaff99, 0 0 ${on * 26}px #8a7fe8aa` : undefined,
        scale: String(1 - press * 0.06),
      }}
    >
      {children}
    </span>
  );
};

const Field: React.FC<{ label: string; help: string; children: React.ReactNode }> = ({ label, help, children }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "14px 0", borderBottom: `1px solid ${C.line}` }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: C.soft, wordBreak: "break-all" }}>{help}</span>
    </div>
    {children}
  </div>
);

const Status: React.FC<{ text: string; tone: "" | "wait" | "ok"; frame: number }> = ({ text, tone, frame }) =>
  text ? (
    <p style={{ margin: "14px 0 0", fontSize: 13, color: tone === "ok" ? C.mint : C.muted, display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flex: "none",
          background: tone === "ok" ? C.mint : tone === "wait" ? C.hi : C.faint,
          opacity: tone === "wait" ? 0.65 + Math.cos(frame / 6.7) * 0.35 : 1,
          boxShadow: tone === "ok" ? `0 0 10px ${C.mint}` : undefined,
        }}
      />
      {text}
    </p>
  ) : (
    <p style={{ margin: "14px 0 0", height: 19 }} />
  );

const Head: React.FC<{ count: string; title: string; sub: string }> = ({ count, title, sub }) => (
  <>
    <Img src={staticFile("icon.png")} style={{ display: "block", width: 44, height: 44, margin: "6px 0 12px" }} />
    <p style={{ margin: 0, color: C.faint, fontSize: 12, fontWeight: 500 }}>{count}</p>
    <h2 style={{ margin: "4px 0 6px", fontSize: 20, fontWeight: 600 }}>{title}</h2>
    <p style={{ margin: "0 0 6px", color: C.muted, fontSize: 13.5, lineHeight: 1.45 }}>{sub}</p>
  </>
);

const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 18 }}>{children}</div>
);

export const WelcomeDialog: React.FC<WelcomeProps & { style?: React.CSSProperties }> = (p) => (
  <div
    style={{
      width: 520,
      boxSizing: "border-box",
      padding: "18px 22px 22px",
      borderRadius: 20,
      border: `1px solid ${C.line}`,
      color: C.text,
      fontFamily: inter,
      lineHeight: 1.45,
      background: "linear-gradient(#03030ae6, #03030ae6), radial-gradient(120% 80% at 80% 100%, #3a2f8a, #0b0a1e 70%)",
      boxShadow: "0 30px 80px -20px #000",
      ...p.style,
    }}
  >
    {p.step === "folder" ? (
      <>
        <Head count="Step 1 of 3" title="Welcome to Downy" sub="Choose where Downy saves your downloads. You can change this later in Settings." />
        <Field label="Download folder" help="C:\Users\you\Videos\Downy">
          <Btn id="choose" p={p}>
            Choose folder
          </Btn>
        </Field>
        <Foot>
          <Btn id="use" p={p} primary>
            Use this folder
          </Btn>
        </Foot>
      </>
    ) : p.step === "tools" ? (
      <>
        <Head
          count="Step 2 of 3"
          title="Install the download tools"
          sub="Downy uses yt-dlp to read videos, ffmpeg to join video and audio, and Deno to solve YouTube's player checks. Downy installs the ones you don't have with winget, the package manager built into Windows."
        />
        <div style={{ marginTop: 10 }}>
          {(p.tools ?? []).map((t) => (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13.5 }}>
              <Icon
                name={t.state === "found" ? "check" : t.state === "busy" ? "refresh" : "alert"}
                size={16}
                color={t.state === "found" ? C.mint : t.state === "busy" ? C.hi : C.amber}
                style={t.state === "busy" ? { rotate: `${(p.frame * 12) % 360}deg` } : undefined}
              />
              <span style={{ fontWeight: 500, minWidth: 64 }}>{t.name}</span>
              <span style={{ flex: 1, textAlign: "right", fontSize: 12.5, color: t.state === "found" ? C.mint : C.muted, fontVariantNumeric: "tabular-nums" }}>{t.text}</span>
              {t.state === "busy" ? (
                <span style={{ width: 120, height: 4, borderRadius: 4, background: C.track, overflow: "hidden", flex: "none" }}>
                  <span style={{ display: "block", height: "100%", width: `${(t.bar ?? 0) * 100}%`, background: C.primary }} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <Status text={p.toolStatus?.text ?? ""} tone={p.toolStatus?.tone ?? ""} frame={p.frame} />
        <Foot>
          <span style={{ flex: 1 }} />
          {p.installLabel === "Install" ? (
            <Btn id="skip" p={p}>
              Skip for now
            </Btn>
          ) : null}
          <Btn id="install" p={p} primary>
            {p.installLabel ?? "Install"}
          </Btn>
        </Foot>
      </>
    ) : (
      <>
        <Head
          count="Step 3 of 3"
          title="Add Downy to Chrome"
          sub="The extension puts a Download button on YouTube videos and hands Chrome downloads to Downy. Chrome only lets you add it by hand, which takes a minute."
        />
        <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
          {[
            {
              text: (
                <>
                  Open Chrome's extensions page. This button opens Chrome and copies{" "}
                  <code style={{ fontFamily: mono, fontSize: 12, color: C.ink, background: "#b4aaff14", borderRadius: 5, padding: "1px 5px" }}>chrome://extensions</code>, so paste it into
                  the address bar and press Enter.
                </>
              ),
              btn: ["open", "Open Chrome"],
            },
            { text: <>Turn on Developer mode at the top right of the page.</>, btn: null },
            {
              text: (
                <>
                  Click Load unpacked. Paste this folder into the Folder box at the bottom, then click Select Folder.
                  <span style={{ display: "block", marginTop: 6, fontSize: 12.5, color: C.soft, wordBreak: "break-all" }}>{EXT_DIR}</span>
                </>
              ),
              btn: ["copy", "Copy folder"],
            },
          ].map((li, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <span
                style={{
                  flex: "none",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.ink,
                  background: "#8a7fe82e",
                  boxShadow: "inset 0 0 0 1px #b4aaff29",
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.5, color: C.soft }}>{li.text}</span>
              {li.btn ? (
                <Btn id={li.btn[0]} p={p}>
                  {li.btn[1]}
                </Btn>
              ) : null}
            </li>
          ))}
        </ol>
        <Status
          text={(p.extOk ?? 0) > 0.5 ? "Connected. Open any YouTube video to try it." : "Waiting for Chrome to load the extension"}
          tone={(p.extOk ?? 0) > 0.5 ? "ok" : "wait"}
          frame={p.frame}
        />
        <Foot>
          <Btn id="show" p={p} ghost>
            Show folder
          </Btn>
          <span style={{ flex: 1 }} />
          <Btn id="skip" p={p}>
            Skip for now
          </Btn>
          <Btn id="done" p={p} primary>
            Done
          </Btn>
        </Foot>
      </>
    )}
  </div>
);
