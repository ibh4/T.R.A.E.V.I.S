/**
 * Mock Badge Server - 本地 TCP Mock 服务器
 * 用于无硬件开发测试，模拟 ESP32 徽章接收状态命令
 */

import { createServer, Server, Socket } from 'net';

const DEFAULT_PORT = 3333;
const DEFAULT_HOST = '127.0.0.1';

interface ServerConfig {
  port: number;
  host: string;
  verbose: boolean;
}

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  let verbose = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--port':
      case '-p':
        if (args[i + 1]) {
          port = parseInt(args[++i], 10);
        }
        break;
      case '--host':
        if (args[i + 1]) {
          host = args[++i];
        }
        break;
      case '--quiet':
      case '-q':
        verbose = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return { port, host, verbose };
}

function printHelp(): void {
  console.log(`
Mock Badge Server

用法: tsx src/mock-badge-server.ts [选项]

选项:
  -p, --port <端口>   监听端口，默认 3333
  -h, --host <主机>  监听主机，默认 127.0.0.1
  -q, --quiet        禁用详细日志
  --help             显示帮助信息
  `);
}

function log(config: ServerConfig, message: string): void {
  if (config.verbose) {
    console.log(`[MockBadge] ${new Date().toISOString()} - ${message}`);
  }
}

let server: Server | null = null;
let clientCount = 0;
const config = parseArgs();

function handleConnection(socket: Socket): void {
  clientCount++;
  const clientId = clientCount;
  const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;

  log(config, `Client #${clientId} connected: ${remoteAddress} (total: ${clientCount})`);

  // 发送欢迎消息
  socket.write('TraePal ready\r\n');

  // 接收数据
  socket.on('data', (data: Buffer) => {
    const command = data.toString().trim();
    if (command) {
      log(config, `Client #${clientId} received: "${command}"`);
    }
  });

  // 客户端断开
  socket.on('close', () => {
    clientCount--;
    log(config, `Client #${clientId} disconnected (remaining: ${clientCount})`);
  });

  // 错误处理
  socket.on('error', (err) => {
    log(config, `Client #${clientId} error: ${err.message}`);
  });
}

function startServer(): void {
  server = createServer(handleConnection);

  server.on('error', (err) => {
    console.error(`[MockBadge] Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    console.log('===========================================');
    console.log('  Mock Badge Server');
    console.log('===========================================');
    console.log(`Listening on ${config.host}:${config.port}`);
    console.log('Waiting for connections...');
    console.log('');
    console.log('Commands received will be logged here.');
    console.log('Press Ctrl+C to stop.');
    console.log('');
  });
}

function shutdown(): void {
  console.log('\nShutting down Mock Badge Server...');

  if (server) {
    server.close((err) => {
      if (err) {
        console.error(`Error closing server: ${err.message}`);
      }
      console.log('Server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
