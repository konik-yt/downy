// Renders chosen frames of a composition to out/stills, from one bundle.
// Usage: node scripts/stills.mjs <compositionId> <frame> [frame...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [id, ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id });
mkdirSync("out/stills", { recursive: true });
for (const f of frames) {
  const output = `out/stills/${id}-${f}.png`;
  await renderStill({ serveUrl, composition, frame: Number(f), output, scale: Number(process.env.SCALE ?? 0.5) });
  console.log(output);
}
