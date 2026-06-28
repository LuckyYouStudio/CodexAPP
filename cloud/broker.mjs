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
import * as db from "./db.mjs";
import { sendVerifyEmail, emailConfigured, testSmtp, getSmtpConfig } from "./mailer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");
const SECRET_FILE = path.join(__dirname, "broker.secret");
const WEB_DIR = path.join(__dirname, "..", "web"); // broker hosts the web client
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "0.0.0.0";
// TLS: set TLS_CERT + TLS_KEY (PEM paths) for wss/https; otherwise plain ws/http.
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // set to enable the /admin backend
// Dev convenience: auto-create an account on first login. Disable in prod.
// ---- accounts (SQLite) + signed tokens + email verification ----
const migrated = db.migrateFromJson(ACCOUNTS_FILE); // one-time import from legacy accounts.json
if (migrated) console.log(`[broker] migrated ${migrated} accounts from accounts.json -> SQLite`);
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const newVerifyToken = () => crypto.randomBytes(24).toString("base64url");
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  return `${proto}://${req.headers.host}`;
}

// Server secret signs tokens; persisted so tokens survive broker restarts.
function loadSecret() {
  try { return fs.readFileSync(SECRET_FILE); } catch {}
  const s = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, s);
  return s;
}
const SECRET = loadSecret();
const TOKEN_TTL_SEC = 30 * 24 * 3600; // 30 days

function signToken(accountId) {
  const payload = Buffer.from(JSON.stringify({ sub: accountId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!p.sub || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
  return p.sub;
}

function hashPw(password, salt) { return crypto.scryptSync(password, salt, 32).toString("hex"); }
function validEmail(e) { return typeof e === "string" && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
function validPassword(p) { return typeof p === "string" && p.length >= 8 && p.length <= 200; }
function eq(a, b) { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

function register(email, password) {
  if (db.getByEmail(email)) return { error: "exists" };
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString("hex");
  const token = newVerifyToken();
  db.createAccount({ id, email, salt, hash: hashPw(password, salt), email_verified: 0, verify_token: token, verify_expires: Date.now() + VERIFY_TTL_MS, created_at: Date.now() });
  return { accountId: id, verifyToken: token };
}
function login(email, password) {
  const acc = db.getByEmail(email);
  if (!acc || !eq(hashPw(password, acc.salt), acc.hash)) return { ok: false, code: "invalid" };
  if (!acc.email_verified) return { ok: false, code: "unverified" };
  return { ok: true, token: signToken(acc.id), accountId: acc.id };
}
function issueVerify(email) {
  const acc = db.getByEmail(email);
  if (!acc || acc.email_verified) return null;
  const token = newVerifyToken();
  db.setVerifyToken(acc.id, token, Date.now() + VERIFY_TTL_MS);
  return token;
}

// ---- login/register rate limiting (per IP+email sliding window) ----
const attempts = new Map();
const RL_WINDOW = 15 * 60 * 1000, RL_MAX = 8;
function rateLimited(key) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < RL_WINDOW);
  arr.push(now);
  attempts.set(key, arr);
  return arr.length > RL_MAX;
}

// ---- routing: accountId -> { agent, phone } (one of each for v1) ----
const rooms = new Map();
function room(id) { if (!rooms.has(id)) rooms.set(id, { agent: null, phone: null }); return rooms.get(id); }
const peerRole = (r) => (r === "agent" ? "phone" : "agent");

function verifyPage(title, msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CodexApp</title>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1220;color:#e6ecf7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:420px;padding:32px;text-align:center">
<h1 style="font-size:22px">${title}</h1><p style="color:#8a98b8">${msg}</p>
<a href="/" style="display:inline-block;margin-top:16px;background:#35d07f;color:#042;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">打开 CodexApp</a>
</div></body>`;
}

// ---- admin backend (gated by ADMIN_TOKEN) ----
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 8192) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}
function adminOk(req) {
  const t = String(req.headers["x-admin-token"] || "");
  return !!ADMIN_TOKEN && t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
}
async function handleAdmin(req, res) {
  res.setHeader("content-type", "application/json");
  if (!ADMIN_TOKEN) { res.writeHead(503); return res.end(JSON.stringify({ error: "admin 未启用：请在 broker.env 设置 ADMIN_TOKEN 后重启" })); }
  if (!adminOk(req)) { res.writeHead(401); return res.end(JSON.stringify({ error: "无效管理员令牌" })); }
  const p = new URL(req.url, "http://localhost").pathname;
  const G = req.method === "GET", P = req.method === "POST";

  if (P && p === "/api/admin/login") return res.end(JSON.stringify({ ok: true }));

  if (G && p === "/api/admin/smtp") {
    const c = getSmtpConfig();
    return res.end(JSON.stringify({ host: c.host, port: c.port, user: c.user, from: c.from, fromName: c.fromName, secure: c.secure, hasPass: !!c.pass }));
  }
  if (P && p === "/api/admin/smtp") {
    const b = await readBody(req);
    db.setSetting("smtp_host", b.host || "");
    db.setSetting("smtp_port", String(b.port || 587));
    db.setSetting("smtp_user", b.user || "");
    if (b.pass) db.setSetting("smtp_pass", b.pass); // blank = keep current
    db.setSetting("smtp_from", b.from || "");
    db.setSetting("smtp_from_name", b.fromName || "");
    db.setSetting("smtp_secure", b.secure ? "1" : "0");
    return res.end(JSON.stringify({ ok: true }));
  }
  if (P && p === "/api/admin/smtp/test") {
    const b = await readBody(req);
    return res.end(JSON.stringify(await testSmtp(b.to || "")));
  }

  if (G && p === "/api/admin/overview") {
    const online = [];
    for (const [aid, r] of rooms) {
      if (!r.agent && !r.phone) continue;
      const acc = db.getById(aid);
      online.push({ email: acc ? acc.email : aid.slice(0, 8), agent: !!r.agent, phone: !!r.phone });
    }
    const users = db.listAccounts(200).map((u) => ({ id: u.id, email: u.email, verified: !!u.email_verified, createdAt: u.created_at }));
    return res.end(JSON.stringify({ counts: db.counts(), online, users }));
  }
  if (P && p === "/api/admin/user/verify") { const b = await readBody(req); if (b.id) db.setVerified(b.id); return res.end(JSON.stringify({ ok: true })); }
  if (P && p === "/api/admin/user/resend") {
    const b = await readBody(req);
    const token = b.email && issueVerify(b.email);
    if (token) { try { await sendVerifyEmail(b.email, baseUrl(req) + "/verify?token=" + token); } catch (e) { console.error(e.message); } }
    return res.end(JSON.stringify({ ok: true }));
  }
  if (P && p === "/api/admin/user/delete") {
    const b = await readBody(req);
    if (b.id) {
      const r = rooms.get(b.id);
      if (r) { try { r.agent && r.agent.close(); r.phone && r.phone.close(); } catch {} }
      db.deleteAccount(b.id);
    }
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404); res.end(JSON.stringify({ error: "未知接口" }));
}

// ---- HTTP(S) (auth + verification + web hosting) ----
function requestHandler(req, res) {
  if (req.url.startsWith("/api/admin")) return handleAdmin(req, res);
  if (req.method === "POST" && (req.url === "/api/login" || req.url === "/api/register" || req.url === "/api/resend-verification")) {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").toString().split(",")[0].trim();
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", async () => {
      let p; try { p = JSON.parse(body || "{}"); } catch { p = {}; }
      res.setHeader("content-type", "application/json");
      if (!validEmail(p.email)) { res.writeHead(400); return res.end(JSON.stringify({ error: "无效邮箱" })); }
      if (rateLimited(ip + "|" + p.email)) { res.writeHead(429); return res.end(JSON.stringify({ error: "尝试过于频繁，请稍后再试" })); }

      if (req.url === "/api/resend-verification") {
        const token = issueVerify(p.email);
        if (token) { try { await sendVerifyEmail(p.email, baseUrl(req) + "/verify?token=" + token); } catch (e) { console.error("[mail]", e.message); } }
        return res.end(JSON.stringify({ ok: true })); // don't reveal whether the account exists
      }

      if (!validPassword(p.password)) { res.writeHead(400); return res.end(JSON.stringify({ error: "密码至少 8 位" })); }

      if (req.url === "/api/register") {
        const r = register(p.email, p.password);
        if (r.error === "exists") { res.writeHead(409); return res.end(JSON.stringify({ error: "账号已存在" })); }
        try { await sendVerifyEmail(p.email, baseUrl(req) + "/verify?token=" + r.verifyToken); } catch (e) { console.error("[mail]", e.message); }
        return res.end(JSON.stringify({ ok: true, needVerify: true, emailSent: emailConfigured() }));
      }

      const r = login(p.email, p.password);
      if (!r.ok && r.code === "unverified") { res.writeHead(403); return res.end(JSON.stringify({ error: "请先验证邮箱（查收验证邮件）", code: "unverified" })); }
      if (!r.ok) { res.writeHead(401); return res.end(JSON.stringify({ error: "邮箱或密码错误" })); }
      res.end(JSON.stringify({ token: r.token, accountId: r.accountId }));
    });
    return;
  }

  // Email verification link.
  if (req.method === "GET" && req.url.startsWith("/verify")) {
    const url = new URL(req.url, "http://localhost");
    const acc = url.searchParams.get("token") && db.getByVerifyToken(url.searchParams.get("token"));
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (acc && (!acc.verify_expires || acc.verify_expires > Date.now())) {
      db.setVerified(acc.id);
      return res.end(verifyPage("✅ 邮箱验证成功", "账号已激活，现在可以在网页或 App 登录了。"));
    }
    res.writeHead(400);
    return res.end(verifyPage("⚠ 链接无效或已过期", "请回到登录页重新发送验证邮件。"));
  }

  if (req.url === "/health") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  // Host the web client (so users just open https://<broker>/ and log in).
  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
    const filePath = path.join(WEB_DIR, path.normalize(p).replace(/^(\.\.[\\/])+/, ""));
    if (filePath.startsWith(WEB_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      return fs.createReadStream(filePath).pipe(res);
    }
  }
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
      const accountId = verifyToken(m.token);
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
  console.log(`CodexApp broker [${scheme}] on ${HOST}:${PORT}  email=${emailConfigured() ? "SMTP" : "console-log (dev)"}  admin=${ADMIN_TOKEN ? "on" : "off (set ADMIN_TOKEN)"}`);
});
