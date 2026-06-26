// Probe: confirm the codex app-server stdio framing + initialize handshake.
// Run: node relay/probe.mjs
import { spawn } from "node:child_process";

const CODEX_BIN =
  process.env.CODEX_BIN ||
  "C:\\Users\\liush\\AppData\\Local\\OpenAI\\Codex\\bin\\8e55c2dd143b6354\\codex.exe";

const child = spawn(CODEX_BIN, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let rawSeen = 0;
child.stdout.on("data", (buf) => {
  rawSeen += buf.length;
  // Print with visible newline markers so we can see the framing.
  const s = buf.toString("utf8").replace(/\n/g, "\\n\n");
  process.stdout.write("[OUT] " + s + "\n");
});
child.stderr.on("data", (buf) => {
  process.stdout.write("[ERR] " + buf.toString("utf8") + "\n");
});
child.on("exit", (code, sig) => {
  console.log(`\n[probe] child exited code=${code} sig=${sig} rawBytes=${rawSeen}`);
});

function sendLine(obj) {
  const line = JSON.stringify(obj) + "\n";
  process.stdout.write("[SEND] " + line);
  child.stdin.write(line);
}

// Step 1: initialize
sendLine({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    clientInfo: { name: "codexapp-probe", title: "CodexApp Probe", version: "0.1.0" },
    capabilities: null,
  },
});

// Step 2: initialized notification (after a short delay so we see the response first)
setTimeout(() => {
  sendLine({ jsonrpc: "2.0", method: "initialized" });
}, 800);

// Step 3: ask for thread list to confirm a real method round-trips
setTimeout(() => {
  sendLine({ jsonrpc: "2.0", id: 2, method: "thread/list", params: { pageSize: 1 } });
}, 1500);

// Quit after a few seconds
setTimeout(() => {
  console.log("[probe] done, killing child");
  child.kill();
  process.exit(0);
}, 5000);
