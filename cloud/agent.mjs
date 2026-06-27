// CodexApp PC agent (cloud mode).
//
// Runs on the user's PC next to Codex. Connects OUTBOUND to the cloud broker
// (works behind any NAT), authenticates with the user's account, and bridges
// the broker <-> local `codex app-server`. All messages to/from the phone are
// end-to-end encrypted; the broker only relays ciphertext.
//
// SECURITY: a phone must complete a PAIRING-CODE handshake before the agent
// sends it any data or runs any command. The code (shown here) is mixed into a
// SAS over both public keys, so a malicious broker that swaps keys (MITM) is
// detected. Once paired, the phone's public key is pinned for future sessions.
//
// Run:  node cloud/agent.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { CodexBridge } from "../core/codexBridge.mjs";
import { loadOrCreateKeyPair, seal, open, fingerprint, sas } from "./e2e.mjs";

function appDir() {
  const exe = process.execPath;
  const packaged = !/[\\/]node(\.exe)?$/i.test(exe);
  if (packaged) return path.dirname(exe);
  return path.dirname(fileURLToPath(import.meta.url));
}
const BASE = appDir();
const CONFIG_FILE = path.join(BASE, "agent.config.json");
const KEYS_FILE = path.join(BASE, "agent.keys.json");
const PAIRING_FILE = path.join(BASE, "agent.pairing.json");
const PAIRING_TXT = path.join(BASE, "pairing-code.txt");

const DEFAULTS = {
  brokerUrl: "http://127.0.0.1:8787", email: "", password: "", codexBin: "",
  defaultCwd: "C:\\test", approvalPolicy: "on-request", sandbox: "workspace-write", model: null,
  originator: "codex_vscode",
};

function loadConfig() {
  let cfg = { ...DEFAULTS };
  if (fs.existsSync(CONFIG_FILE)) cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
  else fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  cfg.brokerUrl = process.env.CODEXAPP_BROKER || cfg.brokerUrl;
  cfg.email = process.env.CODEXAPP_EMAIL || cfg.email;
  cfg.password = process.env.CODEXAPP_PASSWORD || cfg.password;
  return cfg;
}

function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const b = crypto.randomBytes(6);
  return Array.from(b).map((x) => A[x % A.length]).join("");
}
function loadPairing() {
  if (fs.existsSync(PAIRING_FILE)) { try { return JSON.parse(fs.readFileSync(PAIRING_FILE, "utf8")); } catch {} }
  const p = { pinnedPhone: null, code: genCode() };
  fs.writeFileSync(PAIRING_FILE, JSON.stringify(p, null, 2));
  return p;
}
function savePairing() { fs.writeFileSync(PAIRING_FILE, JSON.stringify(pairing, null, 2)); }

const config = loadConfig();
const keys = loadOrCreateKeyPair(KEYS_FILE);
const pairing = loadPairing();
// Expose the current pairing code for the installer to display.
fs.writeFileSync(PAIRING_TXT, pairing.code + "\n");
console.log("[agent] device fingerprint:", fingerprint(keys.publicKey));
console.log("[agent] PAIRING CODE: " + pairing.code + (pairing.pinnedPhone ? "  (已有配对手机；新手机需此码)" : "  (在手机上输入此码完成配对)"));

let ws = null;
let phonePubkey = null;
let trusted = false;
let backoff = 1000;

const bridge = new CodexBridge(config, (msg) => {
  // CodexApp data only flows to a PAIRED phone.
  if (!trusted || !phonePubkey || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "e2e", ...seal(msg, phonePubkey, keys.secretKey) }));
});

function sendCtrl(obj) {
  if (!phonePubkey || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "e2e", ...seal(obj, phonePubkey, keys.secretKey) }));
}
function sendSnapshot() { if (trusted) sendCtrl(bridge.snapshot()); }

function onPhoneOnline(pubkey) {
  phonePubkey = pubkey;
  if (pubkey && pubkey === pairing.pinnedPhone) {
    trusted = true;
    console.log("[agent] phone trusted (pinned) " + fingerprint(pubkey));
    sendSnapshot();
  } else {
    trusted = false;
    console.log("[agent] phone needs pairing " + fingerprint(pubkey) + "  code=" + pairing.code);
    sendCtrl({ type: "needPairing" });
  }
}

function handlePair(inner) {
  const expected = sas(pairing.code, keys.publicKey, phonePubkey);
  if (inner.tag && inner.tag === expected) {
    pairing.pinnedPhone = phonePubkey;
    savePairing();
    trusted = true;
    console.log("[agent] PAIRED ✓ phone " + fingerprint(phonePubkey));
    sendCtrl({ type: "paired", ok: true });
    sendSnapshot();
  } else {
    console.warn("[agent] pairing REJECTED (code mismatch or MITM)");
    sendCtrl({ type: "paired", ok: false, reason: "配对码不匹配或存在中间人" });
  }
}

async function login() {
  const res = await fetch(config.brokerUrl.replace(/\/+$/, "") + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!res.ok) throw new Error("login failed: " + res.status + " " + (await res.text()));
  return (await res.json()).token;
}

function connect(token) {
  ws = new WebSocket(config.brokerUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/link");
  ws.on("open", () => { backoff = 1000; ws.send(JSON.stringify({ type: "auth", token, role: "agent", pubkey: keys.publicKey })); });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "authed") {
      console.log("[agent] linked. peerOnline=" + m.peerOnline);
      if (m.peerOnline && m.peerPubkey) onPhoneOnline(m.peerPubkey);
      return;
    }
    if (m.type === "peer") {
      if (m.online) onPhoneOnline(m.pubkey);
      else { phonePubkey = null; trusted = false; console.log("[agent] phone offline"); }
      return;
    }
    if (m.type === "e2e") {
      const inner = open(m, phonePubkey, keys.secretKey);
      if (!inner) { console.error("[agent] decrypt failed"); return; }
      if (!trusted) {
        if (inner.type === "pair") handlePair(inner);
        else sendCtrl({ type: "needPairing" }); // ignore commands until paired
        return;
      }
      bridge.dispatch(inner).catch((e) => sendCtrl({ type: "error", message: e.message }));
      return;
    }
    if (m.type === "error") console.error("[agent] broker error:", m.message);
  });
  ws.on("close", () => { phonePubkey = null; trusted = false; setTimeout(start, backoff); backoff = Math.min(backoff * 1.6, 15000); });
  ws.on("error", () => { try { ws.close(); } catch {} });
}

async function start() {
  try {
    if (!config.email || !config.password) {
      console.error("[agent] set email/password in agent.config.json (or CODEXAPP_EMAIL/PASSWORD env)");
      process.exit(1);
    }
    if (!bridge.state.codexConnected) await bridge.start();
    const token = await login();
    connect(token);
  } catch (e) {
    console.error("[agent] start failed:", e.message);
    setTimeout(start, 3000);
  }
}

start();
