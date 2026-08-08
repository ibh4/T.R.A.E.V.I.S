// Auto-calibrate the TRAE Agent input and save local coordinates.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function findPython() {
  const localPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(localPython)) return localPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function loadConfig() {
  const configPath = path.join(projectRoot, 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function main() {
  const config = loadConfig();
  const uia = config.uiautomation || {};
  const python = findPython();
  const script = path.join(projectRoot, 'strategies', 'scripts', 'trae_ide_calibrate.py');
  const output = path.join(projectRoot, '.trae-calibration.json');
  const windowKeyword = process.env.TRAE_WINDOW_KEYWORD || uia.windowTitlePattern || 'Trae CN';
  const shortcut = (uia.openChatShortcut || ['ctrl', 'u']).join('+');

  console.log('=== TRAE 自动校准 ===');
  console.log(`目标窗口：${windowKeyword}`);
  console.log('校准期间不会发送消息。');

  const child = spawn(python, [
    script,
    '--window', windowKeyword,
    '--shortcut', shortcut,
    '--focus-wait', String(uia.focusWaitMs ?? 300),
    '--output', output
  ], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    console.error(`无法启动校准脚本：${err.message}`);
    process.exitCode = 1;
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('\n校准完成，后续 quick-test 和 HTTP 服务会自动使用新位置。');
    } else {
      console.error(`\n校准失败，退出码：${code}`);
      process.exitCode = code || 1;
    }
  });
}

main().catch((err) => {
  console.error(`校准失败：${err.message}`);
  process.exit(1);
});
