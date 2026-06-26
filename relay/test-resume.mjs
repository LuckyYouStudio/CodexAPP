// Verify resume: pick a desktop session and continue it (cwd should switch).
import { WebSocket } from "ws";
const TOKEN = process.argv[2];
const ws = new WebSocket(`ws://127.0.0.1:4123/ws?token=${TOKEN}`);

ws.on("open", () => setTimeout(() => ws.send(JSON.stringify({ type: "listThreads" })), 400));
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "threads") {
    const desktop = m.threads.find((t) => /Documents[\\/]+Codex/i.test(t.cwd || "")) || m.threads[0];
    console.log("[resume] 选中会话:", desktop.name, "@", desktop.cwd);
    ws.send(JSON.stringify({ type: "resumeThread", threadId: desktop.id }));
    return;
  }
  if (m.type === "state" && m.state.threadName) {
    console.log("[state] 已切到 →  cwd:", m.state.cwd, " name:", m.state.threadName, " threadId:", m.state.threadId);
    setTimeout(() => { ws.close(); process.exit(0); }, 500);
    return;
  }
  if (m.type === "event" && m.event.kind === "thread") console.log("[event]", m.event.text);
  if (m.type === "error") console.log("[ERROR]", m.message);
});
setTimeout(() => { console.log("[resume] timeout"); ws.close(); process.exit(0); }, 15000);
