// CodexApp web client. Two modes (the rest of the UI consumes the same protocol):
//   - cloud: email account -> broker (same origin) -> E2E + pairing -> PC agent
//   - lan:   direct WebSocket to a relay (url + token)
"use strict";

const $ = (id) => document.getElementById(id);
const LS = { profile: "codexapp.profile", keys: "codexapp.keys" };

let ws = null;
let backoff = 1000;
let liveAssistant = null;   // the streaming assistant bubble (or null)
let appState = {};
let lastDiff = "";          // latest unified diff for the current turn
let profile = loadProfile();
let keys = loadKeys();      // E2E keypair (cloud mode)
let agentPub = null;        // peer (agent) public key (cloud mode)
let paired = false;

// ---------------------------------------------------------------------------
// Profile + keys
// ---------------------------------------------------------------------------
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(LS.profile)) || {}; } catch { return {}; }
}
function saveProfile(p) { profile = p; localStorage.setItem(LS.profile, JSON.stringify(p)); }
function loadKeys() {
  try { const k = JSON.parse(localStorage.getItem(LS.keys)); if (k && k.publicKey) return k; } catch {}
  const k = window.E2E.newKeyPair();
  localStorage.setItem(LS.keys, JSON.stringify(k));
  return k;
}
function profileReady(p) {
  if (!p) return false;
  if (p.mode === "lan") return !!(p.url && p.token);
  if (p.mode === "cloud") return !!(p.email && p.password);
  return false;
}

// ---------------------------------------------------------------------------
// Boot: setup gate vs app
// ---------------------------------------------------------------------------
function start() {
  if (profileReady(profile)) { showApp(); connect(); }
  else { showSetup(); }
}
function showSetup() {
  $("app").classList.add("hidden");
  $("setup").classList.remove("hidden");
  if (profile.email) $("cEmail").value = profile.email;
  if (profile.url) $("setupUrl").value = profile.url;
}
function showApp() {
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
}
function loginFailed(msg, resend) {
  showSetup();
  switchTab("cloud");
  $("cMsg").textContent = msg;
  if (resend) $("cResend").classList.remove("hidden");
}

function switchTab(m) {
  $("tabCloud").classList.toggle("on", m === "cloud");
  $("tabLan").classList.toggle("on", m === "lan");
  $("cloudForm").classList.toggle("hidden", m !== "cloud");
  $("lanForm").classList.toggle("hidden", m !== "lan");
}
$("tabCloud").onclick = () => switchTab("cloud");
$("tabLan").onclick = () => switchTab("lan");

async function doCloud(register) {
  const email = $("cEmail").value.trim();
  const password = $("cPass").value;
  const pairCode = $("cCode").value.trim().toUpperCase();
  if (!email || !password) { $("cMsg").textContent = "请填邮箱和密码"; return; }
  if (register) {
    try {
      const r = await fetch("/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { $("cMsg").textContent = "账号已存在，请直接登录。"; return; }
      if (!r.ok) { $("cMsg").textContent = "注册失败：" + (j.error || r.status); return; }
      $("cMsg").textContent = j.emailSent
        ? "✅ 验证邮件已发送，请查收并点击链接，然后回来登录。"
        : "账号已创建。SMTP 未配置：请在服务器日志里找到验证链接打开后再登录。";
      $("cResend").classList.remove("hidden");
      return; // wait for email verification, then the user logs in
    } catch (e) { $("cMsg").textContent = "网络错误：" + e.message; return; }
  }
  saveProfile({ mode: "cloud", email, password, pairCode });
  showApp(); connect();
}
$("cLogin").onclick = () => doCloud(false);
$("cRegister").onclick = () => doCloud(true);
$("cResend").onclick = async () => {
  const email = $("cEmail").value.trim();
  if (!email) { $("cMsg").textContent = "请填邮箱"; return; }
  try { await fetch("/api/resend-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); } catch {}
  $("cMsg").textContent = "若该邮箱已注册，验证邮件已重新发送，请查收。";
};
$("cForgot").onclick = async () => {
  const email = $("cEmail").value.trim();
  if (!email) { $("cMsg").textContent = "请先填上面的邮箱，再点忘记密码。"; return; }
  try { await fetch("/api/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); } catch {}
  $("cMsg").textContent = "若该邮箱已注册，重置链接已发送，请查收邮件并按提示设置新密码。";
};

$("setupSave").onclick = () => {
  const url = $("setupUrl").value.trim().replace(/\/+$/, "");
  const token = $("setupToken").value.trim();
  if (!url || !token) return;
  saveProfile({ mode: "lan", url, token });
  showApp(); connect();
};

// ---------------------------------------------------------------------------
// Connection (dual transport)
// ---------------------------------------------------------------------------
function connect() {
  setConn(false, "连接中…");
  if (profile.mode === "cloud") connectCloud();
  else connectLan();
}

function connectLan() {
  try {
    ws = new WebSocket(profile.url.replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(profile.token));
  } catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 1000; };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handle(m); };
  ws.onclose = (ev) => { setConn(false, ev.code === 4001 ? "Token 无效" : "已断开"); if (ev.code === 4001) { forget(); return; } scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

async function connectCloud() {
  agentPub = null; paired = false;
  let token;
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: profile.email, password: profile.password }) });
    if (r.status === 401) { loginFailed("账号或密码错误"); return; }
    if (r.status === 403) { loginFailed("请先验证邮箱（注册后点邮件里的链接）", true); return; }
    if (!r.ok) { scheduleReconnect(); return; }
    token = (await r.json()).token;
  } catch { scheduleReconnect(); return; }

  try { ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/link"); }
  catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 1000; ws.send(JSON.stringify({ type: "auth", token, role: "phone", pubkey: keys.publicKey })); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "authed") { setConn(false, "等待电脑 Agent…"); if (m.peerOnline && m.peerPubkey) agentPub = m.peerPubkey; return; }
    if (m.type === "peer") { agentPub = m.online ? m.pubkey : null; if (!m.online) { paired = false; appState.codexConnected = false; applyState(); } return; }
    if (m.type === "e2e") {
      const inner = window.E2E.open(m, agentPub, keys.secretKey);
      if (!inner) return;
      if (inner.type === "needPairing") {
        if (profile.pairCode && agentPub) {
          ws.send(JSON.stringify({ type: "e2e", ...window.E2E.seal({ type: "pair", tag: window.E2E.sas(profile.pairCode, agentPub, keys.publicKey) }, agentPub, keys.secretKey) }));
        } else { setConn(false, "需要配对码"); }
        return;
      }
      if (inner.type === "paired") { if (inner.ok) paired = true; else setConn(false, "配对失败：" + (inner.reason || "")); return; }
      if (inner.type === "hello") paired = true;
      handle(inner);
      return;
    }
    if (m.type === "error") { if (/token|invalid/i.test(m.message || "")) setConn(false, "登录失效"); return; }
  };
  ws.onclose = () => { setConn(false, "已断开"); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function scheduleReconnect() {
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 1.6, 15000);
}

function sendWs(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (profile.mode === "cloud") {
    if (!agentPub) return;
    ws.send(JSON.stringify({ type: "e2e", ...window.E2E.seal(obj, agentPub, keys.secretKey) }));
  } else {
    ws.send(JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------
function handle(m) {
  switch (m.type) {
    case "hello":
      appState = m.state || {};
      applyState();
      $("feed").innerHTML = "";
      (m.recentEvents || []).forEach(renderEvent);
      $("approvals").innerHTML = "";
      (m.pendingApprovals || []).forEach(renderApproval);
      if (m.config) {
        $("cfgCwd").value = m.config.cwd || "";
        $("cfgApproval").value = m.config.approvalPolicy || "on-request";
        $("cfgSandbox").value = m.config.sandbox || "workspace-write";
      }
      setDiff(m.diff || "");
      scrollFeed();
      break;
    case "state":
      appState = m.state || appState;
      applyState();
      break;
    case "event":
      renderEvent(m.event);
      scrollFeed();
      break;
    case "assistantDelta":
      appendAssistant(m.text);
      break;
    case "approval":
      renderApproval(m.approval);
      notifyApproval(m.approval);
      break;
    case "approvalResolved":
      removeApproval(m.key);
      break;
    case "error":
      renderEvent({ kind: "error", text: m.message, ts: Date.now() });
      scrollFeed();
      break;
    case "diff":
      setDiff(m.diff || "");
      break;
    case "projectTree":
      renderProjectTree(m);
      break;
  }
}

function setConn(ok, label) {
  $("connDot").classList.toggle("on", !!ok);
  if (label) $("statusPill").textContent = label;
}

function applyState() {
  const connected = !!(ws && ws.readyState === WebSocket.OPEN) && appState.codexConnected
    && (profile.mode !== "cloud" || (!!agentPub && paired));
  $("connDot").classList.toggle("on", connected);
  const running = appState.status === "running";
  const pill = $("statusPill");
  pill.textContent = running ? "运行中" : "空闲";
  pill.className = "pill " + (running ? "running" : "idle");
  $("runningBar").classList.toggle("hidden", !running);
  const name = appState.threadName ? "「" + appState.threadName + "」 " : "";
  $("cwdLabel").textContent =
    name + (appState.cwd || "—") +
    (appState.model ? "  ·  " + appState.model : "") +
    "  ·  " + (appState.approvalPolicy || "");
}

// ---------------------------------------------------------------------------
// Feed rendering
// ---------------------------------------------------------------------------
function cls(kind) {
  if (kind === "user") return "user";
  if (kind === "item:agentMessage") return "assistant";
  if (kind && kind.startsWith("item:commandExecution")) return "cmd";
  if (kind && kind.startsWith("item:fileChange")) return "file";
  if (kind && kind.startsWith("item:")) return "tool";
  if (kind === "error") return "error";
  if (kind === "thread" || kind === "turn") return kind;
  if (kind === "approval-requested" || kind === "approval-resolved") return "tool";
  return "tool";
}
function labelFor(kind) {
  if (kind === "user") return "你";
  if (kind === "item:agentMessage") return "Codex";
  return null;
}

function renderEvent(e) {
  // Finalize a streaming assistant bubble when the full message lands.
  if (e.kind === "item:agentMessage" && liveAssistant) {
    liveAssistant.querySelector(".body").textContent = e.text;
    liveAssistant = null;
    return;
  }
  const div = document.createElement("div");
  div.className = "entry " + cls(e.kind);
  const lab = labelFor(e.kind);
  div.innerHTML = (lab ? `<div class="label">${lab}</div>` : "") + `<div class="body"></div>`;
  div.querySelector(".body").textContent = e.text || "";
  $("feed").appendChild(div);
}

function appendAssistant(text) {
  if (!liveAssistant) {
    const div = document.createElement("div");
    div.className = "entry assistant";
    div.innerHTML = `<div class="label">Codex</div><div class="body"></div>`;
    $("feed").appendChild(div);
    liveAssistant = div;
  }
  liveAssistant.querySelector(".body").textContent += text;
  scrollFeed();
}

function scrollFeed() {
  const f = $("feed");
  f.scrollTop = f.scrollHeight;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
function renderApproval(a) {
  if (document.querySelector(`[data-key="${a.key}"]`)) return;
  const card = document.createElement("div");
  card.className = "approval-card";
  card.dataset.key = a.key;
  const meta = [];
  if (a.cwd) meta.push("📁 " + a.cwd);
  if (a.reason) meta.push("💬 " + a.reason);
  if (a.note) meta.push("⚠ " + a.note);
  card.innerHTML =
    `<div class="ac-title">⚠ ${a.title}</div>` +
    `<div class="ac-cmd">${escapeHtml(a.command || "")}</div>` +
    (meta.length ? `<div class="ac-meta">${escapeHtml(meta.join("\n"))}</div>` : "") +
    `<div class="ac-actions"></div>`;
  const actions = card.querySelector(".ac-actions");
  (a.options || []).forEach((opt) => {
    const b = document.createElement("button");
    b.className = "btn " + (opt.style === "danger" ? "danger" : opt.style === "primary" ? "primary" : "secondary");
    b.textContent = opt.label;
    b.onclick = () => {
      sendWs({ type: "approval", key: a.key, optionId: opt.id });
      removeApproval(a.key);
    };
    actions.appendChild(b);
  });
  $("approvals").prepend(card);
}

function removeApproval(key) {
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) el.remove();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Notifications (local) when an approval arrives
// ---------------------------------------------------------------------------
function notifyApproval(a) {
  try { navigator.vibrate && navigator.vibrate([80, 40, 80]); } catch {}
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body = (a.command || "").slice(0, 120);
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification("Codex 需要审批：" + a.title, { body, tag: a.key, requireInteraction: true }))
    .catch(() => { try { new Notification("Codex 需要审批：" + a.title, { body }); } catch {} });
}

$("enableNotif").onclick = async () => {
  if (typeof Notification === "undefined") { alert("此浏览器不支持通知"); return; }
  const p = await Notification.requestPermission();
  alert(p === "granted" ? "通知已开启" : "通知未开启：" + p);
};

// ---------------------------------------------------------------------------
// Composer: send / steer / interrupt
// ---------------------------------------------------------------------------
const input = $("input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

function sendPrompt() {
  const text = input.value.trim();
  if (!text) return;
  const steer = $("steerMode").checked;
  sendWs(steer ? { type: "steer", text } : { type: "prompt", text });
  input.value = "";
  input.style.height = "auto";
}

$("sendBtn").onclick = sendPrompt;
input.addEventListener("keydown", (e) => {
  // Enter to send on hardware keyboards; Shift+Enter = newline.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendPrompt();
  }
});
$("interruptBtn").onclick = () => sendWs({ type: "interrupt" });

// ---------------------------------------------------------------------------
// Settings sheet
// ---------------------------------------------------------------------------
$("menuBtn").onclick = () => $("sheet").classList.remove("hidden");
$("sheetClose").onclick = () => $("sheet").classList.add("hidden");
$("cfgApply").onclick = () => {
  sendWs({
    type: "setConfig",
    cwd: $("cfgCwd").value.trim() || undefined,
    approvalPolicy: $("cfgApproval").value,
    sandbox: $("cfgSandbox").value,
  });
  $("sheet").classList.add("hidden");
};
$("newThreadBtn").onclick = () => {
  sendWs({ type: "newThread", cwd: $("cfgCwd").value.trim() || undefined });
  $("sheet").classList.add("hidden");
};
function forget() {
  localStorage.removeItem(LS.profile); // keep keys so the device stays paired
  location.reload();
}
$("forget").onclick = forget;

// ---------------------------------------------------------------------------
// Diff bar + sheet (see the code Codex wrote)
// ---------------------------------------------------------------------------
function setDiff(diff) {
  lastDiff = diff || "";
  $("diffBar").classList.toggle("hidden", !lastDiff);
  if (!$("diffSheet").classList.contains("hidden")) {
    $("diffContent").textContent = lastDiff || "(无改动)";
  }
}
$("diffBar").onclick = () => {
  $("diffContent").textContent = lastDiff || "(无改动)";
  $("diffSheet").classList.remove("hidden");
};
$("diffClose").onclick = () => $("diffSheet").classList.add("hidden");

// ---------------------------------------------------------------------------
// Sessions / projects sheet (pick a real project, resume a conversation)
// ---------------------------------------------------------------------------
function loadSessions() {
  $("sessionsList").innerHTML = '<p class="muted small">加载中…</p>';
  sendWs({ type: "listThreads" });
}
$("sessionsBtn").onclick = () => { $("sessionsSheet").classList.remove("hidden"); loadSessions(); };
$("sessionsRefresh").onclick = loadSessions;
$("sessionsClose").onclick = () => $("sessionsSheet").classList.add("hidden");

// Render the EXACT Codex desktop tree: projects (with labels, in order, empty
// ones show 暂无对话) + the flat 对话 group. Data comes from the relay, which
// reads Codex's own .codex-global-state.json.
function sessionItem(t) {
  const item = document.createElement("button");
  item.className = "session-item nested";
  const when = t.updatedAt ? new Date(t.updatedAt * 1000).toLocaleString() : "";
  item.innerHTML =
    `<div class="s-name">${escapeHtml(t.name || "(无标题)")}</div>` +
    `<div class="s-meta">${escapeHtml(when)}</div>`;
  item.onclick = () => {
    sendWs({ type: "resumeThread", threadId: t.id });
    $("sessionsSheet").classList.add("hidden");
  };
  return item;
}

function renderProjectTree(tree) {
  const list = $("sessionsList");
  list.innerHTML = "";
  const projects = tree.projects || [];
  const projectless = tree.projectless || [];
  if (!projects.length && !projectless.length) { list.innerHTML = '<p class="muted small">没有会话</p>'; return; }

  projects.forEach((p) => {
    const header = document.createElement("div");
    header.className = "session-group";
    header.innerHTML =
      `<div class="sg-name">📁 ${escapeHtml(p.label)} <span class="sg-count">${p.threads.length}</span></div>` +
      `<div class="sg-path mono">${escapeHtml(p.root)}</div>`;
    list.appendChild(header);
    if (!p.threads.length) {
      const empty = document.createElement("div");
      empty.className = "muted small"; empty.style.margin = "0 0 8px 14px";
      empty.textContent = "暂无对话";
      list.appendChild(empty);
    }
    p.threads.forEach((t) => list.appendChild(sessionItem(t)));
  });

  if (projectless.length) {
    const header = document.createElement("div");
    header.className = "session-group";
    header.innerHTML = `<div class="sg-name">💬 对话 <span class="sg-count">${projectless.length}</span></div>`;
    list.appendChild(header);
    projectless.forEach((t) => list.appendChild(sessionItem(t)));
  }
}

// ---------------------------------------------------------------------------
// Service worker + boot
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
