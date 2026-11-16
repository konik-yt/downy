// Synthesizes every sound in the video into public/sfx as 48 kHz stereo WAV files.
// Run with: node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");
mkdirSync(OUT, { recursive: true });

// Seeded random, so every run makes the same files.
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;
const TAU = Math.PI * 2;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function buffer(seconds) {
  const n = Math.ceil(seconds * SR);
  return [new Float32Array(n), new Float32Array(n)];
}

function lowpass(fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let y = 0;
  return (x, f) => {
    const k = f ? 1 - Math.exp((-TAU * f) / SR) : a;
    y += k * (x - y);
    return y;
  };
}
function highpass(fc) {
  const lp = lowpass(fc);
  return (x, f) => x - lp(x, f);
}
// State variable bandpass with a moving center frequency.
function bandpass(q = 2) {
  let low = 0, band = 0;
  return (x, fc) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    low += f * band;
    const high = x - low - band / q;
    band += f * high;
    return band;
  };
}

// Small Freeverb style room, used on the bells and the music.
function reverb(size = 0.84, damp = 0.25, wet = 0.3) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => Math.round((d * SR) / 44100));
  const aps = [556, 441, 341].map((d) => Math.round((d * SR) / 44100));
  const make = (spread) => ({
    c: combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 })),
    a: aps.map((d) => ({ buf: new Float32Array(d + spread), i: 0 })),
  });
  const ch = [make(0), make(23)];
  const run = (s, x) => {
    let out = 0;
    for (const c of s.c) {
      const y = c.buf[c.i];
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * size;
      c.i = (c.i + 1) % c.buf.length;
      out += y;
    }
    out /= s.c.length;
    for (const a of s.a) {
      const b = a.buf[a.i];
      a.buf[a.i] = out + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      out = b - out;
    }
    return out;
  };
  return (l, r) => [l + run(ch[0], (l + r) * 0.5) * wet, r + run(ch[1], (l + r) * 0.5) * wet];
}

function applyReverb([L, R], opts) {
  const rv = reverb(...opts);
  for (let i = 0; i < L.length; i++) [L[i], R[i]] = rv(L[i], R[i]);
}

function write(name, [L, R], peak = 0.89) {
  let max = 0;
  for (let i = 0; i < L.length; i++) max = Math.max(max, Math.abs(L[i]), Math.abs(R[i]));
  const g = max > 0 ? peak / max : 1;
  // short fade at the end so nothing clicks
  const fade = Math.min(L.length, Math.round(SR * 0.01));
  const data = Buffer.alloc(44 + L.length * 4);
  data.write("RIFF", 0); data.writeUInt32LE(36 + L.length * 4, 4); data.write("WAVE", 8);
  data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(L.length * 4, 40);
  for (let i = 0; i < L.length; i++) {
    const f = i > L.length - fade ? (L.length - i) / fade : 1;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g * f)) * 32767), 44 + i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g * f)) * 32767), 46 + i * 4);
  }
  writeFileSync(join(OUT, name + ".wav"), data);
  console.log("wrote", name, (L.length / SR).toFixed(2) + "s");
}

const add = ([L, R], i, v, pan = 0) => {
  if (i < 0 || i >= L.length) return;
  L[i] += v * Math.cos(((pan + 1) * Math.PI) / 4);
  R[i] += v * Math.sin(((pan + 1) * Math.PI) / 4);
};

// ------------------------------------------------------------ UI sounds

// A mouse click: a hard plastic press, then a softer release.
function click(name, { tone = 1, release = true } = {}) {
  const b = buffer(0.16);
  const hits = [[0, 1, 3200 * tone], ...(release ? [[0.055, 0.45, 4200 * tone]] : [])];
  for (const [t0, amp, fc] of hits) {
    const bp = bandpass(3);
    const start = Math.round(t0 * SR);
    for (let i = 0; i < SR * 0.04; i++) {
      const t = i / SR;
      const env = Math.exp(-t / 0.0028);
      const body = Math.sin(TAU * 190 * tone * t) * Math.exp(-t / 0.012) * 0.5;
      add(b, start + i, (bp(noise(), fc) * 2.2 * env + body * (t0 === 0 ? 1 : 0.3)) * amp);
    }
  }
  write(name, b, 0.8);
}

// A short glassy tick, for list items and hover changes.
function tick(name, freq = 3800, len = 0.05) {
  const b = buffer(len + 0.02);
  const hp = highpass(2000);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    const v = Math.sin(TAU * freq * t) * Math.exp(-t / 0.007) * 0.7 + hp(noise()) * Math.exp(-t / 0.0015) * 0.6;
    add(b, i, v);
  }
  write(name, b, 0.7);
}

// A soft bubble pop that rises (appear) or falls (close).
function pop(name, f0, f1, len = 0.12) {
  const b = buffer(len + 0.05);
  let ph = 0;
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    const k = Math.min(1, t / (len * 0.55));
    const f = f0 * Math.pow(f1 / f0, 1 - Math.pow(1 - k, 3));
    ph += (TAU * f) / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / (len * 0.3));
    add(b, i, Math.sin(ph) * env + Math.sin(ph * 2) * env * 0.15);
  }
  applyReverb(b, [0.7, 0.3, 0.12]);
  write(name, b, 0.75);
}

// Air moving past: noise through a sweeping bandpass, panned across.
function whoosh(name, len, f0, fpeak, f1, panFrom = -0.6, panTo = 0.6, peakAt = 0.55) {
  const b = buffer(len + 0.4);
  const bpL = bandpass(1.4), bpR = bandpass(1.4);
  for (let i = 0; i < len * SR; i++) {
    const k = i / (len * SR);
    const fc = k < peakAt ? f0 * Math.pow(fpeak / f0, k / peakAt) : fpeak * Math.pow(f1 / fpeak, (k - peakAt) / (1 - peakAt));
    const env = k < peakAt ? Math.pow(k / peakAt, 2.2) : Math.pow(1 - (k - peakAt) / (1 - peakAt), 1.6);
    const pan = panFrom + (panTo - panFrom) * k;
    const l = bpL(noise(), fc) * env, r = bpR(noise(), fc * 1.04) * env;
    b[0][i] += l * Math.cos(((pan + 1) * Math.PI) / 4) * 1.4;
    b[1][i] += r * Math.sin(((pan + 1) * Math.PI) / 4) * 1.4;
  }
  applyReverb(b, [0.8, 0.3, 0.2]);
  write(name, b, 0.7);
}

// A bell built from inharmonic partials.
function bell(b, start, freq, amp, decay = 1.1, pan = 0) {
  const parts = [[1, 1], [2.0, 0.42], [2.76, 0.22], [5.4, 0.1], [8.93, 0.04]];
  for (let i = 0; i < decay * 4 * SR; i++) {
    const t = i / SR;
    let v = 0;
    for (const [r, a] of parts) v += Math.sin(TAU * freq * r * t) * a * Math.exp(-t / (decay / Math.sqrt(r)));
    add(b, start + i, v * amp * Math.min(1, t / 0.002), pan);
  }
}

function chime(name, notes, gap = 0.07, decay = 1.0, len = 2.2) {
  const b = buffer(len);
  notes.forEach((n, i) => bell(b, Math.round(i * gap * SR), midi(n), 1 / (1 + i * 0.15), decay, (i % 2 ? 0.25 : -0.25)));
  applyReverb(b, [0.86, 0.3, 0.35]);
  write(name, b, 0.75);
}

// A deep, soft impact.
function thump(name) {
  const b = buffer(1.6);
  let ph = 0;
  const lp = lowpass(900);
  for (let i = 0; i < 1.4 * SR; i++) {
    const t = i / SR;
    const f = 42 + 70 * Math.exp(-t / 0.05);
    ph += (TAU * f) / SR;
    const v = Math.sin(ph) * Math.exp(-t / 0.42) + lp(noise()) * Math.exp(-t / 0.05) * 0.5;
    add(b, i, v);
  }
  applyReverb(b, [0.8, 0.4, 0.15]);
  write(name, b, 0.85);
}

// A rising swell into a big reveal: noise and a fifth that climb and open up.
function riser(name, len = 1.1) {
  const b = buffer(len + 0.6);
  const lp = lowpass(400);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < len * SR; i++) {
    const k = i / (len * SR);
    const env = Math.pow(k, 2.4) * (k > 0.94 ? (1 - k) / 0.06 : 1);
    const f = 220 * Math.pow(2, k * 1.2);
    p1 += (TAU * f) / SR; p2 += (TAU * f * 1.5) / SR;
    const tone = (Math.sin(p1) + Math.sin(p2) * 0.6) * 0.35;
    const air = lp(noise(), 300 + 6000 * k * k) * 1.6;
    add(b, i, (tone + air) * env, Math.sin(k * 8) * 0.3);
  }
  applyReverb(b, [0.85, 0.3, 0.3]);
  write(name, b, 0.7);
}

// Many tiny ticks that build up, for the pixels flying into place.
function sparkle(name, len = 1.3, count = 46) {
  const b = buffer(len + 0.8);
  for (let n = 0; n < count; n++) {
    const k = Math.pow(n / count, 0.7);
    const start = Math.round(k * len * SR * 0.92);
    const f = 2400 + rnd() * 3600 + k * 1500;
    const amp = 0.25 + 0.75 * (1 - Math.abs(k - 0.6));
    const pan = rnd() * 1.6 - 0.8;
    for (let i = 0; i < 0.04 * SR; i++) {
      const t = i / SR;
      add(b, start + i, Math.sin(TAU * f * t) * Math.exp(-t / 0.006) * amp, pan);
    }
  }
  applyReverb(b, [0.82, 0.25, 0.35]);
  write(name, b, 0.6);
}

// A pixel-dissolve shimmer for scene changes.
function shimmer(name, len = 0.8) {
  const b = buffer(len + 0.8);
  const hp = highpass(3000);
  for (let i = 0; i < len * SR; i++) {
    const k = i / (len * SR);
    const env = Math.sin(Math.PI * k) ** 1.5;
    const grain = rnd() < 0.004 ? 1 : 0;
    add(b, i, hp(noise()) * env * 0.18 + grain * (rnd() * 2 - 1) * 0.9, Math.sin(k * 12) * 0.5);
  }
  applyReverb(b, [0.85, 0.2, 0.45]);
  write(name, b, 0.55);
}

// A switch flipping on: a small low click, then a brighter one.
function toggle(name) {
  const b = buffer(0.2);
  [[0, 1800, 0.7], [0.028, 3400, 1]].forEach(([t0, fc, amp]) => {
    const bp = bandpass(4);
    const start = Math.round(t0 * SR);
    for (let i = 0; i < SR * 0.03; i++) {
      const t = i / SR;
      add(b, start + i, (bp(noise(), fc) * 2.4 * Math.exp(-t / 0.002) + Math.sin(TAU * fc * 0.5 * t) * Math.exp(-t / 0.006) * 0.4) * amp);
    }
  });
  applyReverb(b, [0.6, 0.3, 0.1]);
  write(name, b, 0.7);
}

// A soft keyboard key: a muffled thock with a little top.
function key(name) {
  const b = buffer(0.12);
  const lp = lowpass(1400);
  const bp = bandpass(2);
  for (let i = 0; i < SR * 0.08; i++) {
    const t = i / SR;
    const v = lp(noise()) * 3 * Math.exp(-t / 0.012) + bp(noise(), 4200) * Math.exp(-t / 0.0015) * 0.8 + Math.sin(TAU * 130 * t) * Math.exp(-t / 0.02) * 0.5;
    add(b, i, v);
  }
  write(name, b, 0.75);
}

click("click");
click("click-soft", { tone: 0.8 });
tick("tick", 3800);
tick("tick-low", 2600);
pop("pop-up", 420, 1150, 0.11);
pop("pop-down", 1000, 380, 0.11);
whoosh("whoosh", 0.7, 300, 2600, 500);
whoosh("whoosh-soft", 0.5, 400, 1800, 600, 0.4, -0.4);
riser("riser", 1.0);
chime("chime", [84, 91], 0.08, 0.9);          // C6 G6, the prompt window
chime("success", [72, 76, 79, 84], 0.075, 1.1, 2.6); // C E G C, download finished
chime("logo", [60, 67, 72, 76, 79], 0.09, 1.6, 3.6);
thump("thump");
sparkle("sparkle");
shimmer("shimmer");

// ---------------------------------------------------------------- music

// 96 BPM, one chord per bar, in C major. Soft pad, a plucked arpeggio, light drums.
function music(name, seconds, totalBars) {
  const beat = 60 / 96;
  const bar = beat * 4;
  const b = buffer(seconds);
  const dry = buffer(seconds);
  const chords = [
    { bass: 41, pad: [57, 60, 64, 67] }, // Fmaj7
    { bass: 45, pad: [55, 60, 64, 69] }, // Am7
    { bass: 48, pad: [55, 59, 64, 67] }, // Cmaj7
    { bass: 43, pad: [55, 59, 62, 64] }, // G6
  ];
  const bars = Math.ceil(seconds / bar);
  const chordAt = (n) => (n >= totalBars - 2 ? (n === totalBars - 2 ? chords[0] : { bass: 36, pad: [55, 59, 62, 64, 67] }) : chords[n % 4]);

  // pad
  for (let n = 0; n < bars; n++) {
    const ch = chordAt(n);
    const start = n * bar;
    const last = n >= totalBars - 1;
    const len = last ? seconds - start : bar + 0.4;
    const voices = [...ch.pad, ch.bass + 12].map((m) => ({ f: midi(m), p: [rnd(), rnd(), rnd()] }));
    const lp = [lowpass(800), lowpass(800)];
    for (let i = 0; i < len * SR; i++) {
      const t = i / SR;
      const abs = start + t;
      const idx = Math.round(abs * SR);
      if (idx >= b[0].length) break;
      const env = Math.min(1, t / 0.5) * (last ? Math.exp(-Math.max(0, t - 2) / 2.5) : t > bar ? Math.max(0, 1 - (t - bar) / 0.4) : 1);
      let l = 0, r = 0;
      voices.forEach((v, j) => {
        for (let d = 0; d < 2; d++) {
          const f = v.f * (d ? 1.004 : 0.996);
          const ph = (v.p[d] + f * t) % 1;
          const saw = 2 * ph - 1;
          if (d) r += saw; else l += saw;
        }
        void j;
      });
      // the filter opens across the video and breathes with each bar
      const open = 500 + 1400 * Math.min(1, abs / 26) + 300 * Math.sin((TAU * t) / bar);
      dry[0][idx] += lp[0](l, open) * env * 0.05;
      dry[1][idx] += lp[1](r, open) * env * 0.05;
    }
    // bass
    let ph = 0;
    for (let i = 0; i < Math.min(len, bar) * SR; i++) {
      const t = i / SR;
      const idx = Math.round((start + t) * SR);
      if (idx >= b[0].length) break;
      ph += (TAU * midi(ch.bass)) / SR;
      const env = Math.min(1, t / 0.02) * Math.exp(-t / 1.8) * (n >= 2 ? 1 : 0.5);
      add(b, idx, (Math.sin(ph) + Math.sin(ph * 2) * 0.2) * env * 0.16);
    }
  }

  // plucked arpeggio, eighth notes, from bar 2
  const pattern = [0, 2, 1, 3, 2, 1, 3, 0];
  for (let n = 2; n < totalBars - 1; n++) {
    const ch = chordAt(n);
    for (let s = 0; s < 8; s++) {
      const m = ch.pad[pattern[s] % ch.pad.length] + 12;
      const start = n * bar + s * (beat / 2);
      const vel = (s % 2 ? 0.6 : 1) * (n >= 10 ? 1.15 : 0.85);
      const f = midi(m);
      const lp = lowpass(3000);
      for (let i = 0; i < 0.6 * SR; i++) {
        const t = i / SR;
        const idx = Math.round((start + t) * SR);
        if (idx >= b[0].length) break;
        const v = (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2 * t) * 0.25 * Math.exp(-t / 0.05)) * Math.exp(-t / 0.22);
        add(dry, idx, lp(v) * vel * 0.07, s % 2 ? 0.35 : -0.35);
      }
    }
  }

  // drums: soft kick on 1 and 3, closed hats on the off beats, from bar 2 to the outro
  for (let n = 2; n < totalBars - 2; n++) {
    for (let q = 0; q < 4; q++) {
      const start = n * bar + q * beat;
      if (q % 2 === 0) {
        let ph = 0;
        for (let i = 0; i < 0.35 * SR; i++) {
          const t = i / SR;
          ph += (TAU * (48 + 90 * Math.exp(-t / 0.03))) / SR;
          add(b, Math.round((start + t) * SR), Math.sin(ph) * Math.exp(-t / 0.13) * 0.32);
        }
      }
      const hp = highpass(7000);
      const hs = start + beat / 2;
      for (let i = 0; i < 0.05 * SR; i++) {
        const t = i / SR;
        add(b, Math.round((hs + t) * SR), hp(noise()) * Math.exp(-t / 0.012) * (n >= 10 ? 0.07 : 0.045), 0.3);
      }
      if (n >= 6 && q % 2 === 1) {
        // a light snap on 2 and 4 once the demo is under way
        const bp = bandpass(1.2);
        for (let i = 0; i < 0.15 * SR; i++) {
          const t = i / SR;
          add(dry, Math.round((start + t) * SR), bp(noise(), 1800) * Math.exp(-t / 0.05) * 0.05);
        }
      }
    }
  }

  applyReverb(dry, [0.88, 0.35, 0.55]);
  for (let i = 0; i < b[0].length; i++) {
    b[0][i] += dry[0][i];
    b[1][i] += dry[1][i];
  }
  // fade in
  for (let i = 0; i < SR * 1.5; i++) {
    b[0][i] *= i / (SR * 1.5);
    b[1][i] *= i / (SR * 1.5);
  }
  write(name, b, 0.8);
}

music("music", 40, 15); // the product video is 15 bars long
music("music-setup", 60, 23); // the setup video is 23 bars long

// Made last, so the files above come out the same as before these were added.
toggle("toggle");
key("key");
