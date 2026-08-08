# TRAE Communicate

> 更新：2026-08-04

把 Control Center 的 HTTP 命令转换成 TRAE CN Agent 提示词的本地 Bridge。Bridge 默认只监听 `127.0.0.1:8766`，浏览器不得直接调用它；浏览器只连接 Control Center 后端。

## 安装

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\trae-communicate
py -3 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install pyautogui pywinauto pyperclip pywin32
npm install
```

打开 TRAE CN 并进入目标项目后运行校准。校准只定位输入框，不发送提示词：

```powershell
npm run calibrate
```

## 启动

```powershell
npm start
```

默认地址为 `http://127.0.0.1:8766`。服务会预加载配置的 Strategy，但不会因为 Strategy 不可用而阻止 Node HTTP 服务启动。

### 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `TRAE_COMMUNICATE_HOST` | `127.0.0.1` | 监听地址 |
| `TRAE_COMMUNICATE_PORT` | `8766` | HTTP 端口 |
| `TRAE_COMMUNICATE_STRATEGY` | 配置文件中的值 | `uiautomation` 或 `playwright` |
| `TRAE_COMMUNICATE_CORS` | `false` | 仅显式开启通配 CORS |
| `TRAE_COMMUNICATE_BODY_MAX_BYTES` | `16384` | 请求体上限 |
| `TRAE_COMMUNICATE_RESPONSE_MAX_BYTES` | `65536` | JSON 响应体上限 |
| `TRAE_COMMUNICATE_QUEUE_MAX_LENGTH` | `16` | 等待中的命令上限 |
| `TRAE_COMMUNICATE_STRATEGY_TIMEOUT_MS` | `60000` | 单条 Strategy 执行上限 |
| `TRAE_COMMUNICATE_READINESS_TIMEOUT_MS` | `8000` | readiness 检查上限 |
| `TRAE_WINDOW_KEYWORD` | `Trae CN` | UI Automation 窗口关键字 |
| `TRAE_UIAUTOMATION_RESPONSE_TIMEOUT_SEC` | `25` | UI Automation 回复等待时间 |
| `TRAE_UIAUTOMATION_EXECUTION_TIMEOUT_MS` | `30000` | UI Automation 子进程上限 |
| `TRAE_PLAYWRIGHT_HEADLESS` | 配置文件中的值 | Playwright 是否无头运行 |
| `TRAE_PLAYWRIGHT_WORK_URL` | `https://work.trae.cn/` | TRAE Work 地址 |
| `TRAE_PLAYWRIGHT_USER_DATA_DIR` | `./.edge-profile-trae` | Playwright 登录态目录 |

`POST /shutdown` 默认关闭。只有显式设置 `TRAE_COMMUNICATE_SHUTDOWN_ENABLED=true` 并配置 `TRAE_COMMUNICATE_SHUTDOWN_TOKEN` 后，才允许使用带 `X-TRAE-Shutdown-Token` 请求头的本机开发关闭接口。

## HTTP 契约

### 存活与 readiness

`GET /health` 只表示 Node 服务存活，并返回当前 Strategy 加载和队列信息。它不会保证 TRAE 窗口可操作。

`GET /ready` 不发送提示词，会检查 Strategy、Python/依赖、校准、TRAE 窗口或 Playwright 登录态和输入框。检查通过返回 200，否则返回 503 及结构化 `checks` 和 `reason`。

### 发送命令

正式请求体只能包含以下字段：

```json
{
  "requestId": "req_browser_001",
  "text": "继续推进当前任务"
}
```

`requestId` 最长 128 字符，必须匹配 `[A-Za-z0-9][A-Za-z0-9._:-]*`；`text` trim 后不能为空且最长 2000 字符。非法 JSON、空 body、未知字段、超限请求和错误 Content-Type 返回 400。

成功且已投递的响应示例：

```json
{
  "success": true,
  "requestId": "req_browser_001",
  "sent": true,
  "strategy": "uiautomation",
  "message": "prompt sent via uiautomation",
  "response": {
    "status": "unavailable",
    "reason": "The prompt was sent, but no readable response was available."
  },
  "sentAt": "2026-08-04T10:00:00.000Z"
}
```

`response.status` 固定为 `read`、`unavailable` 或 `skipped`。`sent=true` 表示提示词已送入 TRAE；即使回复不可读也返回成功，不表示 TRAE 已完成整个开发任务。Bridge 明确发送失败返回 502，Strategy 超时返回 504；这些错误不会自动重试。

同一个 `requestId` 携带相同文本时只执行一次，并返回第一次执行记录。同一个 `requestId` 携带不同文本返回 409。Bridge 对 TRAE 窗口严格串行，等待队列满时返回 429。终态历史只在超过上限时清理，正在执行和排队记录不会被清理。

Bridge 不返回 Python stdout/stderr、本机绝对路径或完整敏感提示词；回复、错误和响应正文均有长度限制。

## 校准与真实发送

校准完成并且 `GET /ready` 返回 200 后，才进行真实发送。UI Automation 使用本地 Python 和 `.trae-calibration.json`；Playwright 首次运行需要以 headed 模式登录 TRAE Work：

```powershell
$env:TRAE_COMMUNICATE_STRATEGY = "playwright"
$env:TRAE_PLAYWRIGHT_HEADLESS = "false"
npm start
```

直接发送的旧工具仍可用于人工现场调试：

```powershell
node test/quick-test.js "天气怎么样呢"
```

该命令会真实操作 TRAE，不属于自动化测试。

## 自动化测试

测试全部注入 `test/mock-strategy.js`，不会启动 Playwright、Python 或操作真实 TRAE：

```powershell
npm test
npm run test:http
```

覆盖输入校验、稳定响应、read/unavailable、Strategy 失败、Strategy 超时、串行队列、队列上限、`requestId` 幂等与冲突、readiness、CORS 和关闭边界。

## 停止与排障

优先在运行服务的终端按 `Ctrl+C`。检查端口：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8766 -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:8766/health
Invoke-RestMethod http://127.0.0.1:8766/ready
```

`health` 成功但 `ready` 失败时，Node 服务仍存活，需根据 `checks`/`reason` 修复依赖、校准、窗口或登录态。Bridge 停止不会让 Control Center 的其他 Mock 模块停止工作。
