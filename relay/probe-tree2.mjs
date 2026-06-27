// Analyze exactly which threads the desktop tracks + how it groups them.
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const CH = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const gs = JSON.parse(fs.readFileSync(path.join(CH, ".codex-global-state.json"), "utf8"));
const hints = gs["thread-workspace-root-hints"] || {};
const order = gs["project-order"] || [];
const projectless = gs["projectless-thread-ids"] || [];
const pinned = gs["pinned-thread-ids"] || [];

console.log("project-order roots:", order.length);
console.log("thread-workspace-root-hints entries:", Object.keys(hints).length);
console.log("projectless-thread-ids:", projectless.length);
console.log("pinned-thread-ids:", pinned.length);

// distinct hint roots + counts
const byRoot = {};
for (const r of Object.values(hints)) byRoot[r] = (byRoot[r] || 0) + 1;
console.log("\nhint roots distribution:");
Object.entries(byRoot).sort((a,b)=>b[1]-a[1]).forEach(([r,n]) => console.log(`  ${n}\t${r}  ${order.includes(r) ? "  <-- PROJECT" : ""}`));

// how many hint-keys are also projectless
const plSet = new Set(projectless);
const hintKeys = Object.keys(hints);
console.log("\nhint-keys that are projectless:", hintKeys.filter(k=>plSet.has(k)).length, "/", hintKeys.length);
console.log("projectless not in hints:", projectless.filter(k=>!hints[k]).length);

// cross-check with thread/list: which on-disk threads are NOT known to desktop
const base = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const BIN = fs.readdirSync(base).map(d=>path.join(base,d,"codex.exe")).filter(p=>fs.existsSync(p)).map(p=>({p,m:fs.statSync(p).mtimeMs})).sort((a,b)=>b.m-a.m)[0].p;
const child = spawn(BIN,["app-server"],{stdio:["pipe","pipe","pipe"]}); let buf="",id=1; const sent={};
const send=(m,p,n)=>{const o=n?{jsonrpc:"2.0",method:m}:{jsonrpc:"2.0",id,method:m};if(p!==undefined)o.params=p;if(!n)sent[id]=m,id++;child.stdin.write(JSON.stringify(o)+"\n");};
child.stderr.on("data",()=>{});
child.stdout.on("data",(d)=>{buf+=d.toString();let nl;while((nl=buf.indexOf("\n"))>=0){const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);if(!line)continue;let m;try{m=JSON.parse(line);}catch{continue;}
  if(m.id!==undefined&&m.result&&sent[m.id]==="thread/list"){
    const all=m.result.data||[];
    const known = all.filter(t=>hints[t.id]||plSet.has(t.id));
    const unknown = all.filter(t=>!hints[t.id]&&!plSet.has(t.id));
    console.log("\nthread/list total:", all.length, " 桌面端认识:", known.length, " 不认识(应排除):", unknown.length);
    console.log("不认识的样例:", unknown.slice(0,5).map(t=>t.name||t.preview).join(" | "));
    child.kill();process.exit(0);
  }}});
send("initialize",{clientInfo:{name:"codex_vscode",title:"x",version:"0.1.0"},capabilities:null});
setTimeout(()=>send("initialized",undefined,true),300);
setTimeout(()=>send("thread/list",{limit:200}),700);
setTimeout(()=>{console.log("timeout");process.exit(0);},15000);
