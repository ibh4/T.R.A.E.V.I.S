# Control Center Backend

> 日期：2026-08-04

这是中控台的 Node.js/TypeScript 单进程后端。HTTP、WebSocket、六个模块和聚合快照共享同一进程；比赛演示默认使用明确标记的 Mock Adapter。

## 环境与模式

- Node.js 20 或更高版本，npm 10 或更高版本。
- `CONTROL_CENTER_MODE=mock|live|hybrid`，默认 `mock`。
- `CONTROL_CENTER_HOST=127.0.0.1`，默认只监听本机。
- `CONTROL_CENTER_PORT=8780`。
- `CONTROL_CENTER_LOG_LEVEL=debug|info|warn|error`。
- `CONTROL_CENTER_TRAE_ADAPTER=mock|communicate`，未设置时保持现有模式选择规则。
- `TRAE_COMMUNICATE_URL=http://127.0.0.1:8766`，第一版只允许本机 IPv4 loopback HTTP 地址。
- `TRAE_COMMUNICATE_TIMEOUT_MS=35000`，合法范围 1000-120000。
- `TRAE_COMMUNICATE_HEALTH_INTERVAL_MS=5000`，合法范围 1000-60000。
- `QWEN_API_KEY`，仅后端读取；未设置时 Harness 浏览功能可用，agent 对话返回 503 `MODEL_NOT_CONFIGURED`。
- `QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `QWEN_MODEL=qwen-plus`。
- `QWEN_TIMEOUT_MS=120000`，合法范围 5000-300000。
- `HARNESS_MAX_STEPS=6`，合法范围 1-12。
- `HARNESS_PROJECTS_FILE`，可选的项目注册表路径；默认固定在本后端的 `data/projects.local.json`。
- `HARNESS_DEFAULT_PROJECT_PATH`，可选的首次启动项目路径；默认根据本文件位置推导仓库根目录。

### Relay Agent

Relay 默认关闭。启用后，backend 启动 HTTP/WS 监听成功后才连接 Cloudflare；设备 token 只从 backend 环境变量读取，不进入前端 bundle、URL 或普通日志。

- `CONTROL_CENTER_RELAY_ENABLED=false|true`，默认 `false`。
- `CONTROL_CENTER_RELAY_URL=wss://api.example.com/agent/connect`；生产必须使用 `wss:`，本地开发可使用 `ws://127.0.0.1:<port>/agent/connect`。
- `CONTROL_CENTER_DEVICE_ID=my-computer`，只允许 ASCII 字母、数字、`.`、`_`、`:`、`-`，最多 128 字符。
- `CONTROL_CENTER_DEVICE_TOKEN`，启用 Relay 时必填，32-512 个可打印 ASCII 字符；只保存在本地环境变量或 Secret 管理器。
- `CONTROL_CENTER_RELAY_HEARTBEAT_MS=15000`，合法范围 1000-60000。
- `CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS=45000`，至少是心跳间隔的两倍，最大 300000。
- `CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS=500` 和 `CONTROL_CENTER_RELAY_RECONNECT_MAX_MS=8000`，退避上限不能小于起始值。
- `CONTROL_CENTER_RELAY_HANDSHAKE_TIMEOUT_MS=10000`，合法范围 1000-60000。

复制 `backend/.env.example` 后，在同一个 PowerShell 会话中启动：

```powershell
Copy-Item .env.example .env.local
$env:CONTROL_CENTER_RELAY_ENABLED="true"
$env:CONTROL_CENTER_RELAY_URL="ws://127.0.0.1:8787/agent/connect"
$env:CONTROL_CENTER_DEVICE_ID="my-computer"
$env:CONTROL_CENTER_DEVICE_TOKEN="替换为本地保存的设备密钥"
npm run dev
```

Relay 连接是两个独立的出站 WebSocket：云端连接负责 hello、心跳和 RPC，本地 `/ws` 连接负责完整 snapshot。任一侧断开都会指数退避重连，backend 关闭时先停止 Relay 接收新 RPC，再释放本地模块和 WebSocket。断线期间不排队命令；超时返回 `RELAY_TIMEOUT`，执行结果可能未知，重试必须复用原 `requestId`。

`LiveTraeAdapter` 已接入 Composition Root。选择规则如下：`mock` 始终使用 Mock TRAE；`hybrid` 在 `CONTROL_CENTER_TRAE_ADAPTER=communicate` 时仅将 TRAE 切换为 Live，其余 Devices/Events/Robot 仍为 Mock；`live` 只有显式选择 `communicate` 才启用 Live TRAE，否则 TRAE、Devices、Events 和 Robot 均保持明确 unavailable，不回退 Mock。Live 模式会轮询 Bridge `/ready`，未 ready 时拒绝新 TRAE 命令并返回 503 `MODULE_UNAVAILABLE`；连接恢复后无需重启即可提交。模式和 Adapter 在进程启动时显式选择，不支持无审计的运行时热切换。

## 启动与停止

后端单独启动：

```powershell
npm ci
npm run build
$env:CONTROL_CENTER_MODE="mock"
npm start
```

启用真实 TRAE Bridge（hybrid 模式示例）：

```powershell
$env:CONTROL_CENTER_MODE="hybrid"
$env:CONTROL_CENTER_TRAE_ADAPTER="communicate"
$env:TRAE_COMMUNICATE_URL="http://127.0.0.1:8766"
npm start
```

开发模式：

```powershell
npm run dev
```

启用 Qwen Harness：

```powershell
$env:QWEN_API_KEY="你的 DashScope API Key"
$env:QWEN_MODEL="qwen-plus"
npm run dev
```

在上一级前端目录执行 `npm run dev:demo` 可联合启动 UI 和后端。脚本拒绝占用中的 8780/5180 端口，显示实际就绪耗时，并在 Ctrl+C 后终止两个进程树、确认端口释放。也可以在两个终端分别运行 `npm run dev:backend` 和 `npm run dev`，分别按 Ctrl+C 停止。

2026-08-03 在 Windows/Node.js 24.11.1 的干净临时目录实测（`scripts/measure-clean-startup.ps1`）：后端/前端 `npm ci` 分别 2.37s/7.51s，build 分别 1.29s/3.06s，已构建后端到 `/api/health` 就绪 607ms，Vite UI 到首页就绪 1.10s。脚本结束后确认 8799/5199 端口释放；耗时会随磁盘、网络和 npm 缓存变化。

停止后检查：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8780,5180 -ErrorAction SilentlyContinue
```

无输出表示端口已释放。

## 健康与状态

```powershell
Invoke-RestMethod http://127.0.0.1:8780/api/health
Invoke-RestMethod http://127.0.0.1:8780/api/state
```

`/api/health` 返回 `ok`、`mode`、全局 `revision` 和每个模块的 connection/detail。`/api/state` 返回 schema 1.0 完整快照；重点检查 `snapshot.mode`、`snapshot.connection`、`services[].adapterMode`、`services[].connection`。WebSocket `/ws` 每 15 秒 ping，未 pong 的连接及缓冲超过 1 MiB 的慢客户端会被清理。

日志为单行 JSON。设备、事件和命令操作分别携带 `deviceId`、`eventId`、`requestId`/`commandId`，便于现场检索。

## Project Harness

Harness 提供以下 HTTP 接口：

- `GET /api/harness/status`：模型配置状态、模型名、只读标记和项目数。
- `GET|POST /api/harness/projects`：列出或新增项目。
- `PATCH|DELETE /api/harness/projects/:id`：修改或移除项目列表项，不删除磁盘文件。
- `GET /api/harness/projects/:id/tree?path=.`：浏览相对目录。
- `GET /api/harness/projects/:id/file?path=README.md`：读取受大小和行数限制的文本文件。
- `POST /api/harness/chat`：运行 Qwen 工具调用循环。

项目注册表是本机运行时配置，已被 Git 忽略。迁移电脑后首次启动会自动生成当前仓库条目，也可以直接在 Agent 工作台修改任意项目路径。

工具面严格只读：目录、文件和搜索路径在访问前后都校验 realpath 必须位于所选项目根目录；项目外绝对路径、`..` 越界和越界符号链接会被拒绝。`.git`、`node_modules`、`.venv`、构建和测试产物目录默认不参与遍历搜索。单文件读取上限 256 KiB、单次最多 400 行；搜索最多扫描 2000 个文件并返回 60 项。当前没有写文件、执行命令或 Git 工具。

## 演示重置与验收

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8780/api/demo/reset
npm run demo:smoke
```

reset 会取消 TRAE/Robot 旧定时任务，依次恢复模块初始状态，只增加一次 revision 并广播一次完整快照。重复事件和命令保持幂等；跨目标复用 requestId 返回 409；不存在的资源返回 404；所有错误都使用 `{ "error": { "code": "...", "message": "..." } }`。

比赛演示建议顺序：

1. reset，确认总览为初始紧急事件、6 个设备、TRAE 空闲、Robot 待命。
2. 在事件页确认事件，观察另一浏览器和总览同步为“需要关注”。
3. 解决事件，确认告警数和 ALERT PRESSURE 归零。
4. 提交 TRAE 任务，展示 requested 到 succeeded；使用 `[mock:timeout]` 展示 expired。
5. 发送经二次确认的 Robot 动作，再用急停中断队列。
6. 打开系统诊断，核对全局 mode、各 Adapter mode/connection。
7. 再次 reset，证明整套流程可以重复。

## 现场排障

- UI 显示后端离线：检查 `/api/health`、8780 监听和 Vite 的 `CONTROL_CENTER_PROXY_TARGET`；前端会以 0.5 秒起步、最高 8 秒退避重连。
- Relay 设备未上线：确认 `CONTROL_CENTER_RELAY_ENABLED`、`CONTROL_CENTER_RELAY_URL`、`CONTROL_CENTER_DEVICE_ID` 和本地 token；检查日志中的 `relay.cloud_*`、`relay.local_snapshot_*` 阶段，不要输出或复制 token。
- Relay 握手失败：生产 URL 必须是 `wss:`，本地 fake relay 才允许 loopback `ws:`；Cloudflare 返回 `UNAUTHORIZED` 或 `UNSUPPORTED_PROTOCOL` 时 Agent 会退避重连，不会快速无限重试。
- Relay RPC 超时：普通接口最多等待 45 秒，`/api/harness/chat` 最多 120 秒；`RELAY_TIMEOUT` 不代表命令一定未执行，先查询状态再用原 `requestId` 重试。
- UI 显示协议错误：确认前后端都使用 schema 1.0，刷新前不要用 Mock 数据覆盖 Live 状态。
- live/hybrid 未显示真实 TRAE：确认 `CONTROL_CENTER_TRAE_ADAPTER=communicate`、Bridge `/ready` 和 `/api/health`；`hybrid` 只替换 TRAE，其他模块保持 Mock。
- TRAE 命令返回 503：Bridge 当前为 degraded/offline；无需重启后端，等待 `/ready` 恢复后重试。
- revision 不推进：检查模块结构化日志和 WebSocket；reset 正常只推进一次。
- 命令卡住：按 requestId/commandId 查日志；终态不可回退，超时应为 expired。
- 端口占用：用 `Get-NetTCPConnection` 找到 OwningProcess，确认属于本项目后再停止，不要直接结束未知进程。
- 单模块异常：先看 `/api/health` 和 `services[]`；快照投影会将全局连接降级，其他模块继续服务。

## 验证命令

```powershell
npm run typecheck
npm run build
npm test
cd ..
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:e2e:agent
npm run test:e2e:live
```

## Cloudflare production Relay

复制 [`backend/.env.production.example`](.env.production.example) 为未跟踪的 `backend/.env.production.local`，填入真实 `wss://.../agent/connect` 地址和 token。PowerShell 联合脚本会先运行配置检查，再构建并启动 backend；backend 成功监听后会自动启动 Relay Agent：

```powershell
cd ..
npm run relay:check -- -EnvironmentFile backend\.env.production.local
npm run relay:start -- -EnvironmentFile backend\.env.production.local
```

`npm run relay:dev` 使用同一份配置启动 `tsx watch`。脚本不会打印 token，也不会把环境文件复制到 `dist`。断线期间命令不排队；`COMPUTER_OFFLINE` 需要先恢复 Agent，`RELAY_TIMEOUT` 需要先检查状态再使用原 `requestId` 手动重试。完整的 Cloudflare Access、D1、token 轮换、回滚和告警步骤见 [`docs/0806_cloudflareDeploy/20260806_cloudflare-deployment-runbook.md`](../../../docs/0806_cloudflareDeploy/20260806_cloudflare-deployment-runbook.md)。
