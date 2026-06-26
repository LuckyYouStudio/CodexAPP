// Verify the new features: list sessions, then write code and capture the diff.
import { WebSocket } from "ws";
const TOKEN = process.argv[2];
const ws = new WebSocket(`ws://127.0.0.1:4123/ws?token=${TOKEN}`);
let promptSent = false;

ws.on("open", () => {
  console.log("[client] connected");
  setTimeout(() => { console.log("[client] -> listThreads"); ws.send(JSON.stringify({ type: "listThreads" })); }, 400);
});

ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "assistantDelta") { process.stdout.write(m.text); return; }
  if (m.type === "threads") {
    console.log(`\n[threads] got ${m.threads.length} 条会话，前 5 条：`);
    m.threads.slice(0, 5).forEach((t) => console.log(`  - ${t.name}  @ ${t.cwd}`));
    // Now write some code in the current project to produce a diff.
    setTimeout(() => {
      console.log("\n[client] -> prompt (写文件以产生 diff)");
      ws.send(JSON.stringify({ type: "prompt", text: "在当前目录新建一个文件 codexapp_difftest.py，内容是 print('hi from codexapp')。请用你的文件编辑工具创建（不要用 shell）。" }));
      promptSent = true;
    }, 600);
    return;
  }
  if (m.type === "diff") {
    if (m.diff) console.log("\n>>> DIFF 收到:\n" + m.diff + "\n");
    return;
  }
  if (m.type === "approval") {
    console.log("\n[approval] " + m.approval.command + "  -> 自动批准");
    ws.send(JSON.stringify({ type: "approval", key: m.approval.key, optionId: "approve" }));
    return;
  }
  if (m.type === "event") { console.log("[event]", m.event.kind, "—", (m.event.text || "").slice(0, 80)); return; }
  if (m.type === "error") { console.log("[error]", m.message.slice(0, 120)); return; }
});

setTimeout(() => { console.log("\n[client] done"); ws.close(); process.exit(0); }, 70000);
