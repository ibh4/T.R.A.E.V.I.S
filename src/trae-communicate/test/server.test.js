import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createBridgeServer } from '../server.js';
import { loadConfig } from '../traeSender.js';
import { createMockStrategy } from './mock-strategy.js';

const apps = new Set();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

function createApp(strategy, server = {}) {
  const app = createBridgeServer({
    config: {
      strategy: 'mock',
      prompts: {},
      server: {
        host: '127.0.0.1',
        port: 0,
        cors: false,
        bodyMaxBytes: 4096,
        responseMaxBytes: 8192,
        errorMaxChars: 128,
        responseTextMaxChars: 128,
        queueMaxLength: 4,
        historyMaxLength: 10,
        strategyTimeoutMs: 200,
        readinessTimeoutMs: 100,
        shutdownEnabled: false,
        ...server
      }
    },
    strategy,
    strategyName: 'mock'
  });
  apps.add(app);
  return app;
}

async function request(app, method, pathname, body, headers = {}) {
  const address = app.address();
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await fetch(`http://${address.host}:${address.port}${pathname}`, {
    method,
    headers: {
      ...(payload === null ? {} : { 'content-type': 'application/json' }),
      ...headers
    },
    body: payload
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

async function startedApp(strategy, server) {
  const app = createApp(strategy, server);
  await app.start();
  return app;
}

test('config defaults use the local Phase 1 Bridge port and env overrides', () => {
  const config = loadConfig({ env: {} });
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.server.port, 8766);
  assert.equal(config.server.cors, false);

  const overridden = loadConfig({
    env: {
      TRAE_COMMUNICATE_HOST: '127.0.0.1',
      TRAE_COMMUNICATE_PORT: '8899',
      TRAE_COMMUNICATE_STRATEGY: 'mock',
      TRAE_COMMUNICATE_CORS: 'true'
    }
  });
  assert.deepEqual(
    {
      host: overridden.server.host,
      port: overridden.server.port,
      strategy: overridden.strategy,
      cors: overridden.server.cors
    },
    { host: '127.0.0.1', port: 8899, strategy: 'mock', cors: true }
  );
});

test('health, readiness, and default CORS/shutdown boundaries are stable', async () => {
  const app = await startedApp(createMockStrategy());
  const health = await request(app, 'GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.success, true);
  assert.equal(health.body.strategy, 'mock');
  assert.equal(health.body.strategyLoaded, true);
  assert.equal(health.headers.get('access-control-allow-origin'), null);

  const ready = await request(app, 'GET', '/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ready, true);
  assert.equal(ready.body.checks.mockReady, true);

  const shutdown = await request(app, 'POST', '/shutdown', {});
  assert.equal(shutdown.status, 404);
});

test('send returns bounded stable success envelopes for readable and unavailable responses', async () => {
  const strategy = createMockStrategy({
    onSend: async (text) => ({
      success: true,
      sent: true,
      message: `sent ${text}`,
      response: text === 'read this'
        ? { status: 'read', text: 'TRAE response text', source: 'mock' }
        : { status: 'unavailable', reason: 'No response in mock.' }
    })
  });
  const app = await startedApp(strategy);

  const readable = await request(app, 'POST', '/send', { requestId: 'req_read', text: 'read this' });
  assert.equal(readable.status, 200);
  assert.deepEqual(readable.body.response, { status: 'read', text: 'TRAE response text', source: 'mock' });
  assert.equal(readable.body.success, true);
  assert.equal(readable.body.sent, true);
  assert.equal(readable.body.requestId, 'req_read');

  const unavailable = await request(app, 'POST', '/send', { requestId: 'req_unavailable', text: 'no read' });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.response.status, 'unavailable');
  assert.equal(unavailable.body.sent, true);
  assert.equal(strategy.calls.length, 2);
});

test('input validation rejects malformed, unknown, empty, and oversized requests', async () => {
  const app = await startedApp(createMockStrategy());
  const cases = [
    { body: undefined, headers: {}, code: 'INVALID_JSON' },
    { body: '{', headers: { 'content-type': 'application/json' }, code: 'INVALID_JSON' },
    { body: { requestId: 'req_empty', text: ' ' }, code: 'INVALID_INPUT' },
    { body: { requestId: 'req_unknown', text: 'ok', buttonId: '1' }, code: 'INVALID_INPUT' },
    { body: { requestId: 'bad id', text: 'ok' }, code: 'INVALID_INPUT' },
    { body: { requestId: 'req_large', text: 'x'.repeat(2001) }, code: 'INVALID_INPUT' }
  ];
  for (const item of cases) {
    const result = item.body === '{'
      ? await fetch(`http://${app.address().host}:${app.address().port}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: item.body
      }).then(async (response) => ({ status: response.status, body: await response.json() }))
      : await request(app, 'POST', '/send', item.body, item.headers);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, item.code);
    assert.equal(result.body.sent, false);
  }
  const oversizedBody = JSON.stringify({ requestId: 'req_body', text: 'x'.repeat(100) });
  const oversized = await fetch(`http://${app.address().host}:${app.address().port}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(8192) },
    body: oversizedBody
  }).catch((error) => ({ error }));
  if (!oversized.error) {
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.error.code, 'BODY_TOO_LARGE');
  }
});

test('requestId idempotency returns one execution and conflicts on changed text', async () => {
  const strategy = createMockStrategy({ delayMs: 30 });
  const app = await startedApp(strategy);
  const firstRequest = request(app, 'POST', '/send', { requestId: 'req_once', text: 'only once' });
  const duplicateRequest = request(app, 'POST', '/send', { requestId: 'req_once', text: 'only once' });
  const [first, duplicate] = await Promise.all([firstRequest, duplicateRequest]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(first.body.sent, true);
  assert.equal(duplicate.body.sent, true);
  assert.equal(strategy.calls.length, 1);

  const conflict = await request(app, 'POST', '/send', { requestId: 'req_once', text: 'different' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'REQUEST_ID_CONFLICT');
  assert.equal(strategy.calls.length, 1);
});

test('concurrent commands operate strictly serially and preserve order', async () => {
  const strategy = createMockStrategy({ delayMs: 20 });
  const app = await startedApp(strategy);
  const results = await Promise.all([
    request(app, 'POST', '/send', { requestId: 'req_1', text: 'one' }),
    request(app, 'POST', '/send', { requestId: 'req_2', text: 'two' }),
    request(app, 'POST', '/send', { requestId: 'req_3', text: 'three' })
  ]);
  assert.deepEqual(strategy.calls, ['one', 'two', 'three']);
  assert.equal(strategy.maxActive, 1);
  assert.equal(results.every((result) => result.status === 200), true);
});

test('queue limit returns 429 and a failed task does not block the next task', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const strategy = createMockStrategy({
    onSend: async (text) => {
      if (text === 'first') await gate;
      if (text === 'fail') throw new Error('strategy failed with local path C:\\secret\\file');
      return { success: true, sent: true, response: { status: 'skipped' } };
    }
  });
  const app = await startedApp(strategy, { queueMaxLength: 1, strategyTimeoutMs: 500 });
  const first = request(app, 'POST', '/send', { requestId: 'req_first', text: 'first' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = request(app, 'POST', '/send', { requestId: 'req_fail', text: 'fail' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const full = await request(app, 'POST', '/send', { requestId: 'req_full', text: 'full' });
  assert.equal(full.status, 429);
  assert.equal(full.body.error.code, 'QUEUE_FULL');
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 502);
  assert.equal(secondResult.body.error.message.includes('C:\\secret'), false);
  assert.deepEqual(strategy.calls, ['first', 'fail']);
});

test('strategy timeout returns expired semantics and invokes strategy close', async () => {
  let abortPending;
  const pending = new Promise((_, reject) => { abortPending = reject; });
  let closeCount = 0;
  const strategy = createMockStrategy({
    onSend: async () => pending,
    onClose: async () => {
      closeCount += 1;
      abortPending(new Error('aborted by timeout'));
    }
  });
  const app = await startedApp(strategy, { strategyTimeoutMs: 20 });
  const result = await request(app, 'POST', '/send', {
    requestId: 'req_timeout',
    text: 'timeout'
  });
  assert.equal(result.status, 504);
  assert.equal(result.body.success, false);
  assert.equal(result.body.sent, false);
  assert.equal(result.body.error.code, 'STRATEGY_TIMEOUT');
  assert.equal(result.body.requestId, 'req_timeout');
  assert.equal(closeCount, 1);
  assert.equal(strategy.calls.length, 1);
});

test('readiness reports a structured unavailable state without sending a prompt', async () => {
  const strategy = createMockStrategy({ ready: false, readyReason: 'window missing' });
  const app = await startedApp(strategy);
  const ready = await request(app, 'GET', '/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.success, false);
  assert.equal(ready.body.ready, false);
  assert.equal(ready.body.reason, 'window missing');
  assert.deepEqual(strategy.calls, []);
});
