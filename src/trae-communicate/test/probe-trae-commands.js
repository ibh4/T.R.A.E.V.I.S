// test/probe-trae-commands.js
// 探针脚本：如果目标是 TRAE IDE 桌面端，可先用此脚本指引人工排查
// TRAE 注册的可编程命令（Ctrl+Shift+P），用以判断"自定义 VS Code 扩展"方案是否可行
//
// 使用方法：
//   1. 打开 TRAE IDE
//   2. 按 Ctrl+Shift+P 打开命令面板
//   3. 输入 "trae" "chat" "send" "prompt" 关键字
//   4. 把命令列表贴回这里人工评估
//
// 本脚本不会自动操作 IDE，只输出检查清单和提示

console.log('=== TRAE IDE 命令探针 ===\n');
console.log('请在 TRAE IDE 中按以下步骤人工排查：\n');
console.log('1. 按 Ctrl+Shift+P 打开命令面板');
console.log('2. 依次输入以下关键字，记录出现的命令 ID：');
console.log('   - trae');
console.log('   - chat');
console.log('   - send');
console.log('   - prompt');
console.log('   - message');
console.log('\n3. 重点关注形如下列命名的命令（如果存在，可走 VS Code 扩展方案）：');
console.log('   - trae.chat.sendMessage');
console.log('   - trae.chat.open');
console.log('   - trevis.sendPrompt');
console.log('   - tarevis.chat.submit');
console.log('\n4. 按住 Ctrl+Shift+I 打开 DevTools，在 Console 里执行：');
console.log('   await vscode.commands.getCommands(true)');
console.log('   过滤出包含 "trae"/"chat"/"send" 的命令');
console.log('\n5. 把发现的命令记录到 config.json 或反馈给开发，决定是否启用扩展方案');
console.log('\n=== 探针说明结束 ===\n');
