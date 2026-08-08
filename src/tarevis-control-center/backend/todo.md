# T.R.A.E.V.I.S. Control Center 后端推进清单（UI 模块驱动版）

> 文档日期：2026-08-03
> 对应计划：`backend/plan.md`
> 当前阶段：Phase 6（横向能力补全，待开始）

## 使用规则

- 按 Phase 顺序推进，当前模块验收通过后再进入下一个模块。
- 每个业务模块都必须完成：契约、Mock、Service、主体注册、UI 对接和测试。
- `[x]` 只表示已有可检查产出，讨论过但没有代码或夹具不能勾选。
- 模块字段需要变更时，先修改该模块契约和 JSON 夹具，再修改代码。
- Live 失败时必须明确显示错误，不允许自动切换 Mock 并继续显示在线。
- 每完成一个 Phase，记录实际命令、测试结果、耗时和遗留问题。

## 阶段总览

| 阶段 | 对应 UI | 目标 | 状态 |
| --- | --- | --- | --- |
| Phase 0 | Console 外壳、全部页面占位 | 后端、UI、HTTP、WS 连通 | 已完成（2026-08-02） |
| Phase 1 | DevicesView | 完成第一个只读模块闭环 | 已完成（2026-08-02） |
| Phase 2 | EventsView + 部分 Overview | 完成事件确认/解决闭环 | 已完成（2026-08-02） |
| Phase 3 | TraeView + 命令栏 | 完成 TRAE 命令生命周期 | 已完成（2026-08-02） |
| Phase 4 | RobotView | 完成结构化机器人动作闭环 | 已完成（2026-08-03） |
| Phase 5 | SystemView + Overview | 聚合全部模块 | 已完成（2026-08-03） |
| Phase 6 | 全部页面 | 补全重连、重置、日志和部署 | 未开始 |
| Phase 7 | 页面不变 | 逐个替换真实 Adapter | 未开始 |

## 已确认的架构边界

- [x] 后端采用 Node.js + TypeScript 模块化单体。
- [x] 所有模块运行在同一个后端进程和端口。
- [x] 默认监听 `127.0.0.1:8780`。
- [x] 前端开发端口保持 `127.0.0.1:5180`。
- [x] UI 通过一份完整 `ControlCenterSnapshot` 读取聚合状态。
- [x] Overview 不建立独立 Store，只聚合其他模块。
- [x] TRAE 和 Robot 共用 CommandsModule。
- [x] 每个模块先接 Mock Adapter，最后逐个替换 Live Adapter。
- [x] 浏览器 Mock 登录暂不接服务端认证。
- [x] 首版不引入数据库、ORM、消息队列和微服务。

---

## Phase 0：后端主体与空快照

### 阶段目标

不实现设备、事件、TRAE 和机器人业务，先证明前端可以稳定连接统一后端、读取完整空快照并接收 WebSocket 更新。

### 0.1 后端工程

- [x] 创建 `backend/package.json`。
- [x] 创建 `backend/tsconfig.json`。
- [x] 提供 `dev`、`build`、`typecheck` 和 `test` 脚本。
- [x] 创建 `src/server.ts` 和 `src/config.ts`。
- [x] 默认监听 `127.0.0.1:8780`。
- [x] 配置 host、port、mode 和日志级别。
- [x] 启动时打印实际监听地址和运行模式。
- [x] 处理 SIGINT/SIGTERM，关闭 HTTP、WS 和定时器。

### 0.2 最小公共契约

- [x] 创建 `core/contracts.ts`。
- [x] 定义 `schemaVersion: "1.0"`。
- [x] 定义 `ConnectionState: online | degraded | offline`。
- [x] 定义全局 `mode: mock | live | hybrid`。
- [x] 定义 `SnapshotEnvelope: schemaVersion, revision, snapshot`。
- [x] 定义 WebSocket `snapshot` 消息。
- [x] 定义统一错误 `{ error: { code, message } }`。
- [x] 定义完整 `ControlCenterSnapshot` 外形：
  - [x] `mode, connection, lastSyncedAt`。
  - [x] `home, trae, robot`。
  - [x] `devices, events, commands, services, resources` 数组。
- [x] 所有数组即使为空也必须存在。
- [x] HomeStatus.state 增加 unavailable。
- [x] TraeStatus.state 增加 offline。
- [x] 前端 ControlCenterSnapshot.mode 增加 hybrid。
- [x] 为尚未实现的模块定义明确的 unavailable/offline 占位状态。
- [x] 创建完整空快照 JSON 夹具。
- [x] 前端和后端分别校验同一份空快照夹具。

### 0.3 后端主体

- [x] 实现 `CompositionRoot`。
- [x] 实现 `SnapshotProjector`。
- [x] 实现 `RealtimeHub`。
- [x] RealtimeHub 维护单调递增 revision。
- [x] 未注册模块由 SnapshotProjector 输出空数组或 unavailable 状态。
- [x] CompositionRoot 不包含具体模块业务规则。
- [x] 定义模块注册、读取切片、订阅变化、健康检查和关闭的最小接口。

### 0.4 公共接口

- [x] `GET /api/health` 返回 ok、mode 和 revision。
- [x] `GET /api/state` 返回完整 SnapshotEnvelope。
- [x] 实现 WebSocket `/ws`。
- [x] WS 连接后立即发送完整快照。
- [x] 手动触发 core 状态变化时 revision 增加并广播。
- [x] 所有错误使用统一结构。

### 0.5 前端连接

- [x] 实现 `LiveControlCenterAdapter`。
- [x] 初始返回完整的 live/offline 空快照。
- [x] 通过 `/api/state` 获取初始状态。
- [x] 通过 `/ws` 接收完整快照。
- [x] 记录并比较 revision。
- [x] Live 失败时不实例化 MockControlCenterAdapter。
- [x] 添加 `VITE_CONTROL_CENTER_ADAPTER=live|mock`。
- [x] 添加 `VITE_CONTROL_CENTER_API_BASE=/`。
- [x] Vite 代理 `/api` 到 `127.0.0.1:8780`。
- [x] Vite 代理 `/ws` 到 `ws://127.0.0.1:8780`。
- [x] 增加首次加载、后端离线和协议错误 UI 状态。
- [x] 六个控制台页面在空快照下都能正常渲染。

### 0.6 测试与验收

- [x] 后端契约测试通过空快照夹具。
- [x] 前端契约测试通过同一份空快照夹具。
- [x] `/api/health` 和 `/api/state` API 测试通过。
- [x] WS 初始快照和 revision 测试通过。
- [x] Playwright 使用真实测试后端登录并打开六个页面。
- [x] 未实现模块显示“未接入”或 unavailable，不显示伪造在线数据。
- [x] 停止后端后 UI 显示离线且不崩溃。

### Phase 0 退出条件

```text
后端主体可启动
UI 可连接 /api/state 和 /ws
六个页面可渲染空快照
前后端共享夹具测试通过
```

### Phase 0 完成记录

> 完成日期：2026-08-02

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 7/7 通过 | 约 1 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 2/2 通过 | 约 1 秒 |
| `npm run test:e2e` | 7/7 通过 | 约 19 秒 |
| `npm run test:e2e:live` | 1/1 通过 | 约 10 秒 |

检查结果：真实后端、REST、WebSocket、六页空快照、断线和协议错误均已验收；桌面与移动端截图未发现遮挡或横向溢出。

遗留问题：业务模块仍按计划保持 unavailable/offline；WebSocket 重连、ping/pong 和慢客户端清理属于 Phase 6，不提前实现。首次运行 Playwright 前需执行 `npx playwright install chromium`。

---

## Phase 1：Devices 模块

### 阶段目标

完成第一个业务模块的完整闭环，验证“模块 -> 主体 -> 聚合快照 -> UI -> 测试”的开发方式。

### 1.1 模块契约

- [x] 创建 `modules/devices/devices-types.ts`。
- [x] 冻结 DeviceStatus 字段：
  - [x] `deviceId, name, kind, zone`。
  - [x] `connection, detail, lastSeen`。
  - [x] `metricLabel, metricValue, adapterMode`。
- [x] 固定 device kind 枚举并覆盖现有 UI 设备类型。
- [x] 定义 heartbeat 输入。
- [x] 为 heartbeat 输入增加运行时校验。
- [x] 默认心跳间隔 5 秒。
- [x] 15 秒未收到心跳变为 degraded。
- [x] 45 秒未收到心跳变为 offline。
- [x] 创建正常、受限、离线设备 JSON 夹具。

### 1.2 Mock 与 Service

- [x] 创建 MockDeviceSource。
- [x] 预置 PC、Home Node、Camera、Microphone、Badge 和 Robot。
- [x] 实现 DevicesService 内存状态。
- [x] 实现设备列表读取。
- [x] 实现 heartbeat 更新。
- [x] 使用可控时钟计算连接状态，不在测试中真实等待。
- [x] 连接状态跨越阈值时发出模块变更通知。

### 1.3 注册主体

- [x] 创建 Devices 路由。
- [x] 实现 `POST /api/devices/:deviceId/heartbeat`。
- [x] 在 CompositionRoot 注册 DevicesModule。
- [x] 把 devices 切片加入 SnapshotProjector。
- [x] Devices 变化后 RealtimeHub 增加 revision 并广播。
- [x] Diagnostics 暂时只记录 DevicesModule 是否已注册。

### 1.4 UI 对接

- [x] DevicesView 使用后端 devices 切片。
- [x] 在线、受限和离线计数来自后端状态。
- [x] 设备详情抽屉读取后端字段。
- [x] 空设备列表显示明确空状态。
- [x] Adapter mode 在设备或详情中可辨识。
- [x] heartbeat/API 错误不会导致页面崩溃。

### 1.5 测试与验收

- [x] DevicesService 单元测试。
- [x] heartbeat 输入校验测试。
- [x] online/degraded/offline 阈值测试。
- [x] Devices 路由测试。
- [x] devices 进入完整快照的集成测试。
- [x] DevicesView Playwright E2E。
- [x] 两个浏览器同时看到连接状态变化。
- [x] 刷新后设备状态与后端一致。

### Phase 1 退出条件

DevicesView 完全由后端 DevicesModule 驱动，其他未实现模块继续保持 unavailable。

### Phase 1 完成记录

> 完成日期：2026-08-02

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 16/16 通过 | 约 1 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 3 秒 |
| `npm test` | 3/3 通过 | 约 1 秒 |
| `npm run test:e2e` | 7/7 通过 | 约 17 秒 |
| `npm run test:e2e:live` | 2/2 通过 | 约 11 秒 |

检查结果：DevicesModule 契约、三种连接状态夹具、Mock 心跳、15/45 秒阈值、heartbeat API、聚合快照、WebSocket 广播和 DevicesView 均已验收；两个浏览器及刷新后的设备状态一致，其他未实现模块继续显示 unavailable/offline。

遗留问题：纯 `live` 模式在 LiveDeviceSource 尚未实现时明确保持 DevicesModule unavailable，heartbeat 返回 503 且不回退 Mock；真实 Device Adapter 属于 Phase 7。WebSocket ping/pong、退避重连和演示重置仍按计划留在 Phase 6。

---

## Phase 2：Events 模块

### 阶段目标

完成事件上报、显示、确认、解决和实时同步闭环，并开始驱动 Overview 的家庭状态部分。

### 2.1 模块契约

- [x] 创建 `modules/events/events-types.ts`。
- [x] 中台只使用 `level: info | warning | critical`。
- [x] 事件状态固定为 `detected | acknowledged | resolved | escalated`。
- [x] 冻结事件标识、来源、类型、区域、标题、摘要和时间字段。
- [x] 定义 acknowledged/resolved 时间和 actor 字段。
- [x] 定义 ack/resolve 请求体和本地演示 actor 默认值。
- [x] 定义 `adapterMode` 和结构化 payload。
- [x] 冻结首个事件类型 `fall_suspected`。
- [x] 定义 detected -> acknowledged -> resolved 合法转换。
- [x] 定义 escalated 和非法转换行为。
- [x] 为事件上报、ack 和 resolve 输入增加运行时校验。
- [x] 创建 detected、acknowledged、resolved、escalated 夹具。

### 2.2 Mock 与 Service

- [x] 创建 MockEventSource。
- [x] 预置一条 critical `fall_suspected`。
- [x] 实现 EventsService 内存状态。
- [x] 使用 `eventId` 保证事件幂等。
- [x] 重复事件不覆盖 acknowledged/resolved 状态。
- [x] 实现 acknowledge。
- [x] 实现 resolve。
- [x] 非法状态转换返回明确错误。
- [x] 根据未解决事件派生 HomeStatus。
- [x] 未确认 critical -> emergency。
- [x] 已确认未解决 critical 或未解决 warning -> attention。
- [x] 没有未解决 warning/critical -> normal。

### 2.3 注册主体

- [x] `POST /api/events`。
- [x] `POST /api/events/:eventId/ack`。
- [x] `POST /api/events/:eventId/resolve`。
- [x] 在 CompositionRoot 注册 EventsModule。
- [x] 把 events 和 home 切片加入 SnapshotProjector。
- [x] Events 变化后广播完整快照。

### 2.4 UI 对接

- [x] 更新前端 ControlEvent 类型，增加 state 和 resolved 字段。
- [x] EventsView 不再只依赖 acknowledgedAt 判断状态。
- [x] 展示“待确认 / 已确认待解决 / 已关闭 / 已升级”。
- [x] 增加“解决事件”操作。
- [x] 待处理筛选逻辑与 state 一致。
- [x] Console 告警数量与事件状态一致。
- [x] Overview 的 Home 和 Event 部分接入后端。
- [x] acknowledge/resolve 失败时显示用户可见错误。

### 2.5 测试与验收

- [x] EventsService 状态转换测试。
- [x] 重复 eventId 幂等测试。
- [x] HomeStatus 派生测试。
- [x] 事件 API 输入、404 和 409 测试。
- [x] events/home 进入完整快照的集成测试。
- [x] EventsView acknowledge/resolve E2E。
- [x] 两个浏览器事件同步 E2E。
- [x] 确认事件后不会错误恢复 normal。
- [x] 解决最后一个风险事件后恢复 normal。

### Phase 2 退出条件

EventsView 和 Overview 的家庭事件区域完全由 EventsModule 驱动。

### Phase 2 完成记录

> 完成日期：2026-08-02

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 25/25 通过 | 约 1 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 4/4 通过 | 约 1 秒 |
| `npm run test:e2e` | 7/7 通过 | 约 16 秒 |
| `npm run test:e2e:live` | 3/3 通过 | 约 14 秒 |

检查结果：EventsModule 契约、四种状态夹具、MockEventSource、事件幂等、确认/解决状态机、HomeStatus 派生、统一 400/404/409 错误、聚合快照和 WebSocket 广播均已验收；EventsView 与 Overview 使用后端 events/home 切片，两个浏览器可实时同步，写操作失败会显示用户可见错误。桌面 1440x900 与移动端 390x844 截图复核未发现文本重叠或横向溢出。

遗留问题：纯 `live` 模式在 LiveEventSource 尚未实现时明确保持 EventsModule unavailable，事件写接口返回 503 且不回退 Mock；真实 Home Node Event Adapter 属于 Phase 7。WebSocket ping/pong、退避重连和演示重置仍按计划留在 Phase 6。

---

## Phase 3：TRAE 与 Commands 模块

### 阶段目标

实现共享命令生命周期，并让 TraeView 和全局文本命令栏使用后端。

### 3.1 Commands 契约

- [x] 创建 `modules/commands/commands-types.ts`。
- [x] 冻结 `commandId, requestId, target, input`。
- [x] 冻结 `requestedAt, updatedAt, status, result, adapterMode`。
- [x] 状态固定为 requested/accepted/running/succeeded/failed/expired。
- [x] 定义合法和非法状态转换。
- [x] 终态不能回到运行态。
- [x] `requestId` 重复返回原 commandId，不重复执行。
- [x] 创建成功、失败和超时命令夹具。

### 3.2 TRAE 契约

- [x] 创建 `modules/trae/trae-types.ts`。
- [x] 冻结 `state, label, project, task, progress, suggestion, updatedAt`。
- [x] 定义 idle/analyzing/working/blocked/offline 状态。
- [x] 定义文本命令输入长度和空白规则。
- [x] 为 TRAE 文本命令增加运行时校验。
- [x] 创建 TRAE 空闲、运行、失败和离线夹具。

### 3.3 Mock 与 Service

- [x] 实现 CommandsService。
- [x] 实现 requestId 幂等索引。
- [x] 实现状态转换和终态保护。
- [x] 创建 MockTraeAdapter。
- [x] 模拟 requested -> accepted -> running -> succeeded。
- [x] 模拟 failed 和 expired。
- [x] Mock 定时任务可取消。
- [x] TraeService 根据命令投影状态和进度。

### 3.4 注册主体

- [x] `POST /api/trae/commands`。
- [x] `GET /api/commands?target=trae`。
- [x] 在 CompositionRoot 注册 CommandsModule 和 TraeModule。
- [x] 把 commands 和 trae 切片加入 SnapshotProjector。
- [x] 每次命令状态变化广播完整快照。

### 3.5 UI 对接

- [x] TraeView 提交后端命令。
- [x] 全局命令栏的 TRAE 目标提交同一接口。
- [x] 全局自由文本命令栏只保留 TRAE；移除或禁用 Home Node、System 和 Robot。
- [x] 命令历史读取后端 commands 切片。
- [x] 当前任务、进度和建议读取后端 trae 切片。
- [x] 提交失败显示错误。
- [x] 静态 Mock TRAE 文字改为读取 adapterMode。

### 3.6 测试与验收

- [x] CommandsService 状态和幂等测试。
- [x] MockTraeAdapter 成功、失败、超时测试。
- [x] TRAE API 输入和状态码测试。
- [x] trae/commands 聚合快照测试。
- [x] TraeView 命令生命周期 E2E。
- [x] 两个浏览器命令历史同步。
- [x] 重复 requestId 不启动第二次 Mock 执行。

### Phase 3 退出条件

TraeView 和全局 TRAE 文本命令完全由后端 TraeModule/CommandsModule 驱动。

### Phase 3 完成记录

> 完成日期：2026-08-02

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 35/35 通过 | 约 4 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 5/5 通过 | 约 1 秒 |
| `npm run test:e2e` | 7/7 通过 | 约 15 秒 |
| `npm run test:e2e:live` | 4/4 通过 | 约 19 秒 |

检查结果：CommandsModule 契约、成功/失败/超时夹具、requestId 幂等索引、合法状态转换和终态保护均已验收；MockTraeAdapter 的成功、失败、超时与定时任务取消通过测试。TraeView 与全局 TRAE 命令栏使用同一后端接口，命令历史、任务、进度、建议和最终结果由 commands/trae 快照驱动，两个浏览器实时一致。桌面 1440x900 与移动端 390x844 截图复核未发现文本重叠或横向溢出。

遗留问题：纯 `live` 模式在 LiveTraeAdapter 尚未实现时明确保持 TraeModule offline，TRAE 写接口返回 503 且不回退 Mock；真实 TRAE Adapter 属于 Phase 7。命令列表长度限制、日志追踪、reset 并发和超时横向治理仍按计划留在 Phase 6。

---

## Phase 4：Robot 模块

### 阶段目标

复用 CommandsModule，实现结构化白名单动作、二次确认、急停和回执。

### 4.1 模块契约

- [x] 创建 `modules/robot/robot-types.ts`。
- [x] 冻结 RobotStatus：state、label、connection、battery、task、updatedAt。
- [x] 动作白名单包含 forward/backward/turn_left/turn_right。
- [x] 动作白名单包含 patrol/return_home/stop/emergency_stop。
- [x] forward/backward 使用整数 distanceCm 1-100。
- [x] turn_left/turn_right 使用整数 angleDeg 1-180。
- [x] 普通移动动作要求 confirmed: true。
- [x] 为机器人 action、params 和 confirmed 增加运行时校验。
- [x] emergency_stop 使用独立请求且不等待普通队列。
- [x] 创建合法、非法、未确认和急停夹具。

### 4.2 Mock 与 Service

- [x] 创建 MockRobotAdapter。
- [x] 实现 RobotService 状态、电量、任务和队列。
- [x] 复用 CommandsService 创建机器人命令。
- [x] Mock 成功只由 Adapter 最终回执触发。
- [x] 模拟失败和超时。
- [x] 急停优先处理并更新当前状态。
- [x] 后端不解析自然语言决定动作。

### 4.3 注册主体

- [x] `POST /api/robot/commands`。
- [x] `POST /api/robot/emergency-stop`。
- [x] `GET /api/commands?target=robot`。
- [x] 在 CompositionRoot 注册 RobotModule。
- [x] 把 robot 和机器人 commands 加入聚合快照。
- [x] Robot 状态变化广播完整快照。

### 4.4 UI 对接

- [x] RobotView action id 与后端动作代码一致。
- [x] UI 提交 action/params，不提交中文动作文本。
- [x] 中文文本只用于确认弹窗和历史展示。
- [x] 普通动作保持二次确认。
- [x] 急停调用专用接口。
- [x] 从全局自由文本命令栏移除 ROBOT 目标。
- [x] 动作错误和超时显示用户可见状态。
- [x] Mock/Live Robot Adapter 状态动态显示。

### 4.5 测试与验收

- [x] RobotService 和参数校验单元测试。
- [x] 白名单和非法动作 API 测试。
- [x] 未确认移动命令拒绝测试。
- [x] 急停优先级测试。
- [x] 机器人命令终态回执测试。
- [x] RobotView 二次确认和急停 E2E。
- [x] 全局命令栏不能绕过 RobotView 测试。
- [x] 两个浏览器机器人状态同步。

### Phase 4 退出条件

RobotView 完全由 RobotModule 驱动，非法文本命令无法进入机器人执行路径。

### Phase 4 完成记录

> 完成日期：2026-08-03

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 45/45 通过 | 约 4 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 6/6 通过 | 约 2 秒 |
| `npm run test:e2e` | 8/8 通过 | 约 20 秒 |
| `npm run test:e2e:live` | 5/5 通过 | 约 25 秒 |

检查结果：RobotModule 已冻结 8 个结构化动作及参数边界，普通移动动作必须二次确认，中文展示文本不能作为后端动作输入。MockRobotAdapter 串行处理普通队列，成功、失败和超时均通过 Adapter 终态回执推进；专用急停会取消计时器、终止当前及排队动作并立即返回停止回执。Robot 状态、电量、队列命令和结果已经进入统一快照，RobotView 使用专用写接口并通过 WebSocket 在两个浏览器同步；全局自由文本栏保持仅支持 TRAE。

遗留问题：纯 `live` 模式在 LiveRobotAdapter 尚未实现时继续保持 RobotModule offline，机器人写接口返回 503 且不回退 Mock；真实硬件协议、优先通道和实机急停演练属于 Phase 7。命令列表上限、日志追踪、reset 并发和统一超时治理继续按计划留在 Phase 6。

---

## Phase 5：Diagnostics 与 Overview 聚合

### 阶段目标

完成 SystemView，统一聚合所有模块，并让 Overview 和 Console 外壳全部使用真实后端快照。

### 5.1 Diagnostics 契约

- [x] 创建 `modules/diagnostics/diagnostics-types.ts`。
- [x] 冻结 ServiceStatus 字段。
- [x] ServiceStatus 包含 adapterMode。
- [x] 冻结 ResourceMetric 字段和 history。
- [x] 创建在线、受限、离线服务夹具。
- [x] 创建 CPU、内存、视觉和告警资源夹具。

### 5.2 Service 与主体

- [x] 实现 DiagnosticsService。
- [x] 汇总 backend core 健康状态。
- [x] 汇总 Devices、Events、TRAE、Robot 模块状态。
- [x] 汇总各 Adapter mode 和连接状态。
- [x] 生成 resources 指标。
- [x] 把 services/resources 加入 SnapshotProjector。
- [x] 模块状态变化时更新 Diagnostics。

### 5.3 SystemView 对接

- [x] 服务矩阵读取后端 services。
- [x] 资源面板读取后端 resources。
- [x] 空指标和不可用指标有明确状态。
- [x] mode 显示 mock/live/hybrid。
- [x] SystemView 不再展示与实际连接冲突的固定 PENDING 文案。

### 5.4 Overview 和 Console 外壳

- [x] Overview Home 区域来自 EventsModule。
- [x] Overview Devices 摘要来自 DevicesModule。
- [x] Overview TRAE 摘要来自 TraeModule。
- [x] Overview Robot 摘要来自 RobotModule。
- [x] Overview resources 来自 DiagnosticsModule。
- [x] Overview 事件流来自 EventsModule。
- [x] Console connection 和 mode 使用后端数据。
- [x] Console 告警数量按事件 state 计算。
- [x] `AUTH MOCK` 和模块 Mock 静态文字改为动态状态。
- [x] 总览数字与各模块页面一致。

### 5.5 测试与验收

- [x] DiagnosticsService 聚合测试。
- [x] 单模块 offline 不影响其他模块测试。
- [x] services/resources 快照完整性测试。
- [x] SystemView E2E。
- [x] Overview 聚合 E2E。
- [x] 六个页面全部由后端状态驱动。
- [x] 六个页面在 desktop/mobile/480x320 不产生横向溢出。

### Phase 5 退出条件

所有现有控制台 UI 模块已完成后端 Mock 对接，页面之间的数据一致。

### Phase 5 完成记录

> 完成日期：2026-08-03

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 49/49 通过 | 约 4 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 7/7 通过 | 约 2 秒 |
| `npm run test:e2e` | 8/8 通过 | 约 20 秒 |
| `npm run test:e2e:live` | 7/7 通过 | 约 30 秒 |

检查结果：DiagnosticsModule 已聚合 Backend Core、Devices、Events、TRAE 与 Robot 的健康、连接和 Adapter mode，并生成后端进程 CPU/内存、视觉 FPS 与未解决告警指标。services/resources 已进入统一快照，模块变化通过同一 revision 和 WebSocket 同步更新 SystemView、Overview 与 Console 外壳。纯 live 模式在真实 Adapter 缺失时保持业务服务 offline 和视觉指标 UNAVAILABLE，不回退 Mock。Overview 的设备在线数、未解决事件数、TRAE、Robot 和资源摘要与各模块页面一致；六个控制台页面已在 1440x900、390x844 与 480x320 验收，无横向溢出。

遗留问题：真实服务认证、即时 CPU 采样与长期指标持久化不属于比赛首版；WebSocket 心跳/重连、演示重置、日志追踪和部署说明继续留在 Phase 6。Home Node、TRAE 与 Robot 的真实 Adapter 仍按计划留在 Phase 7，缺失时不会伪装在线。

---

## Phase 6：横向能力补全

### 阶段目标

不再增加业务模块，补全现场演示需要的稳定性、诊断、重置和启动能力。

### 6.1 校验和一致性

- [x] 审计所有模块的运行时校验并补齐遗漏。
- [x] 所有 API 错误使用统一结构。
- [x] 不存在资源返回 404，非法状态返回 409。
- [x] revision 阻止旧 REST 响应覆盖新 WS 快照。
- [x] 所有事件和命令列表限制最大长度。
- [x] 日志包含 deviceId、eventId、requestId 或 commandId。

### 6.2 WebSocket 与断线

- [x] 实现 ping/pong。
- [x] 清理死连接和慢客户端。
- [x] 前端实现有上限的指数退避重连。
- [x] 重连后重新读取完整快照。
- [x] 断线时保留最近有效状态并标记 degraded/offline。
- [x] 协议版本不兼容时显示明确错误。

### 6.3 演示重置

- [x] 实现 `POST /api/demo/reset`。
- [x] CompositionRoot 依次重置所有模块。
- [x] reset 原子增加一次 revision 并广播一次快照。
- [x] reset 取消 TRAE 和 Robot 旧 Mock 定时任务。
- [x] reset 后旧回调不能污染新状态。
- [x] 提供 UI 按钮或明确命令入口。

### 6.4 模式与降级

- [x] 全局 mode 正确显示 mock/live/hybrid。
- [x] 每个 Adapter 单独显示 mock/live 和 connection。
- [x] Live 失败时不自动伪装成 Mock 在线。
- [x] 显式切换 Mock 的操作和结果可见。
- [x] 单模块失败不拖垮后端进程。

### 6.5 启动和部署

- [x] 提供后端启动脚本。
- [x] 提供 UI + 后端联合启动说明。
- [x] 提供 health、revision、mode 和模块状态检查方法。
- [x] 提供停止流程并确认端口释放。
- [x] 提供比赛演示顺序。
- [x] 提供现场故障排查清单。
- [x] 从干净环境记录实际启动耗时。

### 6.6 完整验收

- [x] 模拟后端断线和恢复。
- [x] 模拟单个模块异常。
- [x] 模拟重复事件和重复命令。
- [x] 模拟命令超时和 reset 并发。
- [x] 两个浏览器持续保持状态一致。
- [x] 一次完整演示可以重复执行。

### Phase 6 退出条件

断线、重连、重置、重复请求、命令超时和局部模块异常均不会造成跨模块状态错乱；Mock 演示可以从干净环境启动并重复执行。

### Phase 6 完成记录

> 完成日期：2026-08-03

| 命令 | 结果 | 实测耗时 |
| --- | --- | --- |
| `cd backend && npm run typecheck` | 通过 | 约 2 秒 |
| `cd backend && npm run build` | 通过 | 约 2 秒 |
| `cd backend && npm test` | 57/57 通过 | 约 4 秒 |
| `npm run typecheck` | 通过 | 约 2 秒 |
| `npm run build` | 通过 | 约 4 秒 |
| `npm test` | 7/7 通过 | 约 1 秒 |
| `npm run test:e2e` | 8/8 通过 | 约 22 秒 |
| `npm run test:e2e:live` | 10/10 通过 | 约 41 秒 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/demo-smoke.ps1 -BackendBaseUrl http://127.0.0.1:8798` | 通过 | 约 6 秒 |
| `scripts/measure-clean-startup.ps1` | 全新安装、构建、启动与端口释放通过 | 约 19 秒 |

检查结果：运行时契约补齐了 ID、非空字符串、时间戳、边界值和历史长度校验；API 继续使用统一错误 envelope，不存在资源与非法状态分别实测 404/409。事件列表限制 200 条，命令列表限制 100 条；JSON 日志已覆盖 deviceId、eventId、requestId 和 commandId。WebSocket 每 15 秒 ping，清理未 pong 和缓冲超过 1 MiB 的客户端；Live Adapter 使用 0.5 秒起步、最高 8 秒的退避重连，保留最近快照并在进程重启后接受新的完整 revision 序列，旧 REST 响应不能覆盖新 WS 状态。

`POST /api/demo/reset` 会批量重置 Robot、TRAE、Commands、Events、Devices 和 Diagnostics，仅增加并广播一次 revision；Adapter generation 会阻断 reset 或急停前的旧回调。两个浏览器重复 reset、后端断线/恢复、单模块投影异常、重复事件/命令、超时和 reset 并发均已自动化验收。联合启动、停止、健康检查、模式选择、比赛演示和排障说明记录在 `backend/README.md`，`scripts/start-demo.ps1` 和 `scripts/demo-smoke.ps1` 可直接复用。

干净环境记录：Windows/Node.js 24.11.1 下，后端/前端 `npm ci` 分别 2.37s/7.51s，build 分别 1.29s/3.06s，后端到 health 就绪 607ms，Vite UI 就绪 1.10s；8799/5199 测试端口已确认释放。

遗留问题：真实 Home Node、TRAE 和 Robot Adapter、设备认证、持久化历史与真实账户权限属于 Phase 7 或后续生产化范围；纯 live 模式在 Adapter 缺失时继续明确 offline，不会伪装成 Mock 在线。

---

## Phase 7：逐步接入真实数据

### 阶段规则

- [ ] 每次只替换一个 Adapter。
- [ ] 替换时不修改 UI 主要流程。
- [ ] 替换时不修改模块公开契约。
- [ ] Live Adapter 失败不影响其他模块。
- [ ] 当前 Adapter 验收通过后再替换下一个。
- [ ] 始终保留显式 Mock 备用模式。

### 7.1 Home Node Adapter

- [ ] 配置 Home Node URL 和固定 deviceId。
- [ ] 连接其现有 `/ws`。
- [ ] 处理 `kind: snapshot`、更新和 ping。
- [ ] snake_case 转 camelCase。
- [ ] `info/low -> info`。
- [ ] `medium -> warning`。
- [ ] `high -> critical`。
- [ ] `fall_detected -> fall_suspected`。
- [ ] 使用固定表补充 title/summary。
- [ ] 原始字段保存到 payload.upstream。
- [ ] 中台 ack 后调用 Home Node ack 接口。
- [ ] 上游 ack 失败标记 degraded，不回滚中台确认。
- [ ] 重复上游快照不覆盖 acknowledged/resolved。
- [ ] Home Node 断线只影响相关设备和服务状态。
- [ ] 真实事件显示、确认和解决集成测试。

### 7.2 TRAE Adapter

- [ ] 配置 `trae-status-monitor` URL，默认端口 8765。
- [ ] 记录实际 WS 消息协议版本。
- [ ] 映射 idle/analyzing/working/blocked/offline。
- [ ] 映射任务、建议和进度。
- [ ] 明确网站命令转交接口。
- [ ] 映射成功、失败和超时结果。
- [ ] 断线时保留最近有效状态。
- [ ] TRAE Live 集成测试。

### 7.3 Robot Adapter

- [ ] 真实协议未冻结前不开始实现。
- [ ] 只接收已校验的结构化动作。
- [ ] 定义 action 到硬件协议的确定性映射。
- [ ] 普通动作设置超时。
- [ ] emergency_stop 使用优先通道。
- [ ] 只有硬件最终回执才能标记 succeeded。
- [ ] 明确显示 adapterMode: live。
- [ ] 实机演练急停。
- [ ] Robot Live 集成测试。

### Phase 7 退出条件

至少一条真实链路稳定运行；其余模块仍可使用明确标记的 Mock Adapter 完成演示。

---

## 跨阶段检查

- [x] 当前阶段没有遗留失败测试。
- [x] 当前模块已经进入统一 ControlCenterSnapshot。
- [x] 当前模块变化可以通过 WebSocket 到达两个浏览器。
- [x] 当前模块错误会在对应 UI 页面显示。
- [x] 当前模块的 Mock/Live 状态可辨识。
- [x] 未实现模块保持 unavailable，不伪造在线数据。
- [x] Overview 只聚合，不保存第二份业务状态。
- [x] TRAE 和 Robot 没有重复实现命令生命周期。
- [x] 浏览器不直接访问摄像头、USB、串口或设备原始端口。
- [x] 每个 Phase 都记录测试命令、结果和遗留问题。

## 当前下一步

```text
1. 按 Phase 7.1 接入 Home Node Adapter，并保持 UI 与公共快照契约不变
2. 记录真实上游协议和字段映射，保留 payload.upstream 与本地 ack 状态
3. 完成 Home Node 断线、重复快照、ack 失败和事件集成测试
4. Home Node 验收后再单独接入 TRAE Adapter
5. Robot 硬件协议冻结且完成实机急停演练前，不启动真实 Robot Adapter
```
