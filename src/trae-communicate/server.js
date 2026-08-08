import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadStrategy } from './traeSender.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const REQUEST_ID_MAX_CHARS = 128;
const TEXT_MAX_CHARS = 2000;
const RESPONSE_STATUSES = new Set(['read', 'unavailable', 'skipped']);
const TERMINAL_RECORD_STATUSES = new Set(['succeeded', 'failed', 'expired', 'cancelled']);

class BridgeHttpError extends Error {
  constructor(statusCode, code, message, requestId = null) {
    super(message);
    this.name = 'BridgeHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value, fallback, minimum = 1) {
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

function truncate(value, maximumLength) {
  const text = String(value ?? '');
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, Math.max(0, maximumLength - 3))}...`;
}

function sanitizeError(value, maximumLength) {
  const cwd = process.cwd();
  let text = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  if (cwd) text = text.split(cwd).join('[local-path]');
  text = text
    .replace(/[A-Za-z]:\\(?:[^\\/\s:*?"<>|\r\n]+\\)*[^\\/\s:*?"<>|\r\n]*/g, '[local-path]')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(text || 'Unknown error', maximumLength);
}

function normalizeResponse(value, textLimit, reasonLimit) {
  const response = isRecord(value) ? value : {};
  const status = RESPONSE_STATUSES.has(response.status) ? response.status : 'skipped';
  const normalized = { status };

  if (status === 'read') {
    const text = truncate(response.text ?? '', textLimit).trim();
    if (text) normalized.text = text;
    else {
      normalized.status = 'unavailable';
      normalized.reason = 'Strategy reported a readable response without text.';
    }
  } else {
    const fallback = status === 'unavailable'
      ? 'The prompt was sent, but no readable response was available.'
      : 'Response reading was skipped.';
    normalized.reason = truncate(response.reason ?? fallback, reasonLimit);
  }

  if (typeof response.source === 'string' && response.source.trim()) {
    normalized.source = truncate(response.source.trim(), 128);
  }
  if (typeof response.elapsedSec === 'number' && Number.isFinite(response.elapsedSec)) {
    normalized.elapsedSec = Math.max(0, response.elapsedSec);
  }
  return normalized;
}

function validateSendBody(value) {
  if (!isRecord(value)) {
    throw new BridgeHttpError(400, 'INVALID_INPUT', 'Request body must be a JSON object.');
  }
  const allowed = new Set(['requestId', 'text']);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new BridgeHttpError(400, 'INVALID_INPUT', `Unknown request field: ${unknown}`);
  }

  if (typeof value.requestId !== 'string'
    || !value.requestId.trim()
    || value.requestId.length > REQUEST_ID_MAX_CHARS) {
    throw new BridgeHttpError(
      400,
      'INVALID_INPUT',
      `requestId must be a non-empty string no longer than ${REQUEST_ID_MAX_CHARS} characters.`,
    );
  }
  const requestId = value.requestId.trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new BridgeHttpError(
      400,
      'INVALID_INPUT',
      'requestId contains unsupported characters.',
      requestId,
    );
  }
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > TEXT_MAX_CHARS) {
    throw new BridgeHttpError(
      400,
      'INVALID_INPUT',
      `text must be a non-empty string no longer than ${TEXT_MAX_CHARS} characters.`,
      requestId,
    );
  }
  return { requestId, text: value.text.trim() };
}

function readJsonBody(req, maximumBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      reject(new BridgeHttpError(400, 'INVALID_JSON', 'Content-Type must be application/json.'));
      req.resume();
      return;
    }

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      reject(new BridgeHttpError(400, 'BODY_TOO_LARGE', `Request body exceeds ${maximumBytes} bytes.`));
      req.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maximumBytes) {
        settled = true;
        reject(new BridgeHttpError(400, 'BODY_TOO_LARGE', `Request body exceeds ${maximumBytes} bytes.`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        reject(new BridgeHttpError(400, 'INVALID_JSON', 'Request body must not be empty.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new BridgeHttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.'));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        const error = new Error(`Strategy execution exceeded ${timeoutMs}ms.`);
        error.code = 'STRATEGY_TIMEOUT';
        reject(error);
      }
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

export function createBridgeServer(options = {}) {
  const config = options.config ?? loadConfig({ env: options.env });
  const serverConfig = config.server ?? {};
  const host = options.host ?? serverConfig.host ?? '127.0.0.1';
  const port = options.port ?? serverConfig.port ?? 8766;
  const bodyMaxBytes = boundedInteger(serverConfig.bodyMaxBytes, 16384);
  const responseMaxBytes = boundedInteger(serverConfig.responseMaxBytes, 65536);
  const errorMaxChars = boundedInteger(serverConfig.errorMaxChars, 512);
  const responseTextMaxChars = boundedInteger(serverConfig.responseTextMaxChars, 4096);
  const queueMaxLength = boundedInteger(serverConfig.queueMaxLength, 16);
  const historyMaxLength = boundedInteger(serverConfig.historyMaxLength, 100);
  const strategyTimeoutMs = boundedInteger(serverConfig.strategyTimeoutMs, 60000);
  const readinessTimeoutMs = boundedInteger(serverConfig.readinessTimeoutMs, 8000);
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const startedAt = Date.now();

  let strategy = options.strategy ?? null;
  let strategyName = options.strategyName ?? strategy?.name ?? config.strategy ?? 'unloaded';
  let strategyLoadError = null;
  let loadPromise = null;
  let readinessPromise = null;
  let lastReadiness = null;
  let activeTask = null;
  let listening = false;
  let closed = false;
  const queue = [];
  const records = new Map();

  async function ensureStrategy() {
    if (strategy) return strategy;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const loaded = options.strategyFactory
          ? await options.strategyFactory(config)
          : await loadStrategy(config.strategy, { config });
        strategy = loaded?.strategy ?? loaded;
        strategyName = loaded?.strategyName ?? strategy?.name ?? config.strategy;
        if (!strategy || typeof strategy.sendPrompt !== 'function') {
          throw new Error(`Strategy ${strategyName} must implement sendPrompt(text).`);
        }
        strategyLoadError = null;
        return strategy;
      } catch (error) {
        strategyLoadError = sanitizeError(error, errorMaxChars);
        strategy = null;
        throw error;
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function sendJson(res, statusCode, payload) {
    let body = JSON.stringify(payload);
    let effectiveStatus = statusCode;
    if (Buffer.byteLength(body) > responseMaxBytes) {
      effectiveStatus = 500;
      body = JSON.stringify({
        success: false,
        error: {
          code: 'RESPONSE_TOO_LARGE',
          message: `Response exceeds ${responseMaxBytes} bytes.`,
        },
      });
    }
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    };
    if (serverConfig.cors) {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-TRAE-Shutdown-Token';
    }
    res.writeHead(effectiveStatus, headers);
    res.end(body);
  }

  function errorPayload(error, fallbackRequestId = null) {
    const requestId = error instanceof BridgeHttpError
      ? error.requestId ?? fallbackRequestId
      : fallbackRequestId;
    const code = error instanceof BridgeHttpError ? error.code : 'INTERNAL_ERROR';
    return {
      success: false,
      requestId,
      sent: false,
      strategy: strategyName,
      message: sanitizeError(error, errorMaxChars),
      response: {
        status: 'skipped',
        reason: 'The prompt was not confirmed as sent.',
      },
      sentAt: now().toISOString(),
      error: {
        code,
        message: sanitizeError(error, errorMaxChars),
      },
    };
  }

  function pruneHistory() {
    const terminal = [...records.entries()]
      .filter(([, task]) => TERMINAL_RECORD_STATUSES.has(task.record.status))
      .sort((left, right) => left[1].record.completedAt.localeCompare(right[1].record.completedAt));
    while (terminal.length > historyMaxLength) {
      const [requestId] = terminal.shift();
      records.delete(requestId);
    }
  }

  function finishTask(task, statusCode, payload, recordStatus) {
    task.record.status = recordStatus;
    task.record.completedAt = now().toISOString();
    task.result = { statusCode, payload };
    task.resolve(task.result);
    pruneHistory();
  }

  function buildSuccessPayload(task, rawResult) {
    const response = normalizeResponse(rawResult?.response, responseTextMaxChars, errorMaxChars);
    const message = truncate(
      rawResult?.message
        ?? (response.status === 'read' ? 'Prompt sent and response read.' : 'Prompt sent to TRAE.'),
      errorMaxChars,
    );
    return {
      success: true,
      requestId: task.record.requestId,
      sent: true,
      strategy: strategyName,
      message,
      response,
      sentAt: now().toISOString(),
    };
  }

  async function executeTask(task) {
    task.record.status = 'running';
    task.record.startedAt = now().toISOString();
    try {
      const rawResult = await withTimeout(
        Promise.resolve().then(() => strategy.sendPrompt(task.record.text)),
        strategyTimeoutMs,
        () => {
          void Promise.resolve(strategy?.close?.()).catch(() => {});
        },
      );
      if (!isRecord(rawResult)) {
        throw new BridgeHttpError(
          502,
          'STRATEGY_PROTOCOL_ERROR',
          'Strategy returned an invalid result envelope.',
          task.record.requestId,
        );
      }
      if (rawResult?.success === false || rawResult?.sent === false) {
        const reason = rawResult?.error ?? rawResult?.message ?? 'Strategy did not send the prompt.';
        throw new BridgeHttpError(502, 'STRATEGY_FAILED', reason, task.record.requestId);
      }
      finishTask(task, 200, buildSuccessPayload(task, rawResult), 'succeeded');
    } catch (error) {
      const timedOut = error?.code === 'STRATEGY_TIMEOUT';
      const bridgeError = error instanceof BridgeHttpError
        ? error
        : new BridgeHttpError(
          timedOut ? 504 : 502,
          timedOut ? 'STRATEGY_TIMEOUT' : 'STRATEGY_FAILED',
          sanitizeError(error, errorMaxChars),
          task.record.requestId,
        );
      finishTask(
        task,
        bridgeError.statusCode,
        errorPayload(bridgeError, task.record.requestId),
        timedOut ? 'expired' : 'failed',
      );
    } finally {
      activeTask = null;
      void drainQueue();
    }
  }

  async function drainQueue() {
    if (closed || activeTask || queue.length === 0) return;
    activeTask = queue.shift();
    await executeTask(activeTask);
  }

  function enqueue(input) {
    const existing = records.get(input.requestId);
    if (existing) {
      if (existing.record.text !== input.text) {
        throw new BridgeHttpError(
          409,
          'REQUEST_ID_CONFLICT',
          'requestId is already associated with different text.',
          input.requestId,
        );
      }
      return existing.result ? Promise.resolve(existing.result) : existing.promise;
    }
    if (queue.length >= queueMaxLength) {
      throw new BridgeHttpError(
        429,
        'QUEUE_FULL',
        `Bridge queue is full (maximum ${queueMaxLength} waiting commands).`,
        input.requestId,
      );
    }

    let resolveTask;
    const promise = new Promise((resolve) => {
      resolveTask = resolve;
    });
    const task = {
      record: {
        requestId: input.requestId,
        text: input.text,
        status: 'queued',
        queuedAt: now().toISOString(),
      },
      promise,
      resolve: resolveTask,
      result: null,
    };
    records.set(input.requestId, task);
    queue.push(task);
    void drainQueue();
    return promise;
  }

  async function checkReadiness() {
    if (readinessPromise) return readinessPromise;
    readinessPromise = (async () => {
      try {
        const loaded = await ensureStrategy();
        const result = typeof loaded.checkReady === 'function'
          ? await withTimeout(
            Promise.resolve().then(() => loaded.checkReady()),
            readinessTimeoutMs,
            () => {
              void Promise.resolve(loaded.close?.()).catch(() => {});
            },
          )
          : { ready: true, checks: { strategyLoaded: true } };
        lastReadiness = {
          success: result?.ready === true,
          ready: result?.ready === true,
          strategy: strategyName,
          checks: isRecord(result?.checks) ? result.checks : { strategyLoaded: true },
          reason: result?.ready === true
            ? null
            : truncate(result?.reason ?? 'Strategy readiness check failed.', errorMaxChars),
          checkedAt: now().toISOString(),
        };
      } catch (error) {
        lastReadiness = {
          success: false,
          ready: false,
          strategy: strategyName,
          checks: { strategyLoaded: Boolean(strategy) },
          reason: sanitizeError(error, errorMaxChars),
          checkedAt: now().toISOString(),
        };
      } finally {
        readinessPromise = null;
      }
      return lastReadiness;
    })();
    return readinessPromise;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'OPTIONS' && serverConfig.cors) {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        success: true,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        strategy: strategyName,
        strategyLoaded: Boolean(strategy),
        strategyError: strategyLoadError,
        queue: { running: Boolean(activeTask), waiting: queue.length, maximum: queueMaxLength },
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/ready') {
      const readiness = await checkReadiness();
      sendJson(res, readiness.ready ? 200 : 503, readiness);
      return;
    }
    if (req.method === 'GET' && pathname === '/prompts') {
      sendJson(res, 200, { success: true, prompts: config.prompts ?? {} });
      return;
    }
    if (req.method === 'POST' && pathname === '/send') {
      let requestId = null;
      try {
        const body = await readJsonBody(req, bodyMaxBytes);
        const input = validateSendBody(body);
        requestId = input.requestId;
        try {
          await ensureStrategy();
        } catch (error) {
          throw new BridgeHttpError(
            503,
            'STRATEGY_UNAVAILABLE',
            `Strategy is unavailable: ${sanitizeError(error, errorMaxChars)}`,
            requestId,
          );
        }
        const result = await enqueue(input);
        sendJson(res, result.statusCode, result.payload);
      } catch (error) {
        const statusCode = error instanceof BridgeHttpError ? error.statusCode : 503;
        sendJson(res, statusCode, errorPayload(error, requestId));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/shutdown' && serverConfig.shutdownEnabled) {
      const expectedToken = String(serverConfig.shutdownToken ?? '');
      const receivedToken = String(req.headers['x-trae-shutdown-token'] ?? '');
      if (!expectedToken || receivedToken !== expectedToken) {
        const error = new BridgeHttpError(403, 'SHUTDOWN_FORBIDDEN', 'A valid shutdown token is required.');
        sendJson(res, 403, errorPayload(error));
        return;
      }
      sendJson(res, 200, { success: true, message: 'Bridge shutdown requested.' });
      setImmediate(() => void close());
      return;
    }

    const error = new BridgeHttpError(404, 'NOT_FOUND', `Unknown route: ${req.method} ${pathname}`);
    sendJson(res, 404, errorPayload(error));
  });

  async function start() {
    if (listening) return address();
    closed = false;
    try {
      await ensureStrategy();
    } catch (error) {
      logger.warn?.(`[strategy] preload failed: ${sanitizeError(error, errorMaxChars)}`);
    }
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        listening = true;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    return address();
  }

  function address() {
    const value = server.address();
    if (!value || typeof value === 'string') return { host, port };
    return { host: value.address, port: value.port };
  }

  async function close() {
    if (closed) return;
    closed = true;
    while (queue.length > 0) {
      const task = queue.shift();
      const error = new BridgeHttpError(
        503,
        'BRIDGE_CLOSING',
        'Bridge closed before the queued command started.',
        task.record.requestId,
      );
      finishTask(task, 503, errorPayload(error, task.record.requestId), 'cancelled');
    }
    try {
      await strategy?.close?.();
    } catch (error) {
      logger.warn?.(`[strategy] close failed: ${sanitizeError(error, errorMaxChars)}`);
    }
    if (!listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    listening = false;
  }

  return {
    start,
    close,
    address,
    checkReadiness,
    getQueueState: () => ({
      running: activeTask?.record.requestId ?? null,
      waiting: queue.map((task) => task.record.requestId),
      records: records.size,
    }),
  };
}

async function runCli() {
  const config = loadConfig();
  const app = createBridgeServer({ config });
  const address = await app.start();
  console.log(`[trae-communicate] listening on http://${address.host}:${address.port}`);
  console.log(`[trae-communicate] strategy: ${config.strategy}`);
  console.log('[trae-communicate] routes: GET /health, GET /ready, GET /prompts, POST /send');

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[trae-communicate] received ${signal}, closing`);
    await app.close();
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === currentFile) {
  runCli().catch((error) => {
    console.error(`[trae-communicate] startup failed: ${sanitizeError(error, 512)}`);
    process.exitCode = 1;
  });
}

export { validateSendBody };
