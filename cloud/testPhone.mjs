// Simulate the phone over the cloud broker, end-to-end encrypted, WITH pairing.
// Usage: node cloud/testPhone.mjs <email> <password> ["prompt"] [pairingCode]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { newKeyPair, seal, open, fingerprint, sas } from "./e2e.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROKER = process.env.CODEXAPP_BROKER || "http://127.0.0.1:8787";
const EMAIL = process.argv[2] || process.env.CODEXAPP_EMAIL;
const PASSWORD = process.argv[3] || process.env.CODEXAPP_PASSWORD;
const PROMPT = process.argv[4] || "只用一个词回复我：你好";
let CODE = process.argv[5] || process.env.CODEXAPP_PAIRCODE || "";
if (!CODE) { try { CODE = fs.readFileSync(path.join(HERE, "pairing-code.txt"), "utf8").trim(); } catch {} }

const keys = newKeyPair();
let agentPubkey = null;
let ready = false;
let promptSent = false;
let ws;

async function login() {
  const res = await fetch(BROKER.replace(/\/+$/, "") + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error("login failed: " + (await res.text()));
  return (await res.json()).token;
}
function sendSealed(obj) { ws.send(JSON.stringify({ type: "e2e", ...seal(obj, agentPubkey, keys.secretKey) })); }
function maybePrompt() {
  if (ready && !promptSent) { promptSent = true; console.log("[phone] -> (encrypted) prompt:", PROMPT); sendSealed({ type: "prompt", text: PROMPT }); }
}

const token = await login();
ws = new WebSocket(BROKER.replace(/^http/, "ws").replace(/\/+$/, "") + "/link");
ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token, role: "phone", pubkey: keys.publicKey })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "authed") {
    if (m.peerOnline && m.peerPubkey) { agentPubkey = m.peerPubkey; console.log("[phone] agent fp:", fingerprint(agentPubkey)); }
    return;
  }
  if (m.type === "peer") { if (m.online) { agentPubkey = m.pubkey; console.log("[phone] agent online fp:", fingerprint(agentPubkey)); } return; }
  if (m.type === "e2e") {
    const inner = open(m, agentPubkey, keys.secretKey);
    if (!inner) { console.error("[phone] decrypt failed"); return; }
    if (inner.type === "needPairing") {
      console.log("[phone] agent requested pairing. code=" + (CODE || "(none!)"));
      sendSealed({ type: "pair", tag: sas(CODE, agentPubkey, keys.publicKey) });
      return;
    }
    if (inner.type === "paired") { console.log("[phone] paired:", inner.ok ? "OK ✓" : "FAIL — " + inner.reason); if (inner.ok) { ready = true; maybePrompt(); } else process.exit(1); return; }
    if (inner.type === "hello") { console.log("[phone] <hello> (already paired) status=" + inner.state.status); ready = true; maybePrompt(); return; }
    if (inner.type === "assistantDelta") { process.stdout.write(inner.text); return; }
    if (inner.type === "event") { console.log("[event]", inner.event.kind, "—", (inner.event.text || "").slice(0, 80)); return; }
    if (inner.type === "state" || inner.type === "diff") return;
    console.log("[" + inner.type + "]", JSON.stringify(inner).slice(0, 100));
  }
});
ws.on("close", () => console.log("\n[phone] closed"));
setTimeout(() => { console.log("\n[phone] done"); process.exit(0); }, 40000);
