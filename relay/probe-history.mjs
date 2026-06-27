// Inspect what thread/resume returns for a session's history (turns + items).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const base = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const BIN = fs.readdirSync(base).map((d) => path.join(base, d, "codex.exe")).filter((p) => fs.existsSync(p))
  .map((p) => ({ p, m: fs.statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;

const child = spawn(BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 1; const sent = {};
const send = (method, params, notif) => { const m = notif ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id, method }; if (params !== undefined) m.params = params; if (!notif) sent[id] = method, id++; child.stdin.write(JSON.stringify(m) + "\n"); };
child.stderr.on("data", () => {});
child.stdout.on("data", (d) => {
  buf += d.toString(); let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined || !m.result) continue;
    const meth = sent[m.id];
    if (meth === "thread/list") {
      const t = (m.result.data || []).find((x) => /Say hi/i.test(x.name || x.preview || "")) || m.result.data[0];
      console.log("resuming:", t.name || t.preview, "id=", t.id);
      send("thread/resume", { threadId: t.id });
    }
    if (meth === "thread/resume") {
      const th = m.result.thread || {};
      console.log("turns:", (th.turns || []).length);
      (th.turns || []).forEach((turn, i) => {
        console.log(`  turn[${i}] status=${turn.status} itemsView=${JSON.stringify(turn.itemsView)} items=${(turn.items||[]).length}`);
        (turn.items || []).forEach((it) => {
          let preview = it.type === "agentMessage" ? it.text : it.type === "userMessage" ? JSON.stringify(it.content) : it.type === "commandExecution" ? it.command : "";
          console.log(`     - ${it.type}: ${String(preview).slice(0, 60)}`);
        });
      });
      child.kill(); process.exit(0);
    }
  }
});
send("initialize", { clientInfo: { name: "codex_vscode", title: "x", version: "0.1.0" }, capabilities: null });
setTimeout(() => send("initialized", undefined, true), 300);
setTimeout(() => send("thread/list", { limit: 10 }), 700);
setTimeout(() => { console.log("timeout"); process.exit(0); }, 15000);
