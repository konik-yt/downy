import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const { fontFamily: inter } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
export const { fontFamily: mono } = loadMono("normal", {
  weights: ["500"],
  subsets: ["latin"],
});

// Downy's own colors, from app/src/renderer/styles.css.
export const C = {
  text: "#f1f0ff",
  soft: "#d9d6f2",
  muted: "#a6a3c0",
  faint: "#6f6c8c",
  accent: "#8a7fe8",
  accent2: "#6f8cff",
  hi: "#b4aaff",
  ink: "#e6e2ff",
  mint: "#8fdcc0",
  amber: "#e8c27c",
  rose: "#ff9ebf",
  line: "#ffffff12",
  lineAccent: "#b4aaff1f",
  track: "#16143a",
  glass: "color-mix(in srgb, #0b0a1e 62%, #0000)",
  glassTint: "linear-gradient(90deg, #8a7fe830, #6f8cff12 60%, #6f8cff05)",
  glassShadow: "inset 0 -18px 28px -20px #7864ff66, inset 0 1px 0 #ffffff0d",
  primary: "linear-gradient(90deg, #8a7fe8, #6f8cff)",
};

export const FPS = 30;

// Scene lengths in frames. The main video subtracts the transition overlaps.
export const D = {
  intro: 165,
  browse: 345,
  manager: 300,
  features: 240,
  outro: 165,
  dissolve: 20,
};
export const TOTAL = D.intro + D.browse + D.manager + D.features + D.outro - 3 * D.dissolve;
