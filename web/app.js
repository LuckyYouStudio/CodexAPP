// CodexApp PWA client. Talks to the relay over WebSocket; never sees Codex creds.
"use strict";

const $ = (id) => document.getElementById(id);
const LS = {
  url: "codexapp.url",
  token: "codexapp.token",
};

let ws = null;
let backoff = 1000;
let liveAssistant = null;   // the streaming assistant bubble (or null)
let appState = {};
let lastDiff = "";          // latest unified diff for the current turn

// ---------------------------------------------------------------------------
// Boot: setup gate vs app
// ---------------------------------------------------------------------------
function getCreds() {
  return {
    url: localStorage.getItem(LS.url) || location.origin,
    token: localStorage.getItem(LS.token) || "",
  };
}

function start() {
  const { url, token } = getCreds();
  if (!token) {
    $("setupUrl").value = url;
    $("setup").classList.remove("hidden");
    return;
  }
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  connect();
}

$("setupSave").onclick = () => {
  const url = $("setupUrl").value.trim().replace(/\/+$/, "");
  const token = $("setupToken").value.trim();
  if (!url || !token) return;
  localStorage.setItem(LS.url, url);
  localStorage.setItem(LS.token, token);
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  connect();
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function wsUrl() {
  const { url, token } = getCreds();
  return url.replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(token);
}

function connect() {
  setConn(false, "连接中…");
  try {
    ws = new WebSocket(wsUrl());
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    backoff = 1000;
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    handle(m);
  };
  ws.onclose = (ev) => {
    setConn(false, ev.code === 4001 ? "Token 无效" : "已断开");
    if (ev.code === 4001) { forget(); return; }
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function scheduleReconnect() {
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 1.6, 15000);
}

function sendWs(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
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
    case "threads":
      renderSessions(m.threads || []);
      break;
  }
}

function setConn(ok, label) {
  $("connDot").classList.toggle("on", !!ok);
  if (label) $("statusPill").textContent = label;
}

function applyState() {
  const connected = !!(ws && ws.readyState === WebSocket.OPEN) && appState.codexConnected;
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
  localStorage.removeItem(LS.token);
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

function projName(cwd) {
  if (!cwd) return "(未知目录)";
  return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
}

// Group conversations by project folder (cwd), like Codex's project tree.
function renderSessions(threads) {
  const list = $("sessionsList");
  list.innerHTML = "";
  if (!threads.length) { list.innerHTML = '<p class="muted small">没有会话</p>'; return; }

  const groups = new Map();
  threads.forEach((t) => {
    const key = t.cwd || "(未知目录)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const recent = (arr) => Math.max(...arr.map((t) => t.updatedAt || 0));
  const sorted = [...groups.entries()].sort((a, b) => recent(b[1]) - recent(a[1]));

  sorted.forEach(([cwd, ts]) => {
    const header = document.createElement("div");
    header.className = "session-group";
    header.innerHTML =
      `<div class="sg-name">📁 ${escapeHtml(projName(cwd))} <span class="sg-count">${ts.length}</span></div>` +
      `<div class="sg-path mono">${escapeHtml(cwd)}</div>`;
    list.appendChild(header);

    ts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    ts.forEach((t) => {
      const item = document.createElement("button");
      item.className = "session-item nested";
      const when = t.updatedAt ? new Date(t.updatedAt * 1000).toLocaleString() : "";
      item.innerHTML =
        `<div class="s-name">${escapeHtml(t.name || "(无标题)")}</div>` +
        `<div class="s-meta">${escapeHtml(when)}${t.source ? " · " + escapeHtml(t.source) : ""}</div>`;
      item.onclick = () => {
        sendWs({ type: "resumeThread", threadId: t.id });
        $("sessionsSheet").classList.add("hidden");
      };
      list.appendChild(item);
    });
  });
}

// ---------------------------------------------------------------------------
// Service worker + boot
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
