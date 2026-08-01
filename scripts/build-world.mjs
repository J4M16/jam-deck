import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["game-deck/world.js"],
  outfile: "game-deck-world.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true,
  logLevel: "info",
});

console.log("game-deck-world.js built");
