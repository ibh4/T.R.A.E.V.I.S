# T.R.A.E.V.I.S. Control Center 后端开发计划（UI 模块驱动版）

> 文档日期：2026-08-02
> 文档状态：按现有 UI 模块逐步实施
> 目标版本：比赛演示版，不是生产级 SaaS

## 1. 开发思路

后端采用“模块化单体 + 垂直切片”的方式开发：

1. 先根据现有 UI 页面确认后端模块边界。
2. 每次只实现一个模块的 Mock 数据、业务逻辑和接口。
3. 把该模块注册到统一后端主体和状态快照中。
4. 立即连接对应 UI 页面并完成测试。
5. 所有 UI 模块打通后，再补错误处理、重连、日志、重置和部署能力。
6. 最后逐个用真实 Adapter 替换 Mock 数据源。

这不是“一个 UI 页面启动一个后端服务”。所有模块仍运行在同一个 Node.js/TypeScript 进程中，共用一个 HTTP 服务、一个 WebSocket 服务和一个聚合快照。

## 2. 关键原则

### 2.1 UI 决定开发顺序，业务领域决定代码边界

不能机械地为每个页面创建一份独立状态：

- `EventsView` 对应 Events 模块。
- `DevicesView` 对应 Devices 模块。
- `TraeView` 对应 TRAE 模块和共享 Commands 模块。
- `RobotView` 对应 Robot 模块和共享 Commands 模块。
- `SystemView` 对应 Diagnostics 模块。
- `OverviewView` 只聚合其他模块，不拥有独立业务状态。

### 2.2 每个模块独立完成一个端到端闭环

每个模块都按以下顺序推进：

```text
读取 UI 字段和操作
        ↓
冻结该模块的小契约和 JSON 夹具
        ↓
实现模块状态与 Mock Adapter
        ↓
注册到后端主体和 ControlCenterSnapshot
        ↓
连接对应 UI 页面
        ↓
单元测试 + API 测试 + UI E2E
```

当前模块未通过验收时，不提前开发后续模块。

### 2.3 Mock 和 Live 使用相同模块接口

模块业务逻辑不直接依赖真实设备协议。第一轮使用 Mock Adapter；真实接入阶段只替换 Adapter：

```text
MockDeviceSource  -> HomeNodeSource
MockTraeAdapter   -> LiveTraeAdapter
MockRobotAdapter  -> LiveRobotAdapter
```

UI、模块状态和聚合快照不因数据源替换而重写。

### 2.4 公共契约只冻结最小部分

开始时只冻结后端主体必须使用的公共 envelope、连接状态、运行模式和完整快照外形。事件、设备、TRAE、机器人等详细字段，在开发对应模块前冻结。

这样既避免所有模块完成后才发现无法对接，也避免在还没有实现经验时一次性设计过多字段。

## 3. 现有 UI 与后端模块映射

| UI 区域 | 当前功能 | 后端所有者 | 开发阶段 |
| --- | --- | --- | --- |
| Landing/Login | 产品入口、浏览器 Mock 登录 | 首版继续由前端负责 | 暂不接真实认证 |
| Console 外壳 | 连接、模式、告警数量、命令栏 | Core + SnapshotProjector | Phase 0/6 |
| DevicesView | 设备列表、连接、指标、详情 | DevicesModule | Phase 1 |
| EventsView | 事件列表、筛选、确认、详情 | EventsModule | Phase 2 |
| TraeView | TRAE 状态、任务、建议、命令历史 | TraeModule + CommandsModule | Phase 3 |
| RobotView | 机器人状态、动作、确认、急停、回执 | RobotModule + CommandsModule | Phase 4 |
| SystemView | 服务矩阵、资源指标、连接边界 | DiagnosticsModule | Phase 5 |
| OverviewView | 家庭、事件、设备、TRAE、机器人摘要 | SnapshotProjector | Phase 5 |

登录页当前只使用 `sessionStorage`。比赛首版不把它描述为服务端安全认证，真实账户和 RBAC 继续推迟。

## 4. 总体架构

```text
Control Center UI :5180
       │ relative /api + /ws
       ▼
Control Center Backend :8780
  │
  ├─ Core
  │   ├─ CompositionRoot：创建和连接所有模块
  │   ├─ SnapshotProjector：聚合 UI 完整快照
  │   ├─ RealtimeHub：revision、订阅和 WS 广播
  │   └─ HTTP API：路由、校验和统一错误
  │
  ├─ Modules
  │   ├─ DevicesModule
  │   ├─ EventsModule
  │   ├─ CommandsModule
  │   ├─ TraeModule
  │   ├─ RobotModule
  │   └─ DiagnosticsModule
  │
  └─ Adapters
      ├─ mock/*
      └─ live/*
```

模块拥有各自的内存状态。模块状态发生变化时通知 `RealtimeHub`；`RealtimeHub` 增加全局 `revision`，调用 `SnapshotProjector` 生成完整 `ControlCenterSnapshot`，再广播给浏览器。

`SnapshotProjector` 是唯一负责把模块状态组合为 UI 数据的地方。UI 不需要分别轮询六个模块，也不需要知道后端内部目录结构。

## 5. 推荐目录

```text
backend/
  package.json
  tsconfig.json
  data/
    demo-state.json
  src/
    server.ts
    config.ts

    core/
      composition-root.ts
      contracts.ts
      http-api.ts
      realtime-hub.ts
      snapshot-projector.ts

    modules/
      devices/
        devices-service.ts
        devices-routes.ts
        devices-types.ts
      events/
        events-service.ts
        events-routes.ts
        events-types.ts
      commands/
        commands-service.ts
        commands-types.ts
      trae/
        trae-service.ts
        trae-routes.ts
        trae-types.ts
      robot/
        robot-service.ts
        robot-routes.ts
        robot-types.ts
      diagnostics/
        diagnostics-service.ts
        diagnostics-types.ts

    adapters/
      mock/
      live/

  tests/
    fixtures/
    modules/
    integration/
```

模块较小时可以先保持少量文件，不需要为了目录结构创建空抽象。只有 Commands 被 TRAE 和 Robot 共同使用，因此必须独立，避免两套命令生命周期。

## 6. 后端主体的最小职责

### 6.1 CompositionRoot

负责：

- 读取配置并创建模块。
- 根据配置选择 Mock 或 Live Adapter。
- 注册模块路由。
- 把模块变更连接到 RealtimeHub。
- 把模块快照连接到 SnapshotProjector。
- 在关闭时停止 Adapter、定时器、HTTP 和 WebSocket。

CompositionRoot 不包含设备、事件、TRAE 或机器人业务规则。

### 6.2 SnapshotProjector

现有前端 `ControlCenterAdapter` 使用一份完整快照，因此聚合输出继续保持：

```text
mode, connection, lastSyncedAt,
home, trae, robot,
devices[], events[], commands[], services[], resources[]
```

规则：

- 未实现模块使用明确的 `unavailable/offline` 状态或空数组，不使用伪造在线数据。
- 所有数组字段必须存在，允许为空。
- `OverviewView` 的数据全部从模块切片派生，不建立 Overview Store。
- `mode` 支持 `mock | live | hybrid`。
- 每个服务、事件和命令保留自己的 `adapterMode: mock | live`。

Phase 0 需要同步扩展前端状态枚举：

```text
HomeStatus.state: normal | attention | emergency | unavailable
TraeStatus.state: idle | analyzing | working | blocked | offline
RobotStatus.state: standby | executing | blocked | offline
```

`unavailable/offline` 只表示模块尚未接入或失去连接，不能参与正常、告警和在线数量统计。

### 6.3 RealtimeHub

- 维护进程内单调递增的 `revision`。
- 浏览器连接 `/ws` 后立即发送完整快照。
- 任一模块变化后重新投影并广播完整快照。
- 首版不实现局部 patch 和消息回放。
- 断线重连后重新发送当前完整快照。

```json
{
  "type": "snapshot",
  "schemaVersion": "1.0",
  "revision": 12,
  "snapshot": {}
}
```

### 6.4 公共 HTTP 接口

```text
GET /api/health
GET /api/state
WS  /ws
```

`GET /api/state` 返回：

```json
{
  "schemaVersion": "1.0",
  "revision": 12,
  "snapshot": {}
}
```

错误统一为：

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

### 6.5 前端连接

前端新增 `LiveControlCenterAdapter`，但保留现有统一 Adapter 边界：

- 初始返回完整的 `live/offline` 空快照。
- 通过 `/api/state` 获取初始状态。
- 通过 `/ws` 接收后续完整快照。
- 只接受不小于当前 `revision` 的状态。
- Live 失败时显示错误，不自动切换浏览器 Mock。

开发环境使用：

```text
VITE_CONTROL_CENTER_ADAPTER=live|mock
VITE_CONTROL_CENTER_API_BASE=/

/api -> http://127.0.0.1:8780
/ws  -> ws://127.0.0.1:8780
```

## 7. 每个模块的完成标准

一个模块只有同时满足以下条件才算完成：

1. 模块字段、输入、输出和状态转换已记录在契约和 JSON 夹具中。
2. 模块 Service 可以独立使用 Mock 数据运行。
3. 模块路由已注册到统一后端。
4. 模块切片已进入 `ControlCenterSnapshot`。
5. 对应 UI 页面已经切换到后端状态和写操作。
6. 模块错误能在 UI 中被看见，不产生未处理 Promise rejection。
7. 单元测试、API 测试、聚合集成测试和页面 E2E 通过。
8. 当前模块的 Mock/Live 状态在 UI 中可辨识。

## 8. 分阶段实施

### Phase 0：后端主体与空快照

目标：先证明 UI、HTTP、聚合快照和 WebSocket 可以连通，不实现具体业务模块。

实现：

- Node.js/TypeScript 后端工程和启动脚本。
- CompositionRoot、SnapshotProjector、RealtimeHub。
- `/api/health`、`/api/state` 和 `/ws`。
- 完整但业务模块为 unavailable/offline 的 `ControlCenterSnapshot`。
- 前端 LiveControlCenterAdapter 和 Vite proxy。
- 前端增加 Home unavailable、TRAE offline 和全局 hybrid 类型及展示状态。
- UI 首次加载、在线、断线和协议错误状态。

验收：UI 六个页面都能打开；尚未实现的模块明确显示“未接入”，不会崩溃或展示伪造在线数据。

### Phase 1：Devices 模块

目标：先打通风险最低的只读页面，验证第一个完整模块闭环。

模块字段与现有 UI 对齐：

```text
deviceId, name, kind, zone, connection,
detail, lastSeen, metricLabel, metricValue,
adapterMode
```

接口：

```text
POST /api/devices/:deviceId/heartbeat
```

实现：

- Mock 设备列表和指标。
- DevicesService 及在线状态计算。
- 默认心跳 5 秒；15 秒后 degraded，45 秒后 offline。
- Devices 切片进入完整快照。
- DevicesView 使用后端数据。

验收：Mock 心跳变化可以驱动 DevicesView 在线、受限和离线状态，刷新和两个浏览器结果一致。

### Phase 2：Events 模块

目标：完成第一条带写操作和实时同步的业务闭环。

事件字段：

```text
schemaVersion, eventId, deviceId, source, type,
level, state, zone, title, summary, confidence,
occurredAt, updatedAt,
acknowledgedAt?, acknowledgedBy?,
resolvedAt?, resolvedBy?, adapterMode, payload
```

```text
level: info | warning | critical
state: detected | acknowledged | resolved | escalated
```

接口：

```text
POST /api/events
POST /api/events/:eventId/ack
POST /api/events/:eventId/resolve
```

实现：

- Mock 事件列表和 `fall_suspected` 触发方式。
- `eventId` 幂等。
- 确认、解决和非法状态转换。
- 根据未解决事件派生 `home` 状态。
- EventsView 按 `state` 展示待确认、已确认待解决和已关闭。
- Overview 暂时只接入 Events/Home 摘要，其余部分继续显示 unavailable/offline。

家庭状态规则：

- 未确认 critical：`emergency`。
- 已确认但未解决的 critical，或未解决 warning：`attention`。
- 没有未解决的 warning/critical：`normal`。

验收：一个浏览器确认或解决事件，另一个浏览器实时同步；确认不会直接把未解决事件恢复为 normal。

### Phase 3：TRAE 与 Commands 模块

目标：打通文本任务和共享命令生命周期。

TRAE 状态字段：

```text
state, label, project, task,
progress, suggestion, updatedAt
```

命令状态：

```text
requested -> accepted -> running -> succeeded
                         ├──────> failed
                         └──────> expired
```

接口：

```text
POST /api/trae/commands
GET  /api/commands?target=trae
```

实现：

- CommandsService 统一保存命令、状态转换和 `requestId` 幂等。
- MockTraeAdapter 模拟成功、失败和超时。
- TraeService 把命令状态投影为当前 TRAE 状态和进度。
- TraeView 和全局命令栏提交后端文本任务。
- 比赛首版的全局自由文本命令栏只允许 TRAE；Home Node、System 和 Robot 使用各自明确接口或暂时移除。
- UI 显示后端错误和最终结果。

验收：TRAE 命令完整推进，重复 `requestId` 不启动第二次执行，两个浏览器命令历史一致。

### Phase 4：Robot 模块

目标：在共享 CommandsService 上实现安全的结构化机器人动作。

接口：

```text
POST /api/robot/commands
POST /api/robot/emergency-stop
GET  /api/commands?target=robot
```

动作白名单：

```text
forward, backward, turn_left, turn_right,
patrol, return_home, stop, emergency_stop
```

规则：

- `forward/backward` 使用 1-100 的整数 `distanceCm`。
- `turn_left/turn_right` 使用 1-180 的整数 `angleDeg`。
- 普通移动动作要求 `confirmed: true`。
- `emergency_stop` 不等待普通命令队列。
- 后端不解析中文文本生成底层动作。
- 全局自由文本命令栏不能直接控制机器人。
- 只有 Adapter 最终回执可以标记 succeeded。

实现：

- MockRobotAdapter 和成功、失败、超时回执。
- RobotService 状态、电量、队列和动作投影。
- RobotView 提交 action/params，展示文本只用于界面。
- 二次确认、急停和错误状态 E2E。

验收：非法动作和绕过确认的移动命令被拒绝；急停优先；动作历史和当前状态一致。

### Phase 5：Diagnostics 与 Overview 聚合

目标：完成最后两个 UI 页面，并验证所有模块通过主体正确连接。

Diagnostics 字段：

```text
services[]: serviceId, name, connection, adapterMode,
            version, latency, detail

resources[]: id, label, value, displayValue, tone, history
```

实现：

- DiagnosticsModule 汇总后端、模块和 Adapter 健康状态。
- SystemView 使用真实的服务矩阵和资源指标。
- SnapshotProjector 完整聚合 Devices、Events、TRAE、Robot 和 Diagnostics。
- OverviewView 所有区域由聚合快照驱动。
- Console header 的连接、模式和告警数量使用后端数据。
- 静态 `AUTH MOCK`、`MOCK COMMAND ADAPTER` 文案改为动态状态。

验收：六个控制台页面都由后端模块驱动，总览数字与各模块页面一致。

### Phase 6：横向能力补全

目标：完成用户所说的“其他需要补全的部分”，不再增加新业务模块。

实现：

- 审计各模块已有的运行时校验，补齐遗漏字段和统一错误。
- WebSocket ping/pong、指数退避重连和慢客户端清理。
- 全局 revision 防止旧 REST 响应覆盖新 WS 状态。
- `POST /api/demo/reset`，原子重置全部模块和 Mock 定时器。
- 命令超时、终态保护和日志追踪。
- Mock/Live/Hybrid 和各 Adapter mode 展示。
- 启动、停止、健康检查和故障排查说明。
- 前后端联合测试和比赛演示脚本。

验收：断线、重连、重置、重复请求和局部模块失败不会造成状态错乱；从干净环境可以重复演示。

### Phase 7：逐步接入真实数据

目标：保持 UI 和模块业务逻辑不变，逐个替换数据源。

#### Home Node

- 后端连接 Home Node 现有 `/ws`。
- `snake_case` 转 `camelCase`。
- 等级映射：`info/low -> info`、`medium -> warning`、`high -> critical`。
- `fall_detected -> fall_suspected`。
- 固定表补充 `title/summary`。
- 中台确认后调用 Home Node 的 ack 接口。
- 重复上游快照不覆盖中台确认和解决状态。

#### TRAE

- `trae-status-monitor` 保持独立进程。
- 默认连接其 `8765` WebSocket。
- 映射当前状态、任务、建议和结果。
- 断线时保留最近有效状态并标记 degraded/offline。

#### Robot

- 只接收已经校验的结构化动作。
- 明确动作到硬件协议的映射。
- 普通动作设置超时，急停使用优先通道。
- 真实硬件未回执时不能显示成功。

每次只替换一个 Adapter。该 Adapter 的集成测试和现场验收通过后，再替换下一个。

## 9. 测试策略

### 每个模块必须完成

- 模块 Service 单元测试。
- 模块输入和状态转换测试。
- 模块路由 API 测试。
- 模块进入聚合快照的集成测试。
- 对应 UI 页面的 Playwright E2E。
- WebSocket 跨浏览器同步测试。

### 所有模块完成后补充

- revision 顺序和断线重连。
- Mock reset 取消旧定时任务。
- 多模块同时变化时的快照一致性。
- 单个 Adapter 失败不拖垮其他模块。
- Mock/Live/Hybrid 不会静默混用。

首版不做完整性能压测、分布式一致性、多租户和公网渗透测试。

## 10. 运行与安全边界

### 本地开发

- 后端默认监听 `127.0.0.1:8780`。
- 前端 Vite 默认运行在 `127.0.0.1:5180`。
- 本地比赛演示默认关闭服务端认证。
- UI Mock 登录只表示浏览器演示会话。

### 局域网演示

局域网能力放在 Phase 6 之后：

- 只有显式配置时才监听 `0.0.0.0`。
- UI 和设备使用不同的演示令牌。
- WebSocket 在发送快照前完成认证。
- 令牌不写入仓库、日志或 demo-state.json。
- 摄像头、USB、串口和设备原始端口不直接暴露。

公网部署、Cloudflare Access、真实账户和 RBAC 不进入比赛首版。

## 11. 明确推迟的内容

- 数据库、ORM、迁移和复杂备份。
- 多用户、RBAC、会话续期和多租户。
- 消息队列、微服务和 Kubernetes。
- 完整审计和通知平台。
- 原始视频持续上传和云端录像。
- 自然语言直接转换为机器人底层动作。
- 多机器人调度。

## 12. 最终完成定义

- 一个命令启动后端，另一个命令启动 UI。
- 六个控制台页面全部由后端模块驱动。
- 每个模块都有独立契约、Mock、接口和测试。
- SnapshotProjector 可以稳定组合所有模块。
- 两个浏览器实时看到相同状态。
- 事件完成上报、确认、解决和重置。
- TRAE 和机器人命令展示完整生命周期。
- 机器人只接受结构化白名单动作，急停优先。
- 任一模块或真实 Adapter 离线时其他模块仍可用。
- UI 明确显示 Mock/Live/Hybrid、连接和错误状态。
- 真实数据接入只替换 Adapter，不重写 UI 和模块主体。
