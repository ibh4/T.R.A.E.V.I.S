// strategies/uiautomationStrategy.js
// 备选策略：通过 child_process 调用 Python pyautogui + pywinauto 操作 TRAE IDE 桌面端
// 适用场景：用户目标必须是 TRAE IDE 桌面端，而非 TRAE Work 网页版
// 工作流：定位 TRAE 窗口 -> 激活置前 -> Ctrl+U 打开侧边对话框 -> 剪贴板粘贴 -> 回车
//
// 依赖：Python 3.x、pyautogui、pywinauto、pyperclip
// 注：本文件仅封装调用入口，实际自动化逻辑在 ./scripts/trae_ide_send.py
// 这是占位实现，使用前需先编写 Python 脚本并安装依赖

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPythonPath() {
  const basePath = path.resolve(__dirname, '..');
  const venvPython = process.platform === 'win32'
    ? path.join(basePath, '.venv', 'Scripts', 'python.exe')
    : path.join(basePath, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getPythonScriptPath() {
  // 脚本约定放在同级 scripts 目录，按需创建
  const candidate = path.join(__dirname, 'scripts', 'trae_ide_send.py');
  return candidate;
}

function loadCalibration() {
  const calibrationPath = path.resolve(__dirname, '..', '.trae-calibration.json');
  try {
    return JSON.parse(fs.readFileSync(calibrationPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function isValidCalibration(value) {
  const ratio = value?.inputClickRatio;
  return value?.version === 1
    && Number.isFinite(ratio?.x)
    && ratio.x > 0
    && ratio.x < 1
    && Number.isFinite(ratio?.y)
    && ratio.y > 0
    && ratio.y < 1;
}

function appendBounded(current, chunk, maximumLength = 16384) {
  if (current.length >= maximumLength) return current;
  return (current + chunk.toString()).slice(0, maximumLength);
}

function readinessProbeCode() {
  return `
import json, re, sys
result = {"dependenciesAvailable": False, "windowAvailable": False, "windowTitle": None}
try:
    import pyautogui
    import pyperclip
    import win32api
    from pywinauto import Desktop
    result["dependenciesAvailable"] = True
    keyword = sys.argv[1]
    windows = Desktop(backend="uia").windows(title_re=f".*{re.escape(keyword)}.*")
    result["windowAvailable"] = len(windows) > 0
    result["windowTitle"] = windows[0].window_text() if windows else None
except Exception as exc:
    result["error"] = str(exc)
print(json.dumps(result, ensure_ascii=False))
`;
}

function runReadinessProbe(python, windowKeyword, timeoutMs, children) {
  return new Promise((resolve) => {
    const child = spawn(python, ['-c', readinessProbeCode(), windowKeyword], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ pythonAvailable: true, dependenciesAvailable: false, windowAvailable: false, error: 'Readiness probe timed out.' });
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      stdout = appendBounded(stdout, data);
    });
    child.stderr.on('data', (data) => {
      stderr = appendBounded(stderr, data);
    });
    child.on('error', (error) => {
      finish({ pythonAvailable: false, dependenciesAvailable: false, windowAvailable: false, error: error.message });
    });
    child.on('close', () => {
      try {
        const result = JSON.parse(stdout.trim());
        finish({ pythonAvailable: true, ...result });
      } catch {
        finish({
          pythonAvailable: true,
          dependenciesAvailable: false,
          windowAvailable: false,
          error: stderr.trim() || 'Readiness probe returned invalid output.'
        });
      }
    });
  });
}

function parseJsonResult(stdout) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .find((item) => item.startsWith('JSON_RESULT:'));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('JSON_RESULT:'.length));
  } catch (_) {
    return null;
  }
}

export function create(cfg) {
  const children = new Set();
  let closed = false;

  return {
    name: 'uiautomation',
    async checkReady() {
      const scriptAvailable = fs.existsSync(getPythonScriptPath());
      const calibration = loadCalibration();
      const calibrated = isValidCalibration(calibration);
      const probe = await runReadinessProbe(
        getPythonPath(),
        cfg.windowTitlePattern || calibration?.windowKeyword || 'Trae CN',
        cfg.readinessTimeoutMs ?? 7000,
        children
      );
      const checks = {
        strategyLoaded: true,
        scriptAvailable,
        pythonAvailable: probe.pythonAvailable === true,
        dependenciesAvailable: probe.dependenciesAvailable === true,
        calibrated,
        windowAvailable: probe.windowAvailable === true
      };
      const ready = Object.values(checks).every(Boolean);
      return {
        ready,
        checks,
        reason: ready ? null : (probe.error || 'UI Automation prerequisites are incomplete.')
      };
    },
    async sendPrompt(text) {
      if (closed) closed = false;
      const scriptPath = getPythonScriptPath();
      if (!fs.existsSync(scriptPath)) {
        throw new Error(
          `UI 自动化脚本不存在: ${scriptPath}\n` +
            `请先在 src/trae-communicate/strategies/scripts/ 创建 trae_ide_send.py，` +
            `并安装 pyautogui、pywinauto、pyperclip。`
        );
      }

      return new Promise((resolve, reject) => {
        const calibration = loadCalibration();
        const inputClickRatio = calibration?.inputClickRatio || {};
        const args = [
          scriptPath,
          '--text', text,
          '--window', cfg.windowTitlePattern || 'Trae',
          '--shortcut', (cfg.openChatShortcut || ['ctrl', 'u']).join('+'),
          '--send-key', cfg.sendKey || 'enter',
          '--focus-wait', String(cfg.focusWaitMs ?? 300),
          '--input-x-ratio', String(inputClickRatio.x ?? 0.82),
          '--input-y-ratio', String(inputClickRatio.y ?? 0.85),
          '--response-timeout', String(cfg.responseTimeoutSec ?? 25),
          '--poll-interval', String(cfg.responsePollIntervalSec ?? 1)
        ];

        const child = spawn(getPythonPath(), args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        children.add(child);
        let stdout = '';
        let stderr = '';
        let settled = false;
        const executionTimeoutMs = cfg.executionTimeoutMs
          ?? Math.max(30000, ((cfg.responseTimeoutSec ?? 25) * 1000) + 5000);
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          children.delete(child);
          callback();
        };
        const timer = setTimeout(() => {
          child.kill();
          const error = new Error(`UI Automation process exceeded ${executionTimeoutMs}ms.`);
          error.code = 'STRATEGY_TIMEOUT';
          finish(() => reject(error));
        }, executionTimeoutMs);
        child.stdout.on('data', (d) => {
          stdout = appendBounded(stdout, d);
        });
        child.stderr.on('data', (d) => {
          stderr = appendBounded(stderr, d);
        });
        child.on('error', (err) => {
          finish(() => reject(new Error(`无法启动 python: ${err.message}`)));
        });
        child.on('close', (code) => {
          finish(() => {
            const parsed = parseJsonResult(stdout);
            if (code === 0 && parsed?.success !== false && parsed?.sent !== false) {
              resolve({
                success: true,
                sent: true,
                message: parsed?.response?.status === 'read'
                  ? 'prompt sent and response read via uiautomation'
                  : 'prompt sent via uiautomation',
                response: parsed?.response ?? { status: 'skipped' },
                windowTitle: parsed?.windowTitle ?? null,
                windowKeyword: parsed?.windowKeyword ?? null
              });
            } else {
              const detail = parsed?.error || stderr.trim() || `python process exited with code ${code}`;
              reject(new Error(detail));
            }
          });
        });
      });
    },
    async close() {
      closed = true;
      for (const child of children) child.kill();
      children.clear();
    }
  };
}
