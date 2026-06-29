// Build the native Electron portable app end-to-end:
//   1. bundle the agent (agent.cjs)
//   2. package with @electron/packager -> dist/CodexApp-win32-x64/
//   3. code-sign CodexApp.exe (no-op unless CODEXAPP_SIGN_* is configured)
//   4. zip the folder -> dist/CodexApp-portable-win64.zip
//
// Run: node package.mjs   (or: npm run dist:portable)
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signWindows } from "../cloud/sign-win.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "dist");

// 1. bundle agent.cjs (build.mjs runs its work at import time)
await import("./build.mjs");

// 2. package
console.log("[desktop] packaging Electron app (win32/x64)...");
const appPaths = await packager({
  dir: HERE,
  name: "CodexApp",
  platform: "win32",
  arch: "x64",
  out: OUT,
  overwrite: true,
  prune: true,
});
const appDir = appPaths[0];
console.log("[desktop] packaged ->", appDir);

// 3. code-sign the launcher (the exe SAC/SmartScreen actually checks)
const exe = path.join(appDir, "CodexApp.exe");
const signed = signWindows(exe, { label: "CodexApp.exe" });
if (!signed) console.log("[desktop] (unsigned — set CODEXAPP_SIGN_* to code-sign for distribution)");

// 4. zip (Windows PowerShell Compress-Archive)
const zip = path.join(OUT, "CodexApp-portable-win64.zip");
try {
  if (fs.existsSync(zip)) fs.rmSync(zip);
  execFileSync("powershell", ["-NoProfile", "-Command",
    `Compress-Archive -Path '${appDir}' -DestinationPath '${zip}' -CompressionLevel Optimal`],
    { stdio: "inherit" });
  console.log("[desktop] zipped ->", zip, (fs.statSync(zip).size / 1024 / 1024).toFixed(0) + " MB");
} catch (e) {
  console.log("[desktop] (zip skipped:", e.message + ")");
}

console.log("[desktop] done.");
