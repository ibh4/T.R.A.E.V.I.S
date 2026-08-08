# TRAE 状态监视器 (trae-status-monitor)

T.A.R.E.V.I.S. TRAE Status Monitor —— 监听项目活动，检测 TRAE 工作状态，并通过多种方式向外推送状态。

## 功能特性

- **文件监听检测**：监听项目目录的文件变化，自动推断工作状态
- **MCP 协议**：通过标准输入/输出提供状态查询和控制
- **WebSocket 桥接**：向浏览器/电子吧唧推送实时状态
- **徽章 TCP 桥接**：向 ESP32 硬件徽章推送状态（纯文本 TCP 协议）
- **手动状态设置**：支持通过 MCP 工具手动设置状态
- **非致命故障**：徽章/WebSocket 连接失败不影响主程序运行

## 安装

```bash
cd src/trae-status-monitor
npm install
```

## 构建

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

## 快速开始

### 开发模式（自动重启）

```bash
npm run dev -- --project <项目路径>
```

### 生产模式

```bash
npm run build
npm start -- --project <项目路径>
```

## 命令行选项

| 选项 | 说明 | 默认值 |
|---|---|---|
| `-p, --project <路径>` | 添加监视的项目路径（可多次指定） | 无 |
| `-t, --idle-timeout <毫秒>` | 空闲超时时间（进入睡眠） | 300000（5 分钟） |
| `-c, --cooldown <毫秒>` | 思考冷却时间（活动停止后回到空闲） | 30000（30 秒） |
| `--ws-port <端口>` | WebSocket 服务端口 | 8765 |
| `--badge-host <主机>` | 徽章 TCP 主机地址 | 192.168.4.1 |
| `--badge-port <端口>` | 徽章 TCP 端口 | 3333 |
| `--no-badge` | 禁用徽章 TCP 桥接 | - |
| `--badge-reconnect-ms <毫秒>` | 徽章初始重连间隔（指数退避） | 3000（最大 30000） |
| `-v, --verbose` | 启用详细日志 | 开启 |
| `-q, --quiet` | 禁用详细日志 | - |
| `-h, --help` | 显示帮助信息 | - |

### 示例

```bash
# 监视单个项目
npm start -- --project /path/to/my-project

# 监视多个项目
npm start -- --project /path/to/proj1 --project /path/to/proj2

# 连接到本地 Mock 徽章服务器
npm start -- --project /path/to/project --badge-host 127.0.0.1 --badge-port 3333

# 禁用徽章桥接
npm start -- --project /path/to/project --no-badge
```

## 状态说明

| 状态值 | 含义 |
|---|---|
| `idle_ready` | 空闲中，等待任务 |
| `thinking_scan` | 思考中（文件变化 / AI 处理） |
| `task_charge` | 工作中（编译 / 测试） |
| `fix_success` | 任务成功完成 |
| `bug_alert` | 出现错误 |
| `bug_maze` | 警告，需要关注 |
| `sleepy_nudge` | 睡眠中（长时间无活动） |
| `sync_ping` | 同步中 |

---

## 本地 Mock 模式（无硬件开发）

使用本地 Mock 徽章服务器模拟硬件，无需真实 ESP32 设备。

### 步骤

1. **启动 Mock 徽章服务器**

   ```bash
   npm run mock:badge
   ```

   服务器将监听 `127.0.0.1:3333`，并打印所有收到的命令。

   Mock 服务器选项：
   ```bash
   npm run mock:badge -- --port 3333 --host 127.0.0.1
   ```

2. **启动监视器（连接到 Mock）**

   新开一个终端：

   ```bash
   npm run dev -- --project /path/to/project --badge-host 127.0.0.1 --badge-port 3333
   ```

3. **验证**

   - Mock 服务器终端应显示收到 `idle_ready` 命令
   - 修改项目中的文件，观察状态变化对应的命令
   - 停止 Mock 服务器，监视器应自动重试（指数退避）
   - 重启 Mock 服务器，监视器应自动重连

---

## 真实硬件模式（ESP32 徽章）

### 硬件准备

1. 确保 ESP32 徽章已烧录 `traepal_wifi_player` 固件
2. 确保烧录前 `frames_spider.bin` 文件存在
3. 给徽章上电

### 连接 WiFi

1. 在电脑上连接 WiFi 网络：
   - SSID：`TraePal`
   - 密码：`12345678`

2. 确认连接成功后，可以 `ping 192.168.4.1` 测试连通性

### 运行监视器

```bash
cd src/trae-status-monitor
npm install
npm run build
npm start -- --project <项目路径> --badge-host 192.168.4.1 --badge-port 3333
```

### 预期行为

- 徽章初始显示空闲动画
- 当状态映射到 `bug_alert` 时，徽章显示错误动画
- 当状态映射到 `fix_success` 时，徽章显示成功动画
- 家庭信息接入后，高优先级家庭事件会降级显示为 `bug_alert`
- 家庭事件确认或解决后会降级显示为 `fix_success`
- `fix_success` 状态持续 10 秒后自动回到 `idle_ready`

---

## 状态映射表

当前硬件固件仅支持 3 个命令，PC 端的 8 种状态做如下有损映射：

| PC 状态 | 徽章命令 | 说明 |
|---|---|---|
| `idle_ready` | `idle_ready` | 空闲 |
| `thinking_scan` | `idle_ready` | 暂无专属动画 |
| `task_charge` | `idle_ready` | 暂无专属动画 |
| `sync_ping` | `idle_ready` | 暂无专属动画 |
| `sleepy_nudge` | `idle_ready` | 暂无专属动画 |
| `fix_success` | `fix_success` | 成功 |
| `bug_alert` | `bug_alert` | 错误 |
| `bug_maze` | `bug_alert` | 警告暂映射为错误 |

> 映射逻辑集中在 `badge-tcp-bridge.ts` 的 `mapStatusToCommand()` 函数中，固件支持更多状态后可直接扩展。

### 家庭信息降级映射

当前家庭信息通过 `home_screen_update.status` 复用同一套三态硬件命令，不改变 ESP32 固件协议。

| 家庭事件 | 家庭屏幕状态 | 徽章命令 | 说明 |
|---|---|---|---|
| 暂无家庭事件 | `idle_ready` | `idle_ready` | 家庭状态正常 |
| 快递到达等低优先级提醒 | `sync_ping` | `idle_ready` | 低打扰提醒，硬件保持空闲动画 |
| 访客停留等中优先级提醒 | `bug_maze` | `bug_alert` | 当前固件暂无黄色提醒，暂映射为错误动画 |
| 厨房风险、疑似跌倒、门口异常 | `bug_alert` | `bug_alert` | 高优先级家庭告警 |
| 用户确认 / 事件已解决 | `fix_success` | `fix_success` | 告警收束反馈 |

> 这是一阶段硬件兼容方案。固件支持更多动画后，可扩展为 `home_delivery`、`home_visitor`、`home_alert`、`home_resolved` 等更细命令。

---

## 网络连接常见问题

### 连接 WiFi 后无法上网？

ESP32 工作在 AP 模式，电脑连接后默认网关可能切换到 ESP32。解决方法：

- 使用有线网 + WiFi 同时连接
- 确保 192.168.4.x 网段走 WiFi，其他流量走默认网关
- 或者临时使用手机热点等其他方式上网

### 连不上徽章？

排查步骤：

1. 确认徽章已上电，AP 已启动（能搜到 `TraePal` WiFi）
2. 确认电脑已连接到 `TraePal` WiFi
3. 尝试 `ping 192.168.4.1` 测试连通性
4. 确认徽章 TCP 端口是 3333（固件默认值）
5. 检查是否有其他设备占用了 AP 连接（最多支持 2 个客户端）

### 徽章最多支持几个客户端？

ESP32 AP 模式最多支持 2 个同时连接，请确保没有多余设备占用连接。

---

## MCP 协议

通过标准输入/输出与 MCP 客户端通信，提供：

- **资源**：当前状态查询
- **工具**：手动设置状态、记录活动、记录构建结果等
- **家庭信息资源**：`trae://status/home-screen`
- **家庭信息工具**：`get_home_screen`、`trigger_home_event`、`submit_home_choice`

## WebSocket 协议

- 地址：`ws://localhost:8765`
- 项目消息类型：`status_update`、`screen_update`、`select_project`、`user_choice`
- 家庭消息类型：`home_screen_update`、`trigger_home_event`、`home_choice`、`home_choice_ack`
- 基础消息类型：`subscribe`、`unsubscribe`、`ping`、`pong`

### 家庭信息 WebSocket 示例

触发一个 mock 家庭事件：

```json
{
  "type": "trigger_home_event",
  "payload": {
    "scenario": "kitchen"
  }
}
```

提交家庭事件三选项：

```json
{
  "type": "home_choice",
  "payload": {
    "eventId": "home_evt_0001",
    "choiceId": "a",
    "label": "确认"
  }
}
```

## 徽章 TCP 协议

- 协议：纯文本，换行分隔
- 支持命令：`idle_ready`、`bug_alert`、`fix_success`

---

## 未来扩展

- 扩展固件支持更多动画状态，替换有损映射
- 考虑 STA 模式或服务发现（替代 AP 模式）
- 优化 TCP 粘包/分包处理（如需）

## 相关文件

- 硬件固件：`../hardware/traepal_wifi_player/`
- 集成开发计划：`../../docs/0626_statusIntegration/development_plan.md`
- 任务清单：`../../docs/0626_statusIntegration/todo.md`
