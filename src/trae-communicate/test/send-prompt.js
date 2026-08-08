// test/send-prompt.js
// 快捷测试工具：不经过 HTTP server，直接调用策略发送提示词
// 用法：node test/send-prompt.js <buttonId>  或  node test/send-prompt.js --text "自定义内容"
// 示例：
//   node test/send-prompt.js 1      → 发送"继续下一步"
//   node test/send-prompt.js 2      → 发送"新开发推荐"
//   node test/send-prompt.js 3      → 发送"工作汇报"
//   node test/send-prompt.js --text "你好"  → 发送自定义内容

import { sendByButtonId, sendRawText, loadConfig } from '../traeSender.js';

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args.length === 0) {
    console.log('=== TRAE 提示词快捷测试工具 ===\n');
    console.log('用法：');
    console.log('  node test/send-prompt.js <buttonId>');
    console.log('  node test/send-prompt.js --text "自定义内容"\n');
    console.log('按钮映射：');
    Object.entries(config.prompts || {}).forEach(([key, val]) => {
      console.log(`  ${key} -> ${val.label} : ${val.text}`);
    });
    console.log('\n注意：确保 TRAE IDE 已启动，且已安装 Python 依赖');
    console.log('依赖安装：pip install pyautogui pywinauto pyperclip');
    process.exit(0);
  }

  const firstArg = args[0];
  let result;

  if (firstArg === '--text') {
    const text = args.slice(1).join(' ');
    console.log(`发送自定义提示词: ${text}`);
    result = await sendRawText(text);
  } else {
    const buttonId = firstArg;
    const prompt = config.prompts?.[buttonId];
    if (prompt) {
      console.log(`发送按钮 ${buttonId}: ${prompt.label}`);
      console.log(`提示词: ${prompt.text}`);
    }
    result = await sendByButtonId(buttonId);
  }

  console.log('\n结果:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('错误:', err.message);
  process.exit(1);
});
