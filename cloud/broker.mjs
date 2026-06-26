// CodexApp cloud broker (v1).
//
// A dumb, account-authenticated message router. The PC agent and the phone
// each connect OUTBOUND to this server (so it works behind any NAT, no port
// forwarding). The broker matches them by account and forwards their
// END-TO-END-ENCRYPTED envelopes — it never sees plaintext.
//
//   [phone] --WSS /link--> [BROKER] <--WSS /link-- [PC agent]
//                          (auth + route ciphertext)
//
// Run:  node cloud/broker.mjs
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "0.0.0.0";
// TLS: set TLS_CERT + TLS_KEY (PEM paths) for wss/https; otherwise plain ws/http.
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;
// Dev convenience: auto-create an account on first login. Disable in prod.
const ALLOW_AUTOREGISTER = process.env.ALLOW_AUTOREGISTER !== "0";

// ---- accounts (minimal; replace with a real DB + JWT in production) ----
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")); } catch { return {}; }
}
function saveAccounts(a) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(a, null, 2)); }
const accounts = loadAccounts(); // email -> { accountId, salt, hash }
const tokens = new Map();        // sessionToken -> accountId

function hashPw(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}
function register(email, password) {
  if (accounts[email]) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  const accountId = crypto.randomUUID();
  accounts[email] = { accountId, salt, hash: hashPw(password, salt) };
  saveAccounts(accounts);
  return accountId;
}
function login(email, password) {
  let acc = accounts[email];
  if (!acc && ALLOW_AUTOREGISTER) { register(email, password); acc = accounts[email]; }
  if (!acc) return null;
  if (hashPw(password, acc.salt) !== acc.hash) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  tokens.set(token, acc.accountId);
  return { token, accountId: acc.accountId };
}

// ---- routing: accountId -> { agent, phone } (one of each for v1) ----
const rooms = new Map();
function room(id) { if (!rooms.has(id)) rooms.set(id, { agent: null, phone: null }); return rooms.get(id); }
const peerRole = (r) => (r === "agent" ? "phone" : "agent");

// ---- HTTP(S) (auth endpoints) ----
function requestHandler(req, res) {
  if (req.method === "POST" && (req.url === "/api/login" || req.url === "/api/register")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let p; try { p = JSON.parse(body || "{}"); } catch { p = {}; }
      res.setHeader("content-type", "application/json");
      if (!p.email || !p.password) { res.writeHead(400); return res.end(JSON.stringify({ error: "email/password required" })); }
      if (req.url === "/api/register") {
        const id = register(p.email, p.password);
        if (!id) { res.writeHead(409); return res.end(JSON.stringify({ error: "exists" })); }
        return res.end(JSON.stringify({ accountId: id }));
      }
      const r = login(p.email, p.password);
      if (!r) { res.writeHead(401); return res.end(JSON.stringify({ error: "invalid credentials" })); }
      res.end(JSON.stringify(r));
    });
    return;
  }
  if (req.url === "/health") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  res.writeHead(404); res.end("not found");
}

const useTls = TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);
const scheme = useTls ? "https/wss" : "http/ws";
const server = useTls
  ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, requestHandler)
  : http.createServer(requestHandler);

// ---- WebSocket link ----
const wss = new WebSocketServer({ server, path: "/link" });

function sendJson(ws, obj) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }

wss.on("connection", (ws) => {
  ws.accountId = null; ws.role = null;

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }

    // First message must authenticate.
    if (!ws.accountId) {
      if (m.type !== "auth") { sendJson(ws, { type: "error", message: "auth required" }); return ws.close(4001); }
      const accountId = tokens.get(m.token);
      if (!accountId) { sendJson(ws, { type: "error", message: "invalid token" }); return ws.close(4001); }
      if (m.role !== "agent" && m.role !== "phone") { sendJson(ws, { type: "error", message: "bad role" }); return ws.close(4002); }
      ws.accountId = accountId; ws.role = m.role; ws.pubkey = m.pubkey || null;
      const rm = room(accountId);
      rm[m.role] = ws;
      const peer = rm[peerRole(m.role)];
      sendJson(ws, { type: "authed", role: m.role, peerOnline: !!peer, peerPubkey: peer?.pubkey || null });
      // Tell the peer we're online + our pubkey (for E2E key exchange).
      if (peer) sendJson(peer, { type: "peer", online: true, pubkey: ws.pubkey });
      console.log(`[broker] ${m.role} online for ${accountId.slice(0, 8)} (peer ${peer ? "online" : "offline"})`);
      return;
    }

    // After auth: only forward E2E envelopes to the peer. Broker can't read them.
    if (m.type === "e2e") {
      const rm = rooms.get(ws.accountId);
      const peer = rm && rm[peerRole(ws.role)];
      if (peer) sendJson(peer, { type: "e2e", from: ws.role, nonce: m.nonce, box: m.box });
      else sendJson(ws, { type: "peer", online: false });
      return;
    }
  });

  ws.on("close", () => {
    if (!ws.accountId) return;
    const rm = rooms.get(ws.accountId);
    if (rm && rm[ws.role] === ws) {
      rm[ws.role] = null;
      const peer = rm[peerRole(ws.role)];
      if (peer) sendJson(peer, { type: "peer", online: false });
      if (!rm.agent && !rm.phone) rooms.delete(ws.accountId);
      console.log(`[broker] ${ws.role} offline for ${ws.accountId.slice(0, 8)}`);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`CodexApp broker [${scheme}] on ${HOST}:${PORT}  (POST /api/login, WS /link)  autoRegister=${ALLOW_AUTOREGISTER}`);
});
