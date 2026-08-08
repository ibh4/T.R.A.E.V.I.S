import { createServer, Server, Socket } from 'net';
import { BadgeTcpBridge } from '../badge-tcp-bridge.js';
import { StatusDetector } from '../status-detector.js';
import { DEFAULT_CONFIG, MonitorConfig } from '../types.js';
import { HomeScreenModel } from './home-screen-model.js';
import { MockHomeEventSource } from './mock-home-source.js';

async function main(): Promise<void> {
  const received: string[] = [];
  const sockets: Socket[] = [];
  const server = await startServer(received, sockets);
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('mock badge server address unavailable');
  }

  const config: MonitorConfig = {
    ...DEFAULT_CONFIG,
    projectPaths: [],
    wsPort: 8799,
    verbose: false,
    badgeEnabled: true,
    badgeHost: '127.0.0.1',
    badgePort: address.port,
    badgeReconnectMs: 100,
    badgeMaxReconnectMs: 500
  };

  const detector = new StatusDetector(config);
  const homeSource = new MockHomeEventSource();
  const homeScreenModel = new HomeScreenModel(homeSource);
  const bridge = new BadgeTcpBridge(detector, config, homeScreenModel);

  try {
    bridge.start();
    await waitFor(() => received.includes('idle_ready'), 'initial idle command');

    const event = homeScreenModel.triggerScenario('kitchen');
    await waitFor(() => received.includes('bug_alert'), 'home alert command');

    homeScreenModel.submitChoice({
      eventId: event.id,
      choiceId: 'a'
    });
    await waitFor(() => received.includes('fix_success'), 'home resolved command');

    console.log('Badge home mapping test passed');
  } finally {
    bridge.stop();
    sockets.forEach((socket) => socket.destroy());
    await closeServer(server);
  }
}

function startServer(received: string[], sockets: Socket[]): Promise<Server> {
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => received.push(line));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
