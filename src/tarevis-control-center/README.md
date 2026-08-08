# T.R.A.E.V.I.S. Control Center

> 日期：2026-08-04
> 状态：控制中心 Harness、Qwen agent、Cloudflare Relay 前端接入和 Access 认证边界已完成；真实域名、Access policy 和生产部署待 Phase 7 落地

这是 T.R.A.E.V.I.S. 的公网产品入口和登录后中控台前端。它与
`src/home-perception-node/ui` 的树莓派 480x320 本地界面相互独立，也不直接依赖
TRAEVIS 主程序。

## 当前页面

- `/`：公开产品介绍首页。
- `/login`：mock 登录流程。
- `/console/overview`：家庭、TRAE、设备和机器人统一总览。
- `/console/events`：分级事件、结构化数据和确认处理。
- `/console/devices`：设备状态和稳定设备 ID。
- `/console/trae`：TRAE 任务、建议和命令生命周期。
- `/console/agent`：Qwen 项目 agent、可编辑项目列表、目录和文件浏览。
- `/console/robot`：机器人状态、二次确认和动作回执。
- `/console/system`：服务、资源、连接边界和诊断。

页面刷新后，`public/_redirects` 为 Cloudflare Pages 等静态托管提供 SPA fallback。
它不代表项目已经完成 Cloudflare 配置。

## 数据边界

前端只依赖 `src/control/adapter.ts` 中的 `ControlCenterAdapter`。默认浏览器 Mock 可用于纯前端预览；设置 `VITE_CONTROL_CENTER_ADAPTER=live` 后，页面通过 `/api/state`、`/ws` 和结构化写接口连接 `backend/` 的统一状态服务。

后端 Mock 模式提供：

- Devices、Events、TRAE、Robot、Diagnostics 与 Commands 模块；
- 带全局 revision 的完整快照和 WebSocket 实时同步；
- 幂等事件/命令、命令终态保护、超时与机器人急停；
- 心跳、断线退避重连、原子演示 reset 和结构化日志。

Harness 独立于 TRAE Bridge。它从后端调用 Qwen OpenAI-compatible API，并在一个有步数上限的工具循环中提供 `list_directory`、`read_file`、`search_files` 三个只读工具。项目路径由用户在 Agent 工作台新增、编辑或移除，保存到被 Git 忽略的 `backend/data/projects.local.json`。首次启动会根据仓库位置生成当前比赛项目，不写死开发电脑路径。

API key 只由后端读取，永远不会进入 Vite bundle、浏览器存储、项目注册表或工具日志。所有文件访问都经过项目根目录和 realpath 边界检查，模型不能访问所选项目以外的路径。

mock 登录只把演示会话写入 `sessionStorage`，仅在开发模式启用。生产构建强制使用
Cloudflare Access 会话边界，Live Adapter 通过带 `deviceId` 的 `/api/*` 和 `/ws`
连接 Relay Worker，并携带跨子域 Access cookie；设备 token 不进入浏览器。

## 视觉来源

界面读取并组合了用户提供的三个 Variant HTML/CSS 模板源码：

- 1 号：主信息架构、状态总览、事件与设备密度。
- 2 号：窄图标侧栏和桌面工作台布局。
- 3 号：bracket 面板、页眉/页脚系统小字、多色资源柱和事件流。

所有页面品牌标识直接引用仓库 `assets/trae-color.svg`，没有重新绘制 LOGO。
产品首页使用仓库已有圆屏概念板，避免继续展示旧 TRAEPal 字标。

## 本地运行

```powershell
npm install
npm install --prefix backend
npm run dev:demo
```

默认 UI 地址为 `http://127.0.0.1:5180`，后端健康检查为 `http://127.0.0.1:8780/api/health`。联合脚本使用 LiveControlCenterAdapter 连接 Mock 后端，Ctrl+C 会停止两端并检查端口释放。详细模式、比赛演示顺序和排障步骤见 [backend/README.md](backend/README.md)。

Cloudflare Pages 生产构建使用以下公开配置；真实域名在部署时替换：

```dotenv
VITE_CONTROL_CENTER_ADAPTER=live
VITE_CONTROL_CENTER_API_BASE=https://api.example.com/
VITE_CONTROL_CENTER_DEVICE_ID=my-computer
VITE_CONTROL_CENTER_AUTH_MODE=access
```

### Cloudflare 生产部署

完整的账号清单、D1 初始化、Access/CORS、token 生命周期、回滚和排障手册见 [`docs/0806_cloudflareDeploy/20260806_cloudflare-deployment-runbook.md`](../../docs/0806_cloudflareDeploy/20260806_cloudflare-deployment-runbook.md)。

在当前目录执行：

```powershell
npm run build:production -- -ApiBase https://api.<your-domain> -DeviceId my-computer
npm run deploy:frontend -- -ProjectName <pages-project> -ApiBase https://api.<your-domain> -DeviceId my-computer -ConfirmDeployment
npm run relay:check -- -EnvironmentFile backend\.env.production.local
npm run relay:start -- -EnvironmentFile backend\.env.production.local
```

`build:production` 强制使用 Live Adapter 和 Access 认证；`deploy:frontend` 默认只做构建和部署前检查，只有传入 `-ConfirmDeployment` 才会上传。设备 token 只放在未跟踪的 `backend/.env.production.local`，不会成为 Vite 变量。

启用 Qwen agent 时，在运行 `npm run dev:demo` 的同一个 PowerShell 会话中先设置：

```powershell
$env:QWEN_API_KEY="你的 DashScope API Key"
$env:QWEN_MODEL="qwen-plus"
$env:QWEN_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
npm run dev:demo
```

`QWEN_MODEL` 和 `QWEN_BASE_URL` 可省略并使用上面的默认值。未设置 key 时，项目浏览仍然可用，对话输入会明确显示未配置状态。

## 验证

```powershell
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:e2e:agent
npm run test:e2e:live
```

Playwright 覆盖产品首页、mock 登录、事件确认、TRAE 命令生命周期、机器人二次确认、项目增删、目录和文件浏览、双浏览器同步、后端断线恢复、revision 竞态、重复 reset，以及 1440x900、390x844 和 480x320 三种视口的横向溢出检查。

## 尚未实现

- 真实账户注册、登录、会话续期、退出失效和多用户权限。
- Cloudflare Pages/Workers/Access 的真实域名、账号资源和 Allow policy 部署。
- 历史数据库和设备认证。
- 多家庭租户隔离、通知订阅和移动端 Push。
- 真实账户权限下的机器人动作授权与硬件级安全审计。
- 真实家庭感知事件、TRAE Bridge 和机器人硬件回执接入。
- Harness 写文件、执行命令、Git 操作及其人工确认策略；当前 agent 严格只读。
