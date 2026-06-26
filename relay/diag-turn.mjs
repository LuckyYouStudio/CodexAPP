// Diagnose: send "你好" straight to app-server and print every raw message,
// so we see the real error payload behind "Codex 错误".
import { spawn } from "node:child_process";
const BIN = "C:\\Users\\liush\\AppData\\Local\\OpenAI\\Codex\\bin\\8e55c2dd143b6354\\codex.exe";
const child = spawn(BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 1, threadId = null;
const sent = {};
function send(method, params, isNotif) {
  const m = isNotif ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: id, method };
  if (params !== undefined) m.params = params;
  if (!isNotif) sent[id] = method, id++;
  child.stdin.write(JSON.stringify(m) + "\n");
}
child.stderr.on("data", (d) => process.stdout.write("[ERR] " + d));
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "error") { console.log("\n>>> ERROR NOTIFICATION RAW:\n" + JSON.stringify(m, null, 2) + "\n"); }
    else if (m.method) console.log("[notif]", m.method);
    else if (m.id !== undefined) {
      const meth = sent[m.id];
      if (m.error) console.log(`[resp ${meth}] ERROR:`, JSON.stringify(m.error));
      else {
        console.log(`[resp ${meth}] ok`);
        if (meth === "thread/start") { threadId = m.result?.thread?.id; console.log("  threadId=", threadId);
          send("turn/start", { threadId, input: [{ type: "text", text: "你好", text_elements: [] }], approvalPolicy: "on-request" });
        }
      }
    }
  }
});
send("initialize", { clientInfo: { name: "diag", title: "diag", version: "0.1.0" }, capabilities: null });
setTimeout(() => send("initialized", undefined, true), 300);
setTimeout(() => send("thread/start", { cwd: "C:\\test", approvalPolicy: "on-request", sandbox: "workspace-write" }), 700);
setTimeout(() => { console.log("\n[diag] done"); child.kill(); process.exit(0); }, 18000);
