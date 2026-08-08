// traeSender.js
// 统一提示词发送接口：根据 config.strategy 选择具体实现策略
// 所有策略必须实现 sendPrompt(promptText) 方法，返回统一结果对象

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readEnvNumber(env, name, fallback) {
  if (env[name] === undefined) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`环境变量 ${name} 必须是非负整数`);
  }
  return value;
}

function readEnvPort(env, name, fallback) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`环境变量 ${name} 必须是 0-65535 的整数`);
  }
  return value;
}

function readEnvBoolean(env, name, fallback) {
  if (env[name] === undefined) return fallback;
  const value = String(env[name]).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`环境变量 ${name} 必须是 true 或 false`);
}

function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const cfgPath = options.configPath
    ?? env.TRAE_COMMUNICATE_CONFIG
    ?? path.join(__dirname, 'config.json');
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const server = config.server ?? {};
  const configuredPort = server.port ?? 8766;

  const playwright = config.playwright ?? {};
  const uiautomation = config.uiautomation ?? {};

  return {
    ...config,
    strategy: String(env.TRAE_COMMUNICATE_STRATEGY ?? config.strategy ?? 'playwright'),
    playwright: {
      ...playwright,
      headless: readEnvBoolean(env, 'TRAE_PLAYWRIGHT_HEADLESS', playwright.headless ?? true),
      workUrl: String(env.TRAE_PLAYWRIGHT_WORK_URL ?? playwright.workUrl ?? 'https://work.trae.cn/'),
      userDataDir: String(env.TRAE_PLAYWRIGHT_USER_DATA_DIR ?? playwright.userDataDir ?? './.edge-profile-trae')
    },
    uiautomation: {
      ...uiautomation,
      windowTitlePattern: String(
        env.TRAE_WINDOW_KEYWORD
          ?? env.TRAE_COMMUNICATE_WINDOW_TITLE_PATTERN
          ?? uiautomation.windowTitlePattern
          ?? 'Trae CN'
      ),
      responseTimeoutSec: readEnvNumber(
        env,
        'TRAE_UIAUTOMATION_RESPONSE_TIMEOUT_SEC',
        uiautomation.responseTimeoutSec ?? 25
      ),
      executionTimeoutMs: readEnvNumber(
        env,
        'TRAE_UIAUTOMATION_EXECUTION_TIMEOUT_MS',
        uiautomation.executionTimeoutMs ?? 30000
      ),
      readinessTimeoutMs: readEnvNumber(
        env,
        'TRAE_UIAUTOMATION_READINESS_TIMEOUT_MS',
        uiautomation.readinessTimeoutMs ?? 7000
      )
    },
    server: {
      ...server,
      host: String(env.TRAE_COMMUNICATE_HOST ?? server.host ?? '127.0.0.1'),
      port: readEnvPort(env, 'TRAE_COMMUNICATE_PORT', configuredPort),
      cors: readEnvBoolean(env, 'TRAE_COMMUNICATE_CORS', server.cors ?? false),
      bodyMaxBytes: readEnvNumber(env, 'TRAE_COMMUNICATE_BODY_MAX_BYTES', server.bodyMaxBytes ?? 16384),
      responseMaxBytes: readEnvNumber(env, 'TRAE_COMMUNICATE_RESPONSE_MAX_BYTES', server.responseMaxBytes ?? 65536),
      errorMaxChars: readEnvNumber(env, 'TRAE_COMMUNICATE_ERROR_MAX_CHARS', server.errorMaxChars ?? 512),
      responseTextMaxChars: readEnvNumber(env, 'TRAE_COMMUNICATE_RESPONSE_TEXT_MAX_CHARS', server.responseTextMaxChars ?? 4096),
      queueMaxLength: readEnvNumber(env, 'TRAE_COMMUNICATE_QUEUE_MAX_LENGTH', server.queueMaxLength ?? 16),
      historyMaxLength: readEnvNumber(env, 'TRAE_COMMUNICATE_HISTORY_MAX_LENGTH', server.historyMaxLength ?? 100),
      strategyTimeoutMs: readEnvNumber(env, 'TRAE_COMMUNICATE_STRATEGY_TIMEOUT_MS', server.strategyTimeoutMs ?? 60000),
      readinessTimeoutMs: readEnvNumber(env, 'TRAE_COMMUNICATE_READINESS_TIMEOUT_MS', server.readinessTimeoutMs ?? 8000),
      shutdownEnabled: readEnvBoolean(env, 'TRAE_COMMUNICATE_SHUTDOWN_ENABLED', server.shutdownEnabled ?? false),
      shutdownToken: env.TRAE_COMMUNICATE_SHUTDOWN_TOKEN ?? server.shutdownToken
    }
  };
}

function buildResult(success, data = {}) {
  return {
    success,
    prompt: data.prompt ?? null,
    label: data.label ?? null,
    strategy: data.strategy ?? null,
    message: data.message ?? (success ? 'ok' : 'failed'),
    response: data.response ?? null,
    windowTitle: data.windowTitle ?? null,
    windowKeyword: data.windowKeyword ?? null,
    error: data.error ?? null,
    sentAt: new Date().toISOString()
  };
}

async function loadStrategy(strategyName, options = {}) {
  const cfg = options.config ?? loadConfig(options);
  const name = strategyName ?? cfg.strategy ?? 'playwright';
  const safe = String(name).replace(/[^a-zA-Z0-9_-]/g, '');
  const file = path.join(__dirname, 'strategies', `${safe}Strategy.js`);
  if (!fs.existsSync(file)) {
    throw new Error(`未找到策略文件: ${file}`);
  }
  const mod = await import(`file://${file.replace(/\\/g, '/')}`);
  if (typeof mod.create !== 'function') {
    throw new Error(`策略 ${name} 必须导出 create() 工厂函数`);
  }
  const strategy = mod.create(cfg[safe] ?? {});
  if (typeof strategy.sendPrompt !== 'function') {
    throw new Error(`策略 ${name} 必须实现 sendPrompt(text)`);
  }
  return { strategy, strategyName: name, config: cfg };
}

// 把按钮编号映射为完整提示词
function resolvePrompt(input, promptsMap) {
  if (input == null) return null;
  const key = String(input);
  const entry = promptsMap?.[key];
  if (entry && entry.text) {
    return { text: entry.text, label: entry.label ?? key };
  }
  return null;
}

// 核心发送方法
export async function sendByButtonId(buttonId) {
  const { strategy, strategyName, config } = await loadStrategy();
  const resolved = resolvePrompt(buttonId, config.prompts);
  if (!resolved) {
    return buildResult(false, {
      strategy: strategyName,
      error: `未找到按钮 ${buttonId} 对应的提示词`
    });
  }
  try {
    const res = await strategy.sendPrompt(resolved.text);
    return buildResult(true, {
      prompt: resolved.text,
      label: resolved.label,
      strategy: strategyName,
      message: res?.message ?? 'ok',
      response: res?.response ?? null,
      windowTitle: res?.windowTitle ?? null,
      windowKeyword: res?.windowKeyword ?? null
    });
  } catch (err) {
    return buildResult(false, {
      prompt: resolved.text,
      label: resolved.label,
      strategy: strategyName,
      error: err?.message ?? String(err)
    });
  }
}

// 发送任意文本（不走按钮映射，供调试使用）
export async function sendRawText(text) {
  if (!text || typeof text !== 'string') {
    return buildResult(false, { error: 'text 不能为空' });
  }
  const { strategy, strategyName } = await loadStrategy();
  try {
    const res = await strategy.sendPrompt(text);
    return buildResult(true, {
      prompt: text,
      label: 'raw',
      strategy: strategyName,
      message: res?.message ?? 'ok',
      response: res?.response ?? null,
      windowTitle: res?.windowTitle ?? null,
      windowKeyword: res?.windowKeyword ?? null
    });
  } catch (err) {
    return buildResult(false, {
      prompt: text,
      strategy: strategyName,
      error: err?.message ?? String(err)
    });
  }
}

export { loadConfig, loadStrategy, resolvePrompt };
