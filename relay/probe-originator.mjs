// Test whether the upstream 403 ("only allows Codex official clients") is caused
// by our non-official `originator`. Spawns app-server, initializes with a given
// clientInfo.name (which becomes the originator), sends "你好", reports result.
// Usage: node relay/probe-originator.mjs <originatorName>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NAME = process.argv[2] || "codex_vscode";
const base = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const BIN = fs.readdirSync(base).map((d) => path.join(base, d, "codex.exe")).filter((p) => fs.existsSync(p))
  .map((p) => ({ p, m: fs.statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;

const child = spawn(BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 1, threadId = null, done = false;
const sent = {};
const send = (method, params, notif) => {
  const m = notif ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id, method };
  if (params !== undefined) m.params = params;
  if (!notif) sent[id] = method, id++;
  child.stdin.write(JSON.stringify(m) + "\n");
};
const finish = (msg) => { if (done) return; done = true; console.log("\n>>> RESULT [" + NAME + "]: " + msg); child.kill(); process.exit(0); };

child.stderr.on("data", () => {});
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "error") {
      const t = m.params?.error?.message || "";
      const det = (m.params?.error?.additionalDetails || "").slice(0, 120);
      if (/Reconnecting/i.test(t)) { if (/403|official clients/i.test(det)) finish("❌ 403 official-clients (originator 被拒)"); }
      else finish("❌ error: " + t);
    }
    if (m.method === "item/agentMessage/delta" && m.params?.delta) process.stdout.write(m.params.delta);
    if (m.method === "turn/completed") finish("✅ SUCCESS — 模型正常回复 (originator 被接受)");
    if (m.id !== undefined && m.result) {
      const meth = sent[m.id];
      if (meth === "thread/start") { threadId = m.result?.thread?.id; send("turn/start", { threadId, input: [{ type: "text", text: "你好", text_elements: [] }], approvalPolicy: "on-request" }); }
    }
  }
});

send("initialize", { clientInfo: { name: NAME, title: NAME, version: "0.1.0" }, capabilities: null });
setTimeout(() => send("initialized", undefined, true), 300);
setTimeout(() => send("thread/start", { cwd: "C:\\test", approvalPolicy: "on-request", sandbox: "workspace-write" }), 700);
setTimeout(() => finish("⏱ timeout (无明确结果)"), 25000);
