# CodexApp 客户端 ↔ 中继 协议

所有客户端（web / iOS / Android）都通过 **WebSocket** 连接同一个中继，说同一套 JSON 协议。
这是三端实现的唯一事实来源。中继实现见 [relay/server.mjs](relay/server.mjs)。

## 连接

```
ws(s)://<relay-host>:<port>/ws?token=<TOKEN>
```

- 页面/客户端用 `http` 源 → `ws://`；`https` 源 → `wss://`。
- Token 错误：服务端发 `{"type":"error","message":"无效 token"}` 后用关闭码 **4001** 断开。
- 连接成功后，服务端立即推一条 `hello` 快照。
- 建议客户端做指数退避自动重连（web 端 1s→×1.6→最大 15s）。

## 服务端 → 客户端

| type | 字段 | 说明 |
|---|---|---|
| `hello` | `state`, `config`, `pendingApprovals[]`, `recentEvents[]` | 连接快照 |
| `state` | `state` | 状态变化 |
| `event` | `event` | 新增一条 feed 条目 |
| `assistantDelta` | `text` | 助手回复的流式增量（拼接显示） |
| `outputDelta` | `text` | 命令输出增量（可选展示） |
| `approval` | `approval` | 新的审批请求 |
| `approvalResolved` | `key`, `by`(`"user"`/`"server"`) | 审批已处理，移除对应卡片 |
| `error` | `message` | 错误提示 |
| `diff` | `diff` | 本次 turn 的统一 diff（Codex 编辑代码时更新，空串表示清空） |
| `threads` | `threads[]` | 会话列表（响应 `listThreads`） |

### `state` 对象
```jsonc
{
  "codexConnected": true,        // 中继是否连上 codex
  "codexVersion": "…",
  "threadId": "…|null",
  "turnId": "…|null",
  "cwd": "C:\\test",
  "status": "idle" | "running",
  "model": "…|null",
  "approvalPolicy": "on-request" | "untrusted" | "on-failure" | "never",
  "sandbox": "workspace-write" | "read-only" | "danger-full-access"
}
```

### `event` 对象
```jsonc
{ "id": "uuid", "ts": 1700000000000, "kind": "…", "text": "…" }
```
`kind` 取值：`user`、`item:agentMessage`、`item:commandExecution`、`item:fileChange`、
`item:reasoning`、`item:webSearch`、`item:mcpToolCall`、`thread`、`turn`、`error`、
`approval-requested`、`approval-resolved`。客户端按前缀决定样式即可。

### `approval` 对象
```jsonc
{
  "key": "uuid",                 // 回传决策时用
  "kind": "command" | "file" | "exec-legacy" | "patch-legacy" | "permission",
  "title": "运行命令",
  "command": "…",                // 命令或改动摘要
  "cwd": "…|null",
  "reason": "…|null",
  "network": null,               // 受管网络审批上下文（可能为 null）
  "note": "…",                   // 可选提示（如 permission 限制）
  "options": [
    { "id": "approve",        "label": "批准",        "style": "primary"   },
    { "id": "approveSession", "label": "本会话都批准", "style": "secondary" },
    { "id": "deny",           "label": "拒绝",        "style": "danger"    }
  ]
}
```
> 客户端只需把 `options` 渲染成按钮，点击后回传 `optionId`。具体到 Codex 的决策值由中继映射，
> 客户端不关心。`permission` 类只会给 `deny` 选项。

## 客户端 → 服务端

| type | 字段 | 说明 |
|---|---|---|
| `prompt` | `text`, `cwd?` | 发提示词，开始一个新 turn（无会话则自动新建） |
| `steer` | `text` | 纠偏：往当前进行中的 turn 插话 |
| `interrupt` | — | 中断当前 turn |
| `approval` | `key`, `optionId` | 回传审批决策（`optionId` ∈ approve/approveSession/deny） |
| `newThread` | `cwd?` | 新建会话 |
| `setConfig` | `approvalPolicy?`, `sandbox?`, `cwd?` | 改默认策略（下个会话生效） |
| `getState` | — | 请求重新下发快照 |
| `listThreads` | — | 请求会话/项目列表，服务端回 `threads` |
| `resumeThread` | `threadId` | 接续已有会话（切到它的项目 cwd，继续这段对话） |

`threads[]` 每条：`{ id, name, cwd, updatedAt(秒), source }`。`state` 增加 `threadName`(当前会话名) 与 `lastDiff`。

## 典型时序

```
client → {type:"prompt", text:"修复失败的测试"}
server → {type:"event", event:{kind:"user", text:"修复失败的测试"}}
server → {type:"state", state:{status:"running", turnId:"…"}}
server → {type:"assistantDelta", text:"我先"} …（多条）
server → {type:"approval", approval:{key:"K", kind:"command", command:"npm test", …}}
client → {type:"approval", key:"K", optionId:"approve"}
server → {type:"approvalResolved", key:"K", by:"user"}
server → {type:"event", event:{kind:"item:commandExecution", text:"$ npm test → exit 0"}}
server → {type:"state", state:{status:"idle"}}
```
