# T.R.A.E.V.I.S. Control Center 启动与测试手册

> 适用范围：`src/tarevis-control-center` 前端、Control Center 后端、`src/trae-communicate` 本地 Bridge。
> 真实链路：浏览器 -> Control Center 后端 -> `trae-communicate` -> TRAE CN Agent。
> 本文默认使用端口：Bridge `8766`、后端 `8782`、前端 `5182`。

## 1. 重要说明

- 浏览器只访问 Control Center 后端，不直接访问 Bridge。
- 真实 TRAE 测试必须使用 `CONTROL_CENTER_MODE=hybrid` 和 `CONTROL_CENTER_TRAE_ADAPTER=communicate`。
- `mode=mock` 时，消息不会进入 TRAE 窗口；看到 `Mock TRAE ...` 说明当前不是实链路。
- `succeeded` 表示提示词已送入 TRAE，或已读取到回复，不表示 TRAE 已完成整个开发任务。
- 不要复用旧的 8780/5180 进程。启动前先确认端口对应的是本次启动的进程。

## 2. 前置条件

- Windows 10/11。
- Node.js 20+、npm 10+。
- Python 3.x。
- TRAE CN/TRAE Work 已打开，并进入要操作的项目。
- 当前真实测试使用桌面端 UI Automation；窗口标题通常包含 `Trae CN`。

首次安装 Bridge 依赖，只需执行一次：

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\trae-communicate

py -3 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install pyautogui pywinauto pyperclip pywin32
npm install
```

检查端口。若端口已被占用，先确认 PID 属于本项目，再停止对应终端或进程；不要直接结束未知进程：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8766,8782,5182 -ErrorAction SilentlyContinue
```

## 3. 校准 TRAE 输入框

TRAE 窗口和 Agent 面板布局变化后，必须重新校准。校准不会发送消息，但会短暂操作输入框并撤销测试文本。

在 Bridge 终端执行：

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\trae-communicate
.\.venv\Scripts\Activate.ps1
$env:TRAE_WINDOW_KEYWORD="Trae CN"
npm run calibrate
```

成功标志：

```text
CALIBRATION_SUCCESS
```

如果实际窗口标题不同，将 `TRAE_WINDOW_KEYWORD` 改成标题中的稳定片段。校准失败时不要继续发送消息。

## 4. 启动真实链路

### 4.1 终端 A：启动 `trae-communicate`

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\trae-communicate
.\.venv\Scripts\Activate.ps1
$env:TRAE_WINDOW_KEYWORD="Trae CN"
$env:TRAE_COMMUNICATE_STRATEGY="uiautomation"
npm start
```

保持终端运行。另开 PowerShell 检查 Bridge：

```powershell
Invoke-RestMethod http://127.0.0.1:8766/health | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:8766/ready | ConvertTo-Json -Depth 8
```

`/health` 只代表 Node 服务存活；只有 `/ready` 返回 200 且以下检查为 `true` 才可以继续：

```text
success: true
ready: true
strategyLoaded: true
scriptAvailable: true
pythonAvailable: true
dependenciesAvailable: true
calibrated: true
windowAvailable: true
```

### 4.2 终端 B：启动 hybrid 后端

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\tarevis-control-center\backend

npm run build

$env:CONTROL_CENTER_HOST="127.0.0.1"
$env:CONTROL_CENTER_PORT="8782"
$env:CONTROL_CENTER_MODE="hybrid"
$env:CONTROL_CENTER_TRAE_ADAPTER="communicate"
$env:TRAE_COMMUNICATE_URL="http://127.0.0.1:8766"
$env:TRAE_COMMUNICATE_TIMEOUT_MS="70000"
$env:TRAE_COMMUNICATE_HEALTH_INTERVAL_MS="2000"

npm start
```

另开 PowerShell 验证后端没有误启动成 Mock：

```powershell
$health = Invoke-RestMethod http://127.0.0.1:8782/api/health
$health | ConvertTo-Json -Depth 10

$state = Invoke-RestMethod http://127.0.0.1:8782/api/state
"mode: $($state.snapshot.mode)"
$state.snapshot.services |
  Where-Object serviceId -eq "trae-adapter" |
  Select-Object serviceId,connection,adapterMode,detail
```

预期结果：

```text
mode: hybrid
serviceId: trae-adapter
connection: online
adapterMode: live
```

如果看到 `mode: mock` 或 `Mock TRAE`，说明连接的是旧后端进程。停止占用 8782 的本项目进程后，重新执行本节命令。

### 4.3 终端 C：启动 live 前端

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\tarevis-control-center

$env:VITE_CONTROL_CENTER_ADAPTER="live"
$env:VITE_CONTROL_CENTER_API_BASE="/"
$env:CONTROL_CENTER_PROXY_TARGET="http://127.0.0.1:8782"

npm run dev -- --port 5182
```

打开：<http://127.0.0.1:5182>

进入“系统诊断”，确认环境为 `HYBRID`，TRAE Adapter 为 `LIVE`，连接为“在线”。不要使用旧的 5190 Mock 预览进行真实测试。

## 5. 真实测试步骤

### 5.1 无副作用探针

先从 TraeView 发送以下唯一文本：

```text
[PHASE6-PROBE-20260804-01] 只回复这个完整标识，不修改任何文件。
```

检查四件事：

1. 前端命令记录出现该文本。
2. TRAE 窗口只出现一次该文本。
3. Bridge 终端出现一次发送/完成记录。
4. 前端最终显示“已读取回复”，或显示“已发送但未读取到回复”。

### 5.2 最小文件实现测试

探针成功后，再发送：

```text
[PHASE6-FILE-20260804-01] 在当前项目中新建 output/phase6_probe_20260804_01.txt，文件内容只能是 PHASE6_FILE_OK。不要修改其他文件，不要提交。完成后回复 DONE PHASE6_FILE_OK。
```

在仓库根目录验证 TRAE 是否实际写入文件：

```powershell
Get-Content D:\Datenbank\GithubProjects\Trae_proj\output\phase6_probe_20260804_01.txt
git -C D:\Datenbank\GithubProjects\Trae_proj status --short
```

文件内容为 `PHASE6_FILE_OK`，并且前端收到 `DONE PHASE6_FILE_OK`，才算完成一次真实“发送 -> TRAE 实现 -> 回复 UI”验证。测试文件可在确认结果后由同事按项目约定清理。

### 5.3 查看当前命令状态

```powershell
$state = Invoke-RestMethod http://127.0.0.1:8782/api/state
$state.snapshot.commands |
  Where-Object target -eq "trae" |
  Select-Object -First 10 requestId,commandId,status,input,result,requestedAt,updatedAt |
  Format-List
```

终态含义：

- `succeeded`：已送入 TRAE；如果有可读回复，结果中会显示回复。
- `failed`：Bridge 或 TRAE 明确拒绝/发送失败。
- `expired`：等待超时，发送结果可能未知；不要自动重发，先检查 TRAE 窗口。

## 6. 停止服务

按以下顺序在三个运行终端分别按 `Ctrl+C`：前端、Control Center 后端、`trae-communicate`。

然后检查端口已释放：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8766,8782,5182 -ErrorAction SilentlyContinue
```

无输出表示本次服务已停止。若仍有监听，先用下面命令确认 PID 和启动命令，再处理：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8766,8782,5182 |
  Select-Object LocalPort,OwningProcess
Get-CimInstance Win32_Process |
  Where-Object ProcessId -eq <PID> |
  Select-Object ProcessId,Name,CommandLine
```

## 7. Mock 回归测试

Mock 测试不需要启动真实 TRAE，也不会操作 TRAE 窗口。

Bridge：

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\trae-communicate
npm test
```

Control Center 后端：

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\tarevis-control-center\backend
npm run typecheck
npm run build
npm test
```

Control Center 前端：

```powershell
cd D:\Datenbank\GithubProjects\Trae_proj\src\tarevis-control-center
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:e2e:live
```

`test:e2e:live` 使用 Fake Bridge，不需要真实 TRAE；它不是现场真实链路测试。

## 8. 常见问题

### `/ready` 返回 503

先看返回 JSON 的 `checks` 和 `reason`：

- `calibrated=false`：重新运行 `npm run calibrate`。
- `windowAvailable=false`：确认 TRAE 窗口已打开，并修正 `TRAE_WINDOW_KEYWORD`。
- `dependenciesAvailable=false`：激活 `.venv` 并重新安装 Python 依赖。

### 页面能发送，但 TRAE 窗口没有消息

首先检查后端：

```powershell
Invoke-RestMethod http://127.0.0.1:8782/api/health
```

必须是 `mode=hybrid`。如果命令结果包含 `Mock TRAE`，前端连接的是 Mock 后端；如果 Bridge 队列一直为空，消息没有到达 `trae-communicate`。

### 页面显示后端离线或 TRAE offline

确认前端启动时的 `CONTROL_CENTER_PROXY_TARGET` 指向 `http://127.0.0.1:8782`，并确认 8782 后端仍在运行。Vite 已启动后修改环境变量不会热切换代理，需重启前端。

### 命令 expired

这表示结果未知，不代表一定没有发送。先查看 TRAE 窗口是否仍在处理，不要立即重发同一任务。
