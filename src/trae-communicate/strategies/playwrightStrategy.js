// strategies/playwrightStrategy.js
// 主策略：Playwright + Edge 持久化登录，操作 work.trae.cn 网页版输入框
// 选择器优先级：data-testid > placeholder > contenteditable
// 首次运行需手动登录，登录态写入 userDataDir 后续复用

import { chromium } from 'playwright';

let browser = null;
let context = null;
let page = null;
let initializing = null;

async function ensureReady(cfg) {
  if (page && !page.isClosed()) return page;

  if (initializing) return initializing;

  initializing = (async () => {
    const channel = cfg.channel || 'msedge';
    const headless = process.env.HEADLESS === '0' ? false : (cfg.headless ?? true);
    const userDataDir = cfg.userDataDir;

    browser = await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless,
      viewport: { width: 1280, height: 800 }
    });
    context = browser;
    page = browser.pages()[0] || (await browser.newPage());

    page.setDefaultTimeout(cfg.navigationTimeoutMs ?? 30000);
    page.setDefaultNavigationTimeout(cfg.navigationTimeoutMs ?? 30000);

    // 打开 TRAE Work
    const currentUrl = page.url();
    if (!currentUrl.startsWith(cfg.workUrl)) {
      await page.goto(cfg.workUrl, { waitUntil: 'domcontentloaded' });
    }

    // 首次登录检测：如果跳到登录页，提示用户手动登录一次
    if (/login|sign|passport/i.test(page.url())) {
      throw new Error(
        `检测到登录页 ${page.url()}，请先用 HEADLESS=0 启动一次完成登录，登录态会写入 ${userDataDir}`
      );
    }
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
  return page;
}

async function locateInput(page, selectorStr) {
  const selectors = String(selectorStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

async function typeInto(el, text) {
  // 中文输入走 fill，避免 typewrite 失效
  if (await el.evaluate((node) => node.tagName?.toLowerCase() === 'textarea' || node.isContentEditable)) {
    await el.fill('');
    await el.fill(text);
  } else {
    await el.fill(text);
  }
}

async function pressSend(page, el, sendKey) {
  if (!sendKey || sendKey === 'Enter') {
    await el.press('Enter');
    return;
  }
  if (Array.isArray(sendKey)) {
    await page.keyboard.press(sendKey.join('+'));
    return;
  }
  await page.keyboard.press(sendKey);
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function collectVisibleTexts(page, selectorStr) {
  const selectors = String(selectorStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fallbackSelectors = [
    '[data-testid*="message"]',
    '[class*="message"]',
    '[class*="markdown"]',
    '[class*="answer"]',
    'main',
    'body'
  ];

  for (const sel of [...selectors, ...fallbackSelectors]) {
    try {
      const texts = await page.$$eval(sel, (nodes) => {
        function visible(node) {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        }
        return nodes
          .filter(visible)
          .map((node) => node.innerText || node.textContent || '')
          .map((text) => text.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
      });
      if (texts.length) return texts;
    } catch (_) {}
  }

  return [];
}

function pickResponseTexts(beforeTexts, afterTexts, prompt) {
  const beforeLines = new Set(beforeTexts.flatMap(splitLines));
  const promptText = String(prompt || '').trim();
  const ignored = new Set([
    '发送',
    '停止',
    '重新生成',
    '复制',
    'Work',
    'Code',
    'Design'
  ]);

  const candidates = [];
  for (const text of afterTexts) {
    for (const line of splitLines(text)) {
      if (beforeLines.has(line)) continue;
      if (ignored.has(line)) continue;
      if (promptText && (line === promptText || line.includes(promptText))) continue;
      if (line.length < 2) continue;
      candidates.push(line);
    }
  }

  return [...new Set(candidates)].sort((a, b) => b.length - a.length).slice(0, 8);
}

async function waitForResponse(page, prompt, cfg, beforeTexts) {
  const timeoutMs = cfg.responseTimeoutMs ?? ((cfg.responseTimeoutSec ?? 30) * 1000);
  const pollMs = cfg.responsePollIntervalMs ?? ((cfg.responsePollIntervalSec ?? 1) * 1000);
  const stableMs = cfg.responseStableMs ?? 1500;
  const started = Date.now();
  let best = [];
  let lastText = '';
  let stableSince = 0;
  let lastAfter = beforeTexts;

  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(pollMs);
    const afterTexts = await collectVisibleTexts(page, cfg.responseSelector);
    lastAfter = afterTexts;
    const candidates = pickResponseTexts(beforeTexts, afterTexts, prompt);
    if (!candidates.length) continue;

    best = candidates;
    if (candidates[0] === lastText) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) {
        break;
      }
    } else {
      lastText = candidates[0];
      stableSince = Date.now();
    }
  }

  if (best.length) {
    return {
      status: 'read',
      text: best[0],
      candidates: best,
      source: 'playwright-dom',
      elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2))
    };
  }

  return {
    status: 'unavailable',
    text: null,
    candidates: [],
    source: 'playwright-dom',
    elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
    reason: 'No new response text was detected in the page DOM.',
    visibleTextCount: lastAfter.length
  };
}

async function sendPrompt(text, cfg) {
  const page = await ensureReady(cfg);
  const beforeTexts = await collectVisibleTexts(page, cfg.responseSelector);

  // 等待输入框出现（可能是 textarea 或 contenteditable）
  const selectorStr = cfg.inputSelector;
  let el = await locateInput(page, selectorStr);
  if (!el) {
    await page.waitForTimeout(1500);
    el = await locateInput(page, selectorStr);
  }
  if (!el) {
    throw new Error(
      `未找到输入框，当前 URL=${page.url()}，选择器=${selectorStr}。可能页面结构已变化或登录态过期`
    );
  }

  await el.click();
  await typeInto(el, text);

  // 发送前留一点时间，避免 IME 上屏未完成
  await page.waitForTimeout(120);
  await pressSend(page, el, cfg.sendKey);
  const response = await waitForResponse(page, text, cfg, beforeTexts);

  return {
    message: response.status === 'read' ? 'prompt sent and response read' : 'prompt sent',
    url: page.url(),
    response
  };
}

export function create(cfg) {
  return {
    name: 'playwright',
    async checkReady() {
      try {
        const readyPage = await ensureReady(cfg);
        const input = await locateInput(readyPage, cfg.inputSelector);
        const checks = {
          strategyLoaded: true,
          browserContextAvailable: Boolean(readyPage && !readyPage.isClosed()),
          loggedIn: !/login|sign|passport/i.test(readyPage.url()),
          inputAvailable: Boolean(input)
        };
        const ready = Object.values(checks).every(Boolean);
        return {
          ready,
          checks,
          reason: ready ? null : 'TRAE Work is not logged in or the prompt input is unavailable.'
        };
      } catch (error) {
        return {
          ready: false,
          checks: {
            strategyLoaded: true,
            browserContextAvailable: false,
            loggedIn: false,
            inputAvailable: false
          },
          reason: error?.message ?? String(error)
        };
      }
    },
    async sendPrompt(text) {
      try {
        const result = await sendPrompt(text, cfg);
        return { success: true, sent: true, ...result };
      } catch (error) {
        // A failed page operation can leave a stale context; force the next
        // readiness/send call through persistent-context initialization again.
        await this.close();
        throw error;
      }
    },
    async close() {
      try {
        if (browser) await browser.close();
      } catch (_) {}
      browser = null;
      context = null;
      page = null;
    }
  };
}
