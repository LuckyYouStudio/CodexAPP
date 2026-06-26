// Simulates the phone: connect, print everything, send one tiny prompt.
import { WebSocket } from "ws";

const TOKEN = process.argv[2];
const PROMPT = process.argv[3] || "只用一个词回复我：你好";
const ws = new WebSocket(`ws://127.0.0.1:4123/ws?token=${TOKEN}`);

ws.on("open", () => {
  console.log("[client] connected");
  setTimeout(() => {
    console.log("[client] sending prompt:", PROMPT);
    ws.send(JSON.stringify({ type: "prompt", text: PROMPT }));
  }, 500);
});
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "assistantDelta") { process.stdout.write(m.text); return; }
  if (m.type === "hello") {
    console.log("[hello] state:", JSON.stringify(m.state), "pending:", m.pendingApprovals.length, "events:", m.recentEvents.length);
    return;
  }
  console.log("[" + m.type + "]", JSON.stringify(m.type === "state" ? m.state : (m.event || m.approval || m)));
});
ws.on("close", (c) => console.log("\n[client] closed", c));
ws.on("error", (e) => console.log("[client] error", e.message));

setTimeout(() => { console.log("\n[client] done"); ws.close(); process.exit(0); }, 30000);
