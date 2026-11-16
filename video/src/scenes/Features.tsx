import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp, inOut, rand, tw } from "../anim";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/Reveal";
import { SegBar } from "../components/SegBar";
import { Sfx } from "../components/Sfx";
import { Stage } from "../components/Stage";
import { C, inter, mono } from "../theme";

const BEAT = 80;

// A visual on the right that blurs in at `start` and out at `start + BEAT`.
const Panel: React.FC<{ frame: number; start: number; last?: boolean; children: React.ReactNode }> = ({ frame, start, last, children }) => {
  const i = tw(frame, [start + 2, start + 24], [0, 1]);
  const o = last ? 0 : tw(frame, [start + BEAT - 12, start + BEAT + 2], [0, 1]);
  return (
    <div
      style={{
        position: "absolute",
        left: 980,
        top: 0,
        width: 820,
        height: 1080,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        opacity: i * (1 - o),
        filter: `blur(${(1 - i) * 16 + o * 16}px)`,
        scale: String(0.94 + i * 0.06 + o * 0.04),
      }}
    >
      {children}
    </div>
  );
};

const Caption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: mono, fontSize: 24, color: C.muted, letterSpacing: "0.02em", marginTop: 36 }}>{children}</div>
);

const SITES = ["Vimeo", "Reddit", "X", "Twitch", "Dailymotion", "SoundCloud", "Streamable", "Bilibili", "Bandcamp", "TikTok", "Instagram", "Nebula"];

export const Features: React.FC = () => {
  const frame = useCurrentFrame();
  const b2 = BEAT;
  const b3 = BEAT * 2;

  // beat 1: eight connections
  const fills = Array.from({ length: 8 }, (_, i) => tw(frame, [8 + rand(i + 3) * 10, 62 - rand(i + 8) * 10], [0, 1], inOut));
  const speed = 31 + Math.sin(frame / 4) * 2.4 + fills.filter((f) => f > 0 && f < 1).length * 1.2;

  // beat 2: pause and resume
  const PAUSE = b2 + 30;
  const RESUME = b2 + 54;
  const p2 = interpolate(frame, [b2 + 6, PAUSE, RESUME, b2 + 78], [0.08, 0.46, 0.46, 0.72], clamp);
  const paused = frame >= PAUSE && frame < RESUME;

  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text }}>
      <Stage dim={0.66} drift={810} />

      <div style={{ position: "absolute", left: 140, top: 0, width: 780, height: 1080, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ position: "relative", height: 260 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <Reveal text="Eight connections. One file." frame={frame} start={4} exit={b2 - 12} accent={["Eight"]} style={{ fontSize: 100, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.04 }} />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <Reveal text="Pause now. Resume tomorrow." frame={frame} start={b2 + 4} exit={b3 - 12} accent={["Resume"]} style={{ fontSize: 100, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.04 }} />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <Reveal text="Works far beyond YouTube." frame={frame} start={b3 + 4} accent={["beyond"]} style={{ fontSize: 100, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.04 }} />
          </div>
        </div>
      </div>

      <Panel frame={frame} start={0}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22 }}>
          <span style={{ fontFamily: mono, fontSize: 26, color: C.hi }}>8 connections</span>
          <span style={{ fontSize: 44, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{speed.toFixed(1)} MB/s</span>
        </div>
        <SegBar fills={fills} height={84} cell={7} radius={10} glow={40} />
        <div style={{ display: "flex", marginTop: 14 }}>
          {fills.map((f, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: 20, color: f >= 1 ? C.mint : C.faint }}>
              {f >= 1 ? "done" : `#${i + 1}`}
            </div>
          ))}
        </div>
        <Caption>Idle connections take over the slowest part</Caption>
      </Panel>

      <Panel frame={frame} start={b2}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: "50%",
              flex: "none",
              display: "grid",
              placeItems: "center",
              color: C.text,
              background: "radial-gradient(100% 60% at 50% 0%, #ffffff1f, #0000 70%), linear-gradient(150deg, #8a7fe880, #6f8cff26 60%, #4a3cc426), #0d0b26",
              boxShadow: "inset 0 1px 0 #ffffff26, inset 0 -18px 24px -14px #a99fffcc, 0 0 0 1px #b4aaff33, 0 10px 40px -10px #a99fff",
              scale: String(1 - interpolate(frame, [PAUSE - 2, PAUSE, PAUSE + 5, RESUME - 2, RESUME, RESUME + 5], [0, 0.1, 0, 0, 0.1, 0], clamp)),
            }}
          >
            <Icon name={paused ? "play" : "pause"} size={46} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 34, fontWeight: 600, color: paused ? C.amber : C.text, marginBottom: 16, fontVariantNumeric: "tabular-nums" }}>
              {paused ? `Paused at ${Math.floor(p2 * 100)}%` : `${Math.floor(p2 * 100)}%`}
            </div>
            <SegBar fills={[p2]} height={44} cell={6} radius={8} mode={paused ? "paused" : "live"} />
          </div>
        </div>
        <Caption>Progress is saved every second, even across restarts</Caption>
      </Panel>

      <Panel frame={frame} start={b3} last>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {SITES.map((s, i) => {
            const a = tw(frame, [b3 + 8 + i * 2.5, b3 + 22 + i * 2.5], [0, 1]);
            return (
              <div
                key={s}
                style={{
                  padding: "16px 26px",
                  borderRadius: 16,
                  fontSize: 32,
                  fontWeight: 500,
                  background: `${C.glassTint}, ${C.glass}`,
                  boxShadow: C.glassShadow + ", 0 0 0 1px #b4aaff1f",
                  opacity: a,
                  translate: `0 ${(1 - a) * 30}px`,
                  scale: String(0.85 + a * 0.15),
                }}
              >
                {s}
              </div>
            );
          })}
          <div
            style={{
              padding: "16px 26px",
              borderRadius: 16,
              fontSize: 32,
              fontWeight: 600,
              color: "#fff",
              background: C.primary,
              opacity: tw(frame, [b3 + 40, b3 + 54], [0, 1]),
              scale: String(0.85 + tw(frame, [b3 + 40, b3 + 54], [0, 1]) * 0.15),
            }}
          >
            and 1,800 more
          </div>
        </div>
        <Caption>The button shows up on every site yt-dlp supports</Caption>
      </Panel>

      {fills.map((_, i) => (
        <Sfx key={i} at={62 - rand(i + 8) * 10} name="tick" volume={0.14 + i * 0.015} />
      ))}
      <Sfx at={b2 - 6} name="whoosh-soft" volume={0.3} />
      <Sfx at={PAUSE} name="click-soft" volume={0.8} />
      <Sfx at={PAUSE} name="pop-down" volume={0.35} />
      <Sfx at={RESUME} name="click-soft" volume={0.8} />
      <Sfx at={RESUME} name="pop-up" volume={0.35} />
      <Sfx at={b3 - 6} name="whoosh-soft" volume={0.3} />
      {SITES.map((s, i) => (i % 2 === 0 ? <Sfx key={s} at={b3 + 8 + i * 2.5} name="tick" volume={0.14} /> : null))}
      <Sfx at={b3 + 40} name="pop-up" volume={0.5} />
    </AbsoluteFill>
  );
};
