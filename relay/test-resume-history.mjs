// Verify resuming a session loads its history into the feed (web behavior).
import { WebSocket } from "ws";
const TOKEN = process.argv[2];
const PORT = process.env.PORT || 4123;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`);
let resumed = false;

ws.on("open", () => setTimeout(() => ws.send(JSON.stringify({ type: "listThreads" })), 400));
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "threads") {
    const t = m.threads.find((x) => /Say hi/i.test(x.name || "")) || m.threads[0];
    console.log("resuming:", t.name, "@", t.cwd);
    ws.send(JSON.stringify({ type: "resumeThread", threadId: t.id }));
    resumed = true;
    return;
  }
  if (m.type === "hello" && resumed) {
    console.log("\n=== 会话历史(网页 feed 会渲染这些) ===");
    (m.recentEvents || []).forEach((e) => console.log(`[${e.kind}] ${(e.text || "").slice(0, 70)}`));
    ws.close(); process.exit(0);
  }
});
setTimeout(() => { console.log("timeout"); process.exit(0); }, 15000);
