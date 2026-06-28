// CodexApp PC agent (cloud mode) — with a built-in local control panel.
//
// Runs on the user's PC next to Codex. Double-click → it opens a local web panel
// (http://127.0.0.1:7878) where you LOGIN / REGISTER and watch status. After
// login it connects OUTBOUND to the cloud broker, authenticates with the account,
// and bridges the broker <-> local `codex app-server`. All phone/web traffic is
// end-to-end encrypted; the broker only relays ciphertext.
//
// SECURITY: a client must complete a PAIRING-CODE handshake (SAS over both public
// keys) before the agent sends any data or runs any command; paired keys are pinned.
//
// Run:  node cloud/agent.mjs        (or the packaged CodexApp-Agent.exe)
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
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
  originator: "codex_vscode", panelPort: 7878,
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
function saveConfig() {
  const out = { ...config }; // persist current settings (incl. login) next to the exe
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2));
}

function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const b = crypto.randomBytes(6);
  return Array.from(b).map((x) => A[x % A.length]).join("");
}
function loadPairing() {
  let p = null;
  if (fs.existsSync(PAIRING_FILE)) { try { p = JSON.parse(fs.readFileSync(PAIRING_FILE, "utf8")); } catch {} }
  if (!p) p = { code: genCode() };
  if (!Array.isArray(p.pinnedPhones)) p.pinnedPhones = p.pinnedPhone ? [p.pinnedPhone] : [];
  delete p.pinnedPhone;
  if (!p.code) p.code = genCode();
  fs.writeFileSync(PAIRING_FILE, JSON.stringify(p, null, 2));
  return p;
}
function savePairing() { fs.writeFileSync(PAIRING_FILE, JSON.stringify(pairing, null, 2)); }

const config = loadConfig();
const keys = loadOrCreateKeyPair(KEYS_FILE);
const pairing = loadPairing();
fs.writeFileSync(PAIRING_TXT, pairing.code + "\n");

// ---- live status (read by the control panel) ----
const status = {
  phase: "needLogin", // needLogin|startingCodex|loggingIn|connecting|waitingPeer|pairing|paired|membership|error
  brokerConnected: false,
  codexConnected: false,
  peerOnline: false,
  paired: false,
  pairingCode: pairing.code,
  fingerprint: fingerprint(keys.publicKey),
  pinnedCount: pairing.pinnedPhones.length,
  email: config.email || "",
  brokerUrl: config.brokerUrl,
  error: "",
};
function setStatus(p) { Object.assign(status, p); }

let ws = null;
let phonePubkey = null;
let trusted = false;
let backoff = 1000;
let membershipWait = false; // true after a membership_required rejection (slow retry)
let running = false;        // user has logged in / wants to be connected

const bridge = new CodexBridge(config, (msg) => {
  status.codexConnected = !!bridge.state.codexConnected;
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
  status.peerOnline = true;
  if (pubkey && pairing.pinnedPhones.includes(pubkey)) {
    trusted = true;
    setStatus({ phase: "paired", paired: true });
    console.log("[agent] phone trusted (pinned) " + fingerprint(pubkey));
    sendSnapshot();
  } else {
    trusted = false;
    setStatus({ phase: "pairing", paired: false });
    console.log("[agent] phone needs pairing " + fingerprint(pubkey) + "  code=" + pairing.code);
    sendCtrl({ type: "needPairing" });
  }
}

function handlePair(inner) {
  const expected = sas(pairing.code, keys.publicKey, phonePubkey);
  if (inner.tag && inner.tag === expected) {
    if (!pairing.pinnedPhones.includes(phonePubkey)) pairing.pinnedPhones.push(phonePubkey);
    savePairing();
    trusted = true;
    setStatus({ phase: "paired", paired: true, pinnedCount: pairing.pinnedPhones.length });
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
      setStatus({ phase: m.peerOnline ? "connecting" : "waitingPeer", brokerConnected: true, error: "" });
      console.log("[agent] linked. peerOnline=" + m.peerOnline);
      if (m.peerOnline && m.peerPubkey) onPhoneOnline(m.peerPubkey);
      return;
    }
    if (m.type === "peer") {
      if (m.online) onPhoneOnline(m.pubkey);
      else { phonePubkey = null; trusted = false; setStatus({ phase: "waitingPeer", peerOnline: false, paired: false }); console.log("[agent] phone offline"); }
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
    if (m.type === "error") {
      if (m.code === "membership_required") {
        membershipWait = true;
        setStatus({ phase: "membership", error: "云端会员未开通或已过期" });
        console.error("[agent] 云端会员未开通或已过期。请在客户端用兑换码开通；将每 60 秒自动重试。(局域网模式不受影响)");
      } else { setStatus({ error: m.message || "broker error" }); console.error("[agent] broker error:", m.message); }
    }
  });
  ws.on("close", () => {
    phonePubkey = null; trusted = false;
    setStatus({ brokerConnected: false, peerOnline: false, paired: false });
    if (!running) { setStatus({ phase: "needLogin" }); return; }
    if (status.phase !== "membership") setStatus({ phase: "connecting" });
    const delay = membershipWait ? 60000 : backoff;
    membershipWait = false;
    setTimeout(startAgent, delay);
    backoff = Math.min(backoff * 1.6, 15000);
  });
  ws.on("error", () => { try { ws.close(); } catch {} });
}

async function startAgent() {
  if (!config.email || !config.password) { running = false; setStatus({ phase: "needLogin" }); return; }
  running = true;
  try {
    setStatus({ phase: "loggingIn", email: config.email, brokerUrl: config.brokerUrl, error: "" });
    const token = await login(); // validate creds BEFORE spawning Codex
    setStatus({ phase: "startingCodex" });
    if (!bridge.state.codexConnected) await bridge.start();
    status.codexConnected = !!bridge.state.codexConnected;
    setStatus({ phase: "connecting" });
    connect(token);
  } catch (e) {
    const msg = String(e.message || e);
    console.error("[agent] start failed:", msg);
    // Auth problems won't fix themselves: drop back to the login form with a reason
    // (and don't retry — this is what caused the 401→retry→429 rate-limit loop).
    if (/login failed: 401/.test(msg)) { running = false; setStatus({ phase: "needLogin", error: "邮箱或密码错误，请重新登录" }); return; }
    if (/login failed: 403/.test(msg)) { running = false; setStatus({ phase: "needLogin", error: "邮箱未验证：请先点验证邮件里的链接，再登录" }); return; }
    const rate = /login failed: 429/.test(msg);
    setStatus({ phase: "error", error: rate ? "登录过于频繁，60 秒后自动重试…" : ("连接失败：" + msg) });
    if (running) setTimeout(startAgent, rate ? 60000 : 3000);
  }
}

// ---- local control panel (login / register / status), 127.0.0.1 only ----
function readJson(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 8192) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

function startPanel(port, tries = 0) {
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PANEL_HTML);
      }
      if (req.method === "GET" && req.url === "/api/status") return send(200, status);

      if (req.method === "POST" && req.url === "/api/register") {
        const b = await readJson(req);
        const url = (b.brokerUrl || config.brokerUrl).replace(/\/+$/, "");
        try {
          const r = await fetch(url + "/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: b.email, password: b.password }) });
          const j = await r.json().catch(() => ({}));
          return send(r.status, j);
        } catch (e) { return send(502, { error: "连不上 Broker：" + e.message }); }
      }
      if (req.method === "POST" && req.url === "/api/login") {
        const b = await readJson(req);
        config.brokerUrl = (b.brokerUrl || config.brokerUrl).trim();
        config.email = (b.email || "").trim();
        config.password = b.password || "";
        saveConfig();
        setStatus({ email: config.email, brokerUrl: config.brokerUrl, error: "" });
        running = true;
        if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch {} } // reconnect with new creds
        else startAgent();
        return send(200, { ok: true });
      }
      if (req.method === "POST" && req.url === "/api/logout") {
        running = false; config.email = ""; config.password = ""; saveConfig();
        try { ws && ws.close(); } catch {}
        setStatus({ phase: "needLogin", brokerConnected: false, peerOnline: false, paired: false, email: "" });
        return send(200, { ok: true });
      }
      res.writeHead(404); res.end("not found");
    } catch (e) { send(500, { error: String(e.message || e) }); }
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE" && tries < 5) return startPanel(port + 1, tries + 1);
    console.error("[panel] cannot start:", e.message);
  });
  server.listen(port, "127.0.0.1", () => {
    const url = "http://127.0.0.1:" + port;
    console.log("[panel] 控制面板: " + url);
    console.log("[agent] device fingerprint:", status.fingerprint, " PAIRING CODE:", pairing.code);
    // Open the panel in the browser on run. The installer's autostart launcher sets
    // CODEXAPP_NO_OPEN=1 so the background agent stays silent (panel still at this URL).
    if (process.platform === "win32" && !process.env.CODEXAPP_NO_OPEN) { try { exec('start "" "' + url + '"'); } catch {} }
  });
}

const PANEL_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CodexApp 电脑客户端</title>
<style>
:root{--bg:#0b1220;--card:#15203a;--bg2:#0f1830;--line:#243154;--text:#e6ecf7;--muted:#8a98b8;--accent:#35d07f;--accent2:#4aa8ff;--danger:#ff5c6c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;width:100%;max-width:420px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);font-size:13px;margin:0 0 16px}
label{display:block;font-size:13px;color:var(--muted);margin:12px 0 5px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg2);color:var(--text);font-size:15px}
.btn{width:100%;border:0;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;margin-top:14px}
.primary{background:var(--accent);color:#042}.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:600}
.tabs{display:flex;background:var(--bg2);border-radius:10px;padding:4px;margin-bottom:6px}
.tab{flex:1;text-align:center;padding:9px;border-radius:8px;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer}
.tab.on{background:var(--card);color:var(--text)}
.msg{color:var(--muted);font-size:13px;margin-top:12px;min-height:18px}
.row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}.k{color:var(--muted);font-size:13px}.v{font-size:13px;font-weight:600}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:6px}.dot.on{background:var(--accent)}
.code{font-size:30px;font-weight:800;letter-spacing:5px;color:var(--accent);text-align:center;margin:6px 0 2px}
.pill{display:inline-block;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700}
.hidden{display:none}
.hint{color:var(--muted);font-size:12px;margin-top:10px;line-height:1.5}
</style></head><body>
<div class="card">
  <h1>CodexApp 电脑客户端</h1>
  <p class="sub">登录后自动连接，手机/网页即可远程控制本机 Codex</p>

  <div id="auth">
    <div class="tabs"><div id="tabLogin" class="tab on">登录</div><div id="tabReg" class="tab">注册</div></div>
    <label>Broker 地址</label><input id="broker" placeholder="http://127.0.0.1:8787">
    <label>邮箱</label><input id="email" placeholder="you@example.com" autocapitalize="off">
    <label>密码</label><input id="pass" type="password" placeholder="至少 8 位">
    <button id="loginBtn" class="btn primary">登录并启动</button>
    <button id="regBtn" class="btn ghost hidden">注册账号</button>
    <p id="msg" class="msg"></p>
  </div>

  <div id="panel" class="hidden">
    <div id="pill" class="pill" style="background:var(--bg2);color:var(--muted)">…</div>
    <div id="pairBox" class="hidden" style="margin-top:14px">
      <div class="k">在手机/网页客户端首次连接时输入配对码：</div>
      <div id="code" class="code">------</div>
    </div>
    <div style="margin-top:14px">
      <div class="row"><span class="k"><span id="d_broker" class="dot"></span>Broker 连接</span><span id="v_broker" class="v">—</span></div>
      <div class="row"><span class="k"><span id="d_codex" class="dot"></span>本地 Codex</span><span id="v_codex" class="v">—</span></div>
      <div class="row"><span class="k"><span id="d_peer" class="dot"></span>客户端在线</span><span id="v_peer" class="v">—</span></div>
      <div class="row"><span class="k">账号</span><span id="v_email" class="v">—</span></div>
      <div class="row"><span class="k">本机指纹</span><span id="v_fp" class="v">—</span></div>
      <div class="row"><span class="k">已配对设备</span><span id="v_pin" class="v">—</span></div>
    </div>
    <p id="perr" class="msg"></p>
    <button id="logoutBtn" class="btn ghost">退出登录</button>
    <p class="hint">网页客户端：用浏览器打开你的 Broker 地址（云端模式），用同一账号登录后输入上面的配对码即可。</p>
  </div>
</div>
<script>
var $=function(id){return document.getElementById(id)};
var mode="login";
function setMode(m){mode=m;$("tabLogin").className="tab"+(m==="login"?" on":"");$("tabReg").className="tab"+(m==="reg"?" on":"");
  $("loginBtn").className="btn primary"+(m==="login"?"":" hidden");$("regBtn").className="btn ghost"+(m==="reg"?"":" hidden");$("msg").textContent="";}
$("tabLogin").onclick=function(){setMode("login")};$("tabReg").onclick=function(){setMode("reg")};
function body(){return{brokerUrl:$("broker").value.trim(),email:$("email").value.trim(),password:$("pass").value}}
$("loginBtn").onclick=function(){
  var b=body();if(!b.brokerUrl||!b.email||!b.password){$("msg").textContent="请填写 Broker、邮箱、密码";return;}
  $("msg").textContent="登录中…";
  fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})
   .then(function(r){return r.json()}).then(function(){poll()}).catch(function(e){$("msg").textContent="出错："+e.message});
};
$("regBtn").onclick=function(){
  var b=body();if(!b.brokerUrl||!b.email||!b.password){$("msg").textContent="请填写 Broker、邮箱、密码";return;}
  $("msg").textContent="注册中…";
  fetch("/api/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})
   .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
   .then(function(o){
     if(o.s===409){$("msg").textContent="账号已存在，请直接登录。";return;}
     if(o.s>=400){$("msg").textContent="注册失败："+(o.j.error||o.s);return;}
     $("msg").textContent=o.j.emailSent?"✅ 验证邮件已发送，请查收并点链接验证，然后登录。":"账号已创建。未配 SMTP：验证链接在 Broker 日志里。验证后登录。";
   }).catch(function(e){$("msg").textContent="出错："+e.message});
};
$("logoutBtn").onclick=function(){fetch("/api/logout",{method:"POST"}).then(function(){location.reload()})};

var LABEL={needLogin:"未登录",startingCodex:"正在启动本地 Codex…",loggingIn:"正在登录…",connecting:"连接中…",waitingPeer:"已连接，等待客户端…",pairing:"等待配对（请输入配对码）",paired:"已连接 ✓ 可远程控制",membership:"云端会员未开通/已过期",error:"出错"};
var COLOR={paired:"var(--accent)",waitingPeer:"var(--accent2)",pairing:"var(--accent2)",membership:"var(--danger)",error:"var(--danger)"};
function render(s){
  if(s.phase==="needLogin"){$("auth").className="";$("panel").className="hidden";
    if(s.brokerUrl&&!$("broker").value)$("broker").value=s.brokerUrl;
    if(s.email&&!$("email").value)$("email").value=s.email;
    if(s.error)$("msg").textContent="⚠ "+s.error;
    return;}
  $("auth").className="hidden";$("panel").className="";
  var pill=$("pill");pill.textContent=LABEL[s.phase]||s.phase;pill.style.color="#042";pill.style.background=COLOR[s.phase]||"var(--muted)";
  var showPair=(s.phase==="pairing"||s.phase==="waitingPeer"||s.phase==="paired");
  $("pairBox").className=showPair?"":"hidden";$("code").textContent=s.pairingCode||"------";
  $("d_broker").className="dot"+(s.brokerConnected?" on":"");$("v_broker").textContent=s.brokerConnected?"已连接":"未连接";
  $("d_codex").className="dot"+(s.codexConnected?" on":"");$("v_codex").textContent=s.codexConnected?"已就绪":"未就绪";
  $("d_peer").className="dot"+(s.peerOnline?" on":"");$("v_peer").textContent=s.peerOnline?(s.paired?"已配对":"待配对"):"离线";
  $("v_email").textContent=s.email||"—";$("v_fp").textContent=s.fingerprint||"—";$("v_pin").textContent=(s.pinnedCount||0)+" 台";
  $("perr").textContent=s.error?("⚠ "+s.error):"";
}
function poll(){fetch("/api/status").then(function(r){return r.json()}).then(render).catch(function(){});}
poll();setInterval(poll,1500);
</script></body></html>`;

// ---- boot ----
startPanel(config.panelPort);
if (config.email && config.password) startAgent();
else setStatus({ phase: "needLogin" });
