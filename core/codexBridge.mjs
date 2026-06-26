// Transport-agnostic Codex control core.
//
// Owns the local `codex app-server` (JSON-RPC over stdio) and exposes a clean
// interface used by BOTH transports:
//   - relay/  (LAN: inbound WebSocket from a browser/phone)
//   - cloud/  (outbound WebSocket to a cloud broker, end-to-end encrypted)
//
// You give it an `emit(msg)` callback; it calls that with every outbound
// CodexApp message (state/event/approval/diff/...). You call `dispatch(msg)`
// with inbound client commands (prompt/steer/approval/...). The messages are
// exactly the protocol in PROTOCOL.md — the transport never interprets them.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const EVENT_LOG_CAP = 400;

// Codex installs into a hash-named dir that changes on update; auto-detect.
export function resolveCodexBin(configured) {
  if (configured && fs.existsSync(configured)) return configured;
  const base = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  try {
    const found = fs.readdirSync(base)
      .map((d) => path.join(base, d, "codex.exe"))
      .filter((p) => fs.existsSync(p))
      .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (found.length) return found[0].p;
  } catch {}
  return null;
}

// JSON-RPC over newline-delimited JSON on stdio.
class CodexClient {
  constructor(bin) {
    this.bin = bin;
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
    this.buf = "";
    this.onNotification = () => {};
    this.onServerRequest = () => {};
    this.onExit = () => {};
  }
  start() {
    this.child = spawn(this.bin, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (d) => this._onData(d));
    this.child.stderr.on("data", (d) => process.stderr.write("[codex stderr] " + d.toString("utf8")));
    this.child.on("exit", (code, sig) => this.onExit(code, sig));
    return this.child;
  }
  _onData(chunk) {
    this.buf += chunk.toString("utf8");
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this._dispatch(msg);
    }
  }
  _dispatch(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
      return;
    }
    if (msg.id !== undefined && msg.method) { this.onServerRequest(msg); return; }
    if (msg.method) this.onNotification(msg);
  }
  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method };
    if (params !== undefined) payload.params = params;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }
  notify(method, params) {
    const payload = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }
  respond(id, result) { this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
  respondError(id, code, message) { this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }
}

const APPROVE_OPTS = [
  { id: "approve", label: "批准", style: "primary" },
  { id: "approveSession", label: "本会话都批准", style: "secondary" },
  { id: "deny", label: "拒绝", style: "danger" },
];

function buildApproval(msg) {
  const { method, params, id } = msg;
  const key = crypto.randomUUID();
  let approval;
  switch (method) {
    case "item/commandExecution/requestApproval":
      approval = { key, kind: "command", title: "运行命令", command: params.command || "(unknown)", cwd: params.cwd || null, reason: params.reason || null, network: params.networkApprovalContext || null, options: APPROVE_OPTS };
      break;
    case "item/fileChange/requestApproval":
      approval = { key, kind: "file", title: "修改文件", command: params.grantRoot ? `授予写权限: ${params.grantRoot}` : "(文件改动)", cwd: null, reason: params.reason || null, options: APPROVE_OPTS };
      break;
    case "execCommandApproval":
      approval = { key, kind: "exec-legacy", title: "运行命令", command: Array.isArray(params.command) ? params.command.join(" ") : String(params.command), cwd: params.cwd || null, reason: params.reason || null, options: APPROVE_OPTS };
      break;
    case "applyPatchApproval":
      approval = { key, kind: "patch-legacy", title: "应用补丁", command: "修改: " + Object.keys(params.fileChanges || {}).join(", "), cwd: null, reason: params.reason || null, options: APPROVE_OPTS };
      break;
    case "item/permissions/requestApproval":
      approval = { key, kind: "permission", title: "权限请求", command: "(请求额外权限)", cwd: null, reason: params.reason || null, options: [{ id: "deny", label: "拒绝", style: "danger" }], note: "v1 暂不支持远程授予权限，只能拒绝。" };
      break;
    default:
      return null;
  }
  return { key, serverReqId: id, method, approval };
}

function approvalResult(method, optionId) {
  const v2 = { approve: "accept", approveSession: "acceptForSession", deny: "decline" };
  const legacy = { approve: "approved", approveSession: "approved_for_session", deny: "denied" };
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: v2[optionId] || "decline" };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: legacy[optionId] || "denied" };
    case "item/permissions/requestApproval":
      return null;
    default:
      return { decision: "decline" };
  }
}

export class CodexBridge {
  constructor(config, emit) {
    this.config = config;
    this.emit = emit; // (msg) => void  — outbound CodexApp message
    this.state = {
      codexConnected: false, codexVersion: null, threadId: null, turnId: null,
      cwd: config.defaultCwd, status: "idle", model: config.model || null,
      approvalPolicy: config.approvalPolicy, sandbox: config.sandbox,
      threadName: null, lastDiff: "",
    };
    this.eventLog = [];
    this.pendingApprovals = new Map();
    this.codex = new CodexClient(config.codexBin);
    this.codex.onNotification = (m) => this._onNotification(m);
    this.codex.onServerRequest = (m) => this._onServerRequest(m);
    this.codex.onExit = (code, sig) => {
      console.error(`[codex] exited code=${code} sig=${sig}`);
      this.state.codexConnected = false;
      this._broadcastState();
      setTimeout(() => this._restart(), 1500);
    };
  }

  async start() {
    const bin = resolveCodexBin(this.config.codexBin);
    if (!bin) throw new Error("codex.exe not found");
    this.config.codexBin = bin;
    this.codex.bin = bin;
    this.codex.start();
    await this._bootstrap();
  }

  async _restart() {
    try {
      this.codex.pending.forEach((p) => p.reject(new Error("restarting")));
      this.codex.pending.clear();
      this.codex.buf = "";
      this.codex.start();
      await this._bootstrap();
    } catch (e) { setTimeout(() => this._restart(), 3000); }
  }

  async _bootstrap() {
    const res = await this.codex.request("initialize", {
      clientInfo: { name: "codexapp-agent", title: "CodexApp Agent", version: "0.1.0" },
      capabilities: null,
    });
    this.codex.notify("initialized");
    this.state.codexConnected = true;
    this.state.codexVersion = (res?.userAgent || "").split(" ")[0] || null;
    this._broadcastState();
  }

  // ---- outbound helpers ----
  _pushEvent(entry) {
    const e = { id: crypto.randomUUID(), ts: Date.now(), ...entry };
    this.eventLog.push(e);
    if (this.eventLog.length > EVENT_LOG_CAP) this.eventLog.shift();
    this.emit({ type: "event", event: e });
    return e;
  }
  _broadcastState() { this.emit({ type: "state", state: this.state }); }

  snapshot() {
    return {
      type: "hello",
      state: this.state,
      config: { approvalPolicy: this.state.approvalPolicy, sandbox: this.state.sandbox, cwd: this.state.cwd },
      pendingApprovals: [...this.pendingApprovals.values()].map((v) => v.approval),
      recentEvents: this.eventLog.slice(-120),
      diff: this.state.lastDiff,
    };
  }

  // ---- codex -> client ----
  _onServerRequest(msg) {
    const built = buildApproval(msg);
    if (!built) { this.codex.respondError(msg.id, -32601, "unhandled: " + msg.method); return; }
    this.pendingApprovals.set(built.key, built);
    this._pushEvent({ kind: "approval-requested", text: `${built.approval.title}: ${built.approval.command}` });
    this.emit({ type: "approval", approval: built.approval });
  }

  _onNotification(msg) {
    const { method, params } = msg;
    const st = this.state;
    switch (method) {
      case "thread/started":
        if (params?.thread?.id) st.threadId = params.thread.id;
        this._pushEvent({ kind: "thread", text: "会话已开始" });
        this._broadcastState();
        break;
      case "turn/started":
        st.turnId = params?.turn?.id || st.turnId;
        st.status = "running"; st.lastDiff = "";
        this.emit({ type: "diff", diff: "" });
        this._pushEvent({ kind: "turn", text: "开始执行…" });
        this._broadcastState();
        break;
      case "turn/diff/updated":
        st.lastDiff = params?.diff || "";
        this.emit({ type: "diff", diff: st.lastDiff });
        break;
      case "turn/completed": {
        st.status = "idle";
        const usage = params?.turn?.usage || params?.turn?.tokenUsage;
        const tok = usage ? ` (tokens: ${usage.totalTokens ?? usage.total_tokens ?? "?"})` : "";
        this._pushEvent({ kind: "turn", text: "执行完成" + tok });
        this._broadcastState();
        break;
      }
      case "item/started": this._describeItem(params?.item, "started"); break;
      case "item/completed": this._describeItem(params?.item, "completed"); break;
      case "item/agentMessage/delta":
        if (params?.delta) this.emit({ type: "assistantDelta", text: params.delta });
        break;
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta": {
        const chunk = params?.chunk || params?.delta || params?.output;
        if (typeof chunk === "string") this.emit({ type: "outputDelta", text: chunk });
        break;
      }
      case "serverRequest/resolved": {
        const reqId = params?.requestId ?? params?.id;
        for (const [k, v] of this.pendingApprovals) {
          if (v.serverReqId === reqId) { this.pendingApprovals.delete(k); this.emit({ type: "approvalResolved", key: k, by: "server" }); }
        }
        break;
      }
      case "error": {
        const err = params?.error || {};
        let text = err.message || params?.message || "Codex 错误";
        if (err.additionalDetails) text += "\n" + String(err.additionalDetails).slice(0, 400);
        this._pushEvent({ kind: "error", text });
        break;
      }
      default: break;
    }
  }

  _describeItem(item, phase) {
    if (!item) return;
    let text = null;
    switch (item.type) {
      case "agentMessage": if (phase === "completed" && item.text) text = item.text; break;
      case "reasoning": if (phase === "started") text = "思考中…"; break;
      case "commandExecution":
        text = phase === "started" ? "$ " + item.command : `$ ${item.command}  →  exit ${item.exitCode ?? "?"}`;
        break;
      case "fileChange":
        text = (phase === "started" ? "改动文件: " : "已改动文件: ") + (item.changes || []).map((c) => c.path || "?").join(", ");
        break;
      case "webSearch": if (phase === "started") text = "🔍 " + (item.query || ""); break;
      case "mcpToolCall": if (phase === "started") text = `工具: ${item.server}/${item.tool}`; break;
      default: break;
    }
    if (text) this._pushEvent({ kind: "item:" + item.type, text });
  }

  // ---- client -> codex (actions) ----
  async _ensureThread(cwd) {
    if (this.state.threadId) return this.state.threadId;
    const params = { cwd: cwd || this.state.cwd, approvalPolicy: this.state.approvalPolicy, sandbox: this.state.sandbox };
    if (this.state.model) params.model = this.state.model;
    const res = await this.codex.request("thread/start", params);
    this.state.threadId = res?.thread?.id || res?.threadId || this.state.threadId;
    this.state.cwd = params.cwd;
    this._broadcastState();
    return this.state.threadId;
  }

  async dispatch(m) {
    switch (m.type) {
      case "prompt": return this._prompt(String(m.text || "").trim(), m.cwd);
      case "steer": return this._steer(String(m.text || "").trim());
      case "interrupt": return this._interrupt();
      case "approval": return this._resolveApproval(m.key, m.optionId);
      case "newThread": return this._newThread(m.cwd);
      case "listThreads": return this._listThreads();
      case "resumeThread": return this._resumeThread(m.threadId);
      case "setConfig":
        if (m.approvalPolicy) this.state.approvalPolicy = m.approvalPolicy;
        if (m.sandbox) this.state.sandbox = m.sandbox;
        if (m.cwd) this.state.cwd = m.cwd;
        this._broadcastState();
        return;
      case "getState": return this.emit(this.snapshot());
      default: return;
    }
  }

  async _prompt(text, cwd) {
    if (!text) return;
    await this._ensureThread(cwd);
    const params = { threadId: this.state.threadId, input: [{ type: "text", text, text_elements: [] }], approvalPolicy: this.state.approvalPolicy };
    if (cwd) params.cwd = cwd;
    if (this.state.model) params.model = this.state.model;
    this._pushEvent({ kind: "user", text });
    const res = await this.codex.request("turn/start", params);
    this.state.turnId = res?.turn?.id || res?.id || this.state.turnId;
    this.state.status = "running";
    this._broadcastState();
  }
  async _steer(text) {
    if (!this.state.threadId || !this.state.turnId) throw new Error("没有进行中的任务可纠偏");
    this._pushEvent({ kind: "user", text: "↪ " + text });
    await this.codex.request("turn/steer", { threadId: this.state.threadId, expectedTurnId: this.state.turnId, input: [{ type: "text", text, text_elements: [] }] });
  }
  async _interrupt() {
    if (!this.state.threadId) throw new Error("没有会话");
    await this.codex.request("turn/interrupt", { threadId: this.state.threadId });
    this._pushEvent({ kind: "turn", text: "已请求中断" });
  }
  async _resolveApproval(key, optionId) {
    const item = this.pendingApprovals.get(key);
    if (!item) throw new Error("审批已失效");
    this.pendingApprovals.delete(key);
    const result = approvalResult(item.method, optionId);
    if (result === null) this.codex.respondError(item.serverReqId, -32000, "denied");
    else this.codex.respond(item.serverReqId, result);
    this._pushEvent({ kind: "approval-resolved", text: `${item.approval.title}: ${optionId === "deny" ? "已拒绝" : "已批准"}` });
    this.emit({ type: "approvalResolved", key, by: "user" });
  }
  async _newThread(cwd) {
    this.state.threadId = null; this.state.turnId = null; this.state.status = "idle";
    this.state.threadName = null; this.state.lastDiff = "";
    if (cwd) this.state.cwd = cwd;
    await this._ensureThread(cwd);
    this._pushEvent({ kind: "thread", text: "新建会话 @ " + this.state.cwd });
  }
  async _listThreads() {
    const res = await this.codex.request("thread/list", { limit: 40 });
    const data = (res?.data || []).map((t) => ({ id: t.id, name: t.name || t.preview || "(无标题)", cwd: t.cwd || null, updatedAt: t.updatedAt || t.recencyAt || t.createdAt || 0, source: t.source || null }));
    data.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.emit({ type: "threads", threads: data });
  }
  async _resumeThread(threadId) {
    const res = await this.codex.request("thread/resume", { threadId, approvalPolicy: this.state.approvalPolicy, sandbox: this.state.sandbox });
    const t = res?.thread || {};
    this.state.threadId = t.id || threadId;
    this.state.cwd = t.cwd || this.state.cwd;
    this.state.turnId = null; this.state.status = "idle"; this.state.lastDiff = "";
    this.state.threadName = t.name || t.preview || null;
    this.emit({ type: "diff", diff: "" });
    this._pushEvent({ kind: "thread", text: `已接续会话「${this.state.threadName || this.state.threadId}」@ ${this.state.cwd}` });
    this._broadcastState();
  }
}
