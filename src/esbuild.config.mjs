import { build } from "esbuild";
import path from "path";

//q: explain this code
// This code uses esbuild to bundle TypeScript files into a single output file.
build({
  entryPoints: [
    "./src/actions/index.ts",
    // add more as needed
  ],
  entryNames: "[dir]/[name]/index",
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: false,
  minify: true,
  logLevel: "info",
}).catch(() => process.exit(1));
