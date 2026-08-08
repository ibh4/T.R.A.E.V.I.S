/**
 * T.A.R.E.V.I.S. TRAE 状态监视器
 * 入口文件
 *
 * 功能：
 * 1. 监听项目文件变化
 * 2. 通过 MCP 协议提供状态
 * 3. 通过 WebSocket 提供实时状态给电子吧唧和网页
 */

import { StatusDetector } from './status-detector.js';
import { TraeStatusServer } from './server.js';
import { WebSocketBridge } from './ws-bridge.js';
import { BadgeTcpBridge } from './badge-tcp-bridge.js';
import { MonitorConfig, DEFAULT_CONFIG } from './types.js';
import { TraePalScreenModel } from './traepal-screen-model.js';
import { MockHomeEventSource } from './home/mock-home-source.js';
import { HomeScreenModel } from './home/home-screen-model.js';

// 解析命令行参数
function parseArgs(): MonitorConfig {
  const args = process.argv.slice(2);
  const config: MonitorConfig = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--project':
      case '-p':
        if (args[i + 1]) {
          config.projectPaths.push(args[++i]);
        }
        break;
      case '--idle-timeout':
      case '-t':
        if (args[i + 1]) {
          config.idleTimeout = parseInt(args[++i], 10);
        }
        break;
      case '--cooldown':
      case '-c':
        if (args[i + 1]) {
          config.thinkingCooldown = parseInt(args[++i], 10);
        }
        break;
      case '--ws-port':
        if (args[i + 1]) {
          config.wsPort = parseInt(args[++i], 10);
        }
        break;
      case '--badge-host':
        if (args[i + 1]) {
          config.badgeHost = args[++i];
        }
        break;
      case '--badge-port':
        if (args[i + 1]) {
          config.badgePort = parseInt(args[++i], 10);
        }
        break;
      case '--no-badge':
        config.badgeEnabled = false;
        break;
      case '--badge-reconnect-ms':
        if (args[i + 1]) {
          config.badgeReconnectMs = parseInt(args[++i], 10);
        }
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--quiet':
      case '-q':
        config.verbose = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
T.A.R.E.V.I.S. TRAE 状态监视器

用法: node index.js [选项]

选项:
  -p, --project <路径>      添加监视的项目路径 (可多次指定)
  -t, --idle-timeout <毫秒> 空闲超时时间，默认 300000 (5分钟)
  -c, --cooldown <毫秒>     思考冷却时间，默认 10000 (10秒)
  --ws-port <端口>          WebSocket 端口，默认 8765
  --badge-host <主机>       徽章 TCP 主机，默认 192.168.4.1
  --badge-port <端口>       徽章 TCP 端口，默认 3333
  --no-badge                禁用徽章 TCP 桥接
  --badge-reconnect-ms <毫秒> 徽章初始重连间隔，默认 3000 (最大退避到 30000)
  -v, --verbose            启用详细日志
  -q, --quiet              禁用详细日志
  -h, --help               显示帮助信息

MCP 协议:
  通过标准输入/输出与 MCP 客户端通信

WebSocket 协议:
  ws://localhost:8765

徽章 TCP 协议:
  纯文本命令，换行分隔，支持 idle_ready / bug_alert / fix_success

TraePal 小屏协议:
  服务器会广播 screen_update，包含项目列表、项目详情、进度和三选一选项
  客户端可发送 select_project 或 user_choice 消息回传触摸结果

家庭信息协议:
  服务器会广播 home_screen_update，包含家庭事件、最高优先级提醒和三选一选项
  客户端可发送 trigger_home_event 或 home_choice 消息回传家庭事件演示和触摸结果

状态说明:
  idle_ready    - 空闲中
  thinking_scan - 思考中 (文件变化/AI处理)
  task_charge   - 工作中 (编译/测试)
  fix_success   - 成功完成
  bug_alert     - 错误
  bug_maze      - 警告
  sleepy_nudge  - 睡眠中 (长时间无活动)
  sync_ping     - 同步中

示例:
  node index.js --project /path/to/project --ws-port 8765
  node index.js -p ./my-project -c 5000
  node index.js -p ./my-project --badge-host 127.0.0.1 --badge-port 3333
  `);
}

// 主函数
async function main(): Promise<void> {
  console.log('===========================================');
  console.log('  T.A.R.E.V.I.S. TRAE Status Monitor');
  console.log('  Version: 0.1.0');
  console.log('===========================================');
  console.log('');

  // 解析配置
  const config = parseArgs();

  console.log('Configuration:');
  console.log(`  Project Paths: ${config.projectPaths.length > 0 ? config.projectPaths.join(', ') : '(none)'}`);
  console.log(`  Idle Timeout: ${config.idleTimeout}ms (${Math.round(config.idleTimeout / 60000)} min)`);
  console.log(`  Thinking Cooldown: ${config.thinkingCooldown}ms (${config.thinkingCooldown / 1000}s)`);
  console.log(`  Success Duration: ${config.successDuration}ms (${config.successDuration / 1000}s)`);
  console.log(`  WebSocket Port: ${config.wsPort}`);
  console.log(`  Badge TCP: ${config.badgeEnabled ? `${config.badgeHost}:${config.badgePort}` : 'disabled'}`);
  console.log(`  Verbose: ${config.verbose}`);
  console.log('');

  // 创建状态检测器
  const detector = new StatusDetector(config);
  const screenModel = new TraePalScreenModel(detector);
  const homeEventSource = new MockHomeEventSource();
  const homeScreenModel = new HomeScreenModel(homeEventSource);

  // 创建 MCP 服务器
  const mcpServer = new TraeStatusServer(detector, config, screenModel, homeScreenModel);

  // 创建 WebSocket 桥接
  const wsBridge = new WebSocketBridge(detector, config, screenModel, homeScreenModel);

  // 创建徽章 TCP 桥接
  const badgeBridge = new BadgeTcpBridge(detector, config, homeScreenModel);
  currentBadgeBridge = badgeBridge;

  // 启动
  try {
    // 启动状态检测器
    await detector.start();

    // 启动 WebSocket 服务器
    wsBridge.start();

    // 启动徽章 TCP 桥接
    badgeBridge.start();

    // 启动 MCP 服务器 (会阻塞)
    await mcpServer.start();
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// 优雅关闭
let currentBadgeBridge: BadgeTcpBridge | null = null;

async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  if (currentBadgeBridge) {
    currentBadgeBridge.stop();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 运行
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
