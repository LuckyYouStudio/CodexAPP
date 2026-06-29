// Optional Windows code-signing helper, driving signtool.exe.
//
// The build scripts call signWindows() on each produced .exe. With nothing
// configured it is a NO-OP (build still produces an unsigned binary as before),
// so day-to-day builds need no certificate. To sign for distribution, configure
// ONE method via env vars and run the same build command.
//
// Pick the method that matches your certificate:
//
//   1) Hardware token / cloud KSP / Windows cert store, by thumbprint (EV certs
//      live on a token or HSM — this is the usual EV path):
//        CODEXAPP_SIGN_SHA1=AB12CD...    (cert SHA-1 thumbprint; spaces are ok)
//
//   2) By subject name in the cert store (if only one matching cert is installed):
//        CODEXAPP_SIGN_SUBJECT="Your Company, Inc."
//
//   3) PFX file — OV / TEST only. Real EV private keys can't be exported to a PFX:
//        CODEXAPP_SIGN_PFX=C:\path\cert.pfx
//        CODEXAPP_SIGN_PASS=secret              (optional)
//
//   4) Azure Trusted Signing (Microsoft's cloud signing — trusted by SAC):
//        CODEXAPP_SIGN_AZURE=C:\path\metadata.json
//        CODEXAPP_AZURE_DLIB=C:\path\Azure.CodeSigning.Dlib.dll
//
// Common (optional):
//   CODEXAPP_SIGN_TS    RFC3161 timestamp URL (default http://timestamp.sectigo.com)
//   CODEXAPP_SIGNTOOL   explicit path to signtool.exe (else auto-located from the SDK)
//   CODEXAPP_SIGN=0     force-disable signing even if a method is configured
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Locate signtool.exe: explicit override -> newest Windows SDK -> PATH.
export function findSigntool() {
  const override = process.env.CODEXAPP_SIGNTOOL;
  if (override && fs.existsSync(override)) return override;
  const bases = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin",
    "C:\\Program Files\\Windows Kits\\10\\bin",
  ];
  for (const base of bases) {
    try {
      const hit = fs.readdirSync(base)
        .map((d) => path.join(base, d, "x64", "signtool.exe"))
        .filter((p) => fs.existsSync(p)).sort().reverse()[0];
      if (hit) return hit;
    } catch { /* base may not exist */ }
  }
  return "signtool.exe"; // last resort: rely on PATH
}

export function isSigningConfigured() {
  if (process.env.CODEXAPP_SIGN === "0") return false;
  return !!(process.env.CODEXAPP_SIGN_SHA1 || process.env.CODEXAPP_SIGN_SUBJECT ||
            process.env.CODEXAPP_SIGN_PFX || process.env.CODEXAPP_SIGN_AZURE);
}

function signArgs(file) {
  const ts = process.env.CODEXAPP_SIGN_TS || "http://timestamp.sectigo.com";
  const tsArgs = ["/fd", "sha256", "/tr", ts, "/td", "sha256"];
  if (process.env.CODEXAPP_SIGN_SHA1) {
    return ["sign", "/sha1", process.env.CODEXAPP_SIGN_SHA1.replace(/\s+/g, ""), ...tsArgs, file];
  }
  if (process.env.CODEXAPP_SIGN_SUBJECT) {
    return ["sign", "/n", process.env.CODEXAPP_SIGN_SUBJECT, ...tsArgs, file];
  }
  if (process.env.CODEXAPP_SIGN_PFX) {
    const a = ["sign", "/f", process.env.CODEXAPP_SIGN_PFX];
    if (process.env.CODEXAPP_SIGN_PASS) a.push("/p", process.env.CODEXAPP_SIGN_PASS);
    return [...a, ...tsArgs, file];
  }
  if (process.env.CODEXAPP_SIGN_AZURE) {
    const dlib = process.env.CODEXAPP_AZURE_DLIB;
    if (!dlib || !fs.existsSync(dlib)) {
      throw new Error("Azure Trusted Signing: set CODEXAPP_AZURE_DLIB to Azure.CodeSigning.Dlib.dll");
    }
    return ["sign", "/v", ...tsArgs, "/dlib", dlib, "/dmdf", process.env.CODEXAPP_SIGN_AZURE, file];
  }
  return null; // no method configured
}

// Sign `file` in place. Returns true if signed, false if signing isn't configured.
// Throws if configured but signing/verification fails — so a release build fails loudly.
export function signWindows(file, { label = path.basename(file), verify = true } = {}) {
  if (process.platform !== "win32") return false;
  if (!isSigningConfigured()) {
    console.log(`[sign] (skip ${label} — signing not configured; set CODEXAPP_SIGN_* to enable)`);
    return false;
  }
  const args = signArgs(file);
  if (!args) return false;
  const signtool = findSigntool();
  console.log(`[sign] signing ${label} ...`);
  execFileSync(signtool, args, { stdio: "inherit" });
  if (verify) execFileSync(signtool, ["verify", "/pa", "/v", file], { stdio: "inherit" });
  console.log(`[sign] OK  signed${verify ? " + verified" : ""}: ${label}`);
  return true;
}
