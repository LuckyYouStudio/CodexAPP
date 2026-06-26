// Verify the approval loop: force command approvals, send a prompt that runs a
// command, auto-DENY whatever approval shows up.
import { WebSocket } from "ws";
const TOKEN = process.argv[2];
const PROMPT = process.argv[3] || "请用 shell 运行命令 `echo hello-from-codex`，然后告诉我输出。";
const ws = new WebSocket(`ws://127.0.0.1:4123/ws?token=${TOKEN}`);
let denied = false;

ws.on("open", () => {
  console.log("[client] connected");
  ws.send(JSON.stringify({ type: "setConfig", approvalPolicy: "untrusted", sandbox: "read-only" }));
  setTimeout(() => ws.send(JSON.stringify({ type: "newThread" })), 300);
  setTimeout(() => {
    console.log("[client] sending command prompt");
    ws.send(JSON.stringify({ type: "prompt", text: PROMPT }));
  }, 1200);
});

ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "assistantDelta") { process.stdout.write(m.text); return; }
  if (m.type === "approval") {
    console.log("\n[APPROVAL]", JSON.stringify(m.approval, null, 2));
    setTimeout(() => {
      console.log("[client] -> DENY", m.approval.key);
      ws.send(JSON.stringify({ type: "approval", key: m.approval.key, optionId: "deny" }));
      denied = true;
    }, 800);
    return;
  }
  if (m.type === "approvalResolved") { console.log("[approvalResolved]", m.key, m.by); return; }
  if (m.type === "event") { console.log("[event]", m.event.kind, "—", m.event.text); return; }
  if (m.type === "hello") { console.log("[hello] ok"); return; }
});
ws.on("close", () => console.log("\n[client] closed"));
setTimeout(() => { console.log("\n[client] done; denied=" + denied); ws.close(); process.exit(0); }, 45000);
