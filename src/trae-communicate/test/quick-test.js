// test/quick-test.js
// 极简测试脚本：无需启动 HTTP server，直接调用 Python UI 自动化脚本。
// 用法：node test/quick-test.js [1|2|3|自定义文本]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const PROMPTS = {
  '1': { label: '继续下一步', text: '继续推进当前任务的下一步。' },
  '2': { label: '新开发推荐', text: '基于当前项目状态，推荐一个新的功能开发方向。' },
  '3': { label: '工作汇报', text: '请汇总当前项目进度、已完成任务和待办事项。' }
};

function findPython() {
  const localPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');

  if (fs.existsSync(localPython)) {
    return localPython;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function loadCalibration() {
  const calibrationPath = path.join(projectRoot, '.trae-calibration.json');
  try {
    return JSON.parse(fs.readFileSync(calibrationPath, 'utf-8'));
  } catch {
    return null;
  }
}

function printHelp() {
  console.log('=== TRAE IDE 提示词快速测试 ===\n');
  console.log('用法：');
  console.log('  node test/quick-test.js 1        -> 发送“继续下一步”');
  console.log('  node test/quick-test.js 2        -> 发送“新开发推荐”');
  console.log('  node test/quick-test.js 3        -> 发送“工作汇报”');
  console.log('  node test/quick-test.js 你好     -> 发送自定义内容“你好”\n');
  console.log('按钮映射：');
  Object.entries(PROMPTS).forEach(([key, value]) => {
    console.log(`  ${key} -> ${value.label}`);
  });
  console.log('\n前置条件：');
  console.log('  1. TRAE IDE 已启动');
  console.log('  2. Python 已安装');
  console.log('  3. 已安装 pyautogui pywinauto pyperclip');
  console.log('  4. 调整窗口或面板布局后运行 npm run calibrate');
}

async function run(text) {
  const scriptPath = path.join(projectRoot, 'strategies', 'scripts', 'trae_ide_send.py');
  const pythonBin = findPython();
  const windowKeyword = process.env.TRAE_WINDOW_KEYWORD || 'Trae CN';
  const calibration = loadCalibration();
  const inputClickRatio = calibration?.inputClickRatio || {};

  console.log('\n正在发送到 TRAE IDE...');
  console.log(`Python: ${pythonBin}`);
  console.log(`目标窗口：${windowKeyword}`);
  console.log(`输入位置：x=${inputClickRatio.x ?? 0.82}, y=${inputClickRatio.y ?? 0.85}`);
  console.log(`提示词：${text}\n`);

  return new Promise((resolve) => {
    const child = spawn(pythonBin, [
      scriptPath,
      '--text', text,
      '--window', windowKeyword,
      '--input-x-ratio', String(inputClickRatio.x ?? 0.82),
      '--input-y-ratio', String(inputClickRatio.y ?? 0.85),
      '--response-timeout', process.env.TRAE_RESPONSE_TIMEOUT || '25'
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', (err) => {
      stderr += err.message;
      resolve({ code: 1, stdout, stderr });
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parsePythonResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .find((item) => item.startsWith('JSON_RESULT:'));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('JSON_RESULT:'.length));
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    return;
  }

  const input = args.join(' ');
  const text = PROMPTS[input]?.text ?? input;

  const result = await run(text);
  const detail = parsePythonResult(result.stdout);
  console.log('\n=== 执行结果 ===');
  console.log('退出码:', result.code === 0 ? 'SUCCESS' : `FAILED (${result.code})`);
  if (detail?.response?.status === 'read') {
    console.log('\n=== TRAE 返回结果 ===');
    console.log(detail.response.text);
  } else if (detail?.response?.status === 'unavailable') {
    console.log('\n=== TRAE 返回结果 ===');
    console.log('未读到可访问文本。');
    console.log(`原因：${detail.response.reason}`);
    if (detail.response.evidencePath) {
      console.log(`截图证据：${detail.response.evidencePath}`);
    }
  }
  if (result.stderr) {
    console.log('错误输出:', result.stderr.trim());
  }
}

main().catch((err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
