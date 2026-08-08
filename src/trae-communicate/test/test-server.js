// Bridge HTTP smoke test. It injects a Mock Strategy and never touches TRAE.
// Usage: node test/test-server.js

import { createBridgeServer } from '../server.js';
import { createMockStrategy } from './mock-strategy.js';

async function request(address, method, pathname, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`http://${address.host}:${address.port}${pathname}`, {
    method,
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    body: payload
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function main() {
  const strategy = createMockStrategy({
    onSend: async (text) => ({
      success: true,
      sent: true,
      message: 'mock prompt sent',
      response: text.includes('read')
        ? { status: 'read', text: 'Mock TRAE response', source: 'mock' }
        : { status: 'unavailable', reason: 'Mock response unavailable.' }
    })
  });
  const app = createBridgeServer({
    strategy,
    strategyName: 'mock',
    config: {
      strategy: 'mock',
      prompts: {},
      server: {
        host: '127.0.0.1',
        port: 0,
        cors: false,
        bodyMaxBytes: 16384,
        responseMaxBytes: 65536,
        queueMaxLength: 4,
        strategyTimeoutMs: 1000
      }
    }
  });
  try {
    const address = await app.start();
    console.log('health:', await request(address, 'GET', '/health'));
    console.log('ready:', await request(address, 'GET', '/ready'));
    console.log('send:', await request(address, 'POST', '/send', {
      requestId: 'req_smoke_read',
      text: 'read mock response'
    }));
    console.log('duplicate:', await request(address, 'POST', '/send', {
      requestId: 'req_smoke_read',
      text: 'read mock response'
    }));
    console.log('unavailable:', await request(address, 'POST', '/send', {
      requestId: 'req_smoke_unavailable',
      text: 'mock without response'
    }));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Bridge smoke test failed:', error.message);
  process.exitCode = 1;
});
