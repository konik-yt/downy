// Renders the README step clips (the Setup-Clips compositions) to animated WebP in ../docs/setup.
// Usage: node scripts/clips.mjs [clip id...]   (no ids renders all of them)
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, getCompositions } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

const only = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const ids = (await getCompositions(serveUrl)).map((c) => c.id).filter((id) => id.startsWith("clip-"));
mkdirSync("out/clips", { recursive: true });
mkdirSync("../docs/setup", { recursive: true });

for (const id of ids) {
  const name = id.slice("clip-".length);
  if (only.length && !only.includes(name)) continue;
  const composition = await selectComposition({ serveUrl, id });
  const mp4 = `out/clips/${name}.mp4`;
  await renderMedia({ serveUrl, composition, codec: "h264", outputLocation: mp4, muted: true, scale: 0.5, crf: 12 });
  const webp = `../docs/setup/${name}.webp`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", mp4, "-vf", "fps=15", "-c:v", "libwebp_anim", "-quality", "72", "-compression_level", "6", "-loop", "0", "-an", webp]);
  console.log(`${webp}  ${(statSync(webp).size / 1e6).toFixed(2)} MB`);
}
