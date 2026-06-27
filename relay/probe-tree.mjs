// Verify we can rebuild Codex desktop's EXACT project tree:
// projects + labels + order from .codex-global-state.json, threads assigned by
// cwd-under-root, projectless-thread-ids => the flat 对话 group.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const gs = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, ".codex-global-state.json"), "utf8"));
const order = gs["project-order"] || [];
const labels = gs["electron-workspace-root-labels"] || {};
const projectless = new Set(gs["projectless-thread-ids"] || []);
const lastSeg = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const norm = (p) => (p || "").replace(/[\\/]+$/, "").toLowerCase();
const roots = order.map((r) => ({ root: r, label: labels[r] || lastSeg(r), n: norm(r), threads: [] }));
const flat = [];
function assign(t) {
  if (projectless.has(t.id)) { flat.push(t); return; }
  const c = norm(t.cwd);
  let best = null;
  for (const r of roots) if (c === r.n || c.startsWith(r.n + "\\") || c.startsWith(r.n + "/")) if (!best || r.n.length > best.n.length) best = r;
  (best ? best.threads : flat).push(t);
}

const base = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const BIN = fs.readdirSync(base).map((d) => path.join(base, d, "codex.exe")).filter((p) => fs.existsSync(p)).map((p) => ({ p, m: fs.statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;
const child = spawn(BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 1; const sent = {};
const send = (m, p, n) => { const o = n ? { jsonrpc: "2.0", method: m } : { jsonrpc: "2.0", id, method: m }; if (p !== undefined) o.params = p; if (!n) sent[id] = m, id++; child.stdin.write(JSON.stringify(o) + "\n"); };
child.stderr.on("data", () => {});
child.stdout.on("data", (d) => {
  buf += d.toString(); let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && m.result && sent[m.id] === "thread/list") {
      (m.result.data || []).forEach((t) => assign({ id: t.id, name: t.name || t.preview || "(无标题)", cwd: t.cwd, updatedAt: t.updatedAt }));
      console.log("=== 项目树(应与桌面端一致) ===");
      roots.forEach((r) => { console.log(`📁 ${r.label}  (${r.threads.length})`); r.threads.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).forEach((t) => console.log("    - " + t.name)); if (!r.threads.length) console.log("    暂无对话"); });
      console.log(`\n💬 对话 (${flat.length})`); flat.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,6).forEach((t) => console.log("    - " + t.name));
      child.kill(); process.exit(0);
    }
  }
});
send("initialize", { clientInfo: { name: "codex_vscode", title: "x", version: "0.1.0" }, capabilities: null });
setTimeout(() => send("initialized", undefined, true), 300);
setTimeout(() => send("thread/list", { limit: 100 }), 700);
setTimeout(() => { console.log("timeout"); process.exit(0); }, 15000);
