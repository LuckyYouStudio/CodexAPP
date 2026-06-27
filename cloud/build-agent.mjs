// Build the PC Agent into a single Windows .exe using esbuild + Node SEA.
//   1. esbuild bundles agent.mjs + all deps -> one CJS file
//   2. Node SEA turns it into a blob and injects it into a copy of node.exe
// Output: dist/CodexApp-Agent.exe  (no Node install needed on the user's PC)
//
// Run:  node cloud/build-agent.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BUNDLE = path.join(DIST, "agent.cjs");
const BLOB = path.join(DIST, "agent.blob");
const SEA_CFG = path.join(DIST, "sea-config.json");
const EXE = path.join(DIST, "CodexApp-Agent.exe");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

fs.mkdirSync(DIST, { recursive: true });

console.log("[build] bundling with esbuild...");
await build({
  entryPoints: [path.join(ROOT, "cloud", "agent.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: BUNDLE,
  // ws ships optional native speedups; it falls back to JS when absent.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
});
console.log("[build] bundle:", (fs.statSync(BUNDLE).size / 1024).toFixed(0) + " KB");

fs.writeFileSync(SEA_CFG, JSON.stringify({
  main: BUNDLE,
  output: BLOB,
  disableExperimentalSEAWarning: true,
}, null, 2));

console.log("[build] generating SEA blob...");
execFileSync(process.execPath, ["--experimental-sea-config", SEA_CFG], { stdio: "inherit" });

console.log("[build] copying node runtime -> exe...");
fs.copyFileSync(process.execPath, EXE);

// Strip node.exe's Authenticode signature BEFORE injecting; otherwise postject
// corrupts it and the result can't be (re)signed later (signtool 0x800700C1).
function findSigntool() {
  const base = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  try {
    return fs.readdirSync(base).map((d) => path.join(base, d, "x64", "signtool.exe"))
      .filter((p) => fs.existsSync(p)).sort().reverse()[0] || null;
  } catch { return null; }
}
const signtool = findSigntool();
if (signtool) {
  try { execFileSync(signtool, ["remove", "/s", EXE], { stdio: "ignore" }); console.log("[build] stripped base signature"); }
  catch { /* node.exe may already be unsigned in some builds */ }
} else {
  console.log("[build] (signtool not found — skipping pre-strip; install Windows SDK if you'll code-sign)");
}

console.log("[build] injecting blob with postject...");
execFileSync(process.execPath, [
  path.join(ROOT, "node_modules", "postject", "dist", "cli.js"),
  EXE, "NODE_SEA_BLOB", BLOB, "--sentinel-fuse", FUSE,
], { stdio: "inherit" });

console.log("\n[build] done -> " + EXE);
console.log("        size:", (fs.statSync(EXE).size / 1024 / 1024).toFixed(1) + " MB");
console.log("        (unsigned — for distribution, code-sign it to avoid SmartScreen)");
