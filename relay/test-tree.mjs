// Verify the relay sends the exact Codex project tree on listThreads.
import { WebSocket } from "ws";
const TOKEN = process.argv[2];
const PORT = process.env.PORT || 4123;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`);
ws.on("open", () => setTimeout(() => ws.send(JSON.stringify({ type: "listThreads" })), 400));
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "projectTree") {
    console.log("=== 项目树(应与桌面端一致) ===");
    (m.projects || []).forEach((p) => {
      console.log(`📁 ${p.label}  (${p.threads.length})`);
      p.threads.forEach((t) => console.log("    - " + t.name));
      if (!p.threads.length) console.log("    暂无对话");
    });
    console.log(`💬 对话 (${(m.projectless || []).length})`);
    (m.projectless || []).slice(0, 4).forEach((t) => console.log("    - " + t.name));
    ws.close(); process.exit(0);
  }
});
setTimeout(() => { console.log("timeout"); process.exit(0); }, 12000);
