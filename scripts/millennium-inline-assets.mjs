// Post-build step for the Millennium bundle. millennium-ttc emits imported SVGs as separate
// files and references them by bare file name, which Steam resolves against its own page
// (steamloopback.host) instead of the plugin folder, so the images never load. Inline them as
// data URIs, as the Decky build does.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../millennium/.millennium/Dist");
const bundlePath = path.join(distDir, "index.js");
let bundle = fs.readFileSync(bundlePath, "utf8");
let inlined = 0;
let unreferenced = 0;

for (const name of fs.readdirSync(distDir)) {
  if (!name.endsWith(".svg")) continue;
  const assetPath = path.join(distDir, name);
  // The url plugin also emits assets whose importing code was tree-shaken away.
  if (!bundle.includes(`"${name}"`)) {
    fs.rmSync(assetPath);
    unreferenced += 1;
    continue;
  }
  const dataUri = `data:image/svg+xml;base64,${fs.readFileSync(assetPath).toString("base64")}`;
  bundle = bundle.replaceAll(`"${name}"`, JSON.stringify(dataUri));
  fs.rmSync(assetPath);
  inlined += 1;
}

if (inlined === 0 && unreferenced > 0) {
  throw new Error("No emitted SVG is referenced as a quoted string in index.js; the ttc output format changed.");
}
fs.writeFileSync(bundlePath, bundle);
console.log(`Inlined ${inlined} SVG asset(s), dropped ${unreferenced} unused, in ${path.relative(process.cwd(), bundlePath)}`);
