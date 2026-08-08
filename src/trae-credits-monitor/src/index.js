#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const TraeClient = require('./traeClient');
const { DATA_DIR, ensureDataDir, hasStorageState } = require('./config');

function printHelp() {
  console.log(`
TRAE 速通额度监控工具

用法:
  trae-credits <command> [options]

命令:
  check        检查速通剩余额度（默认命令）
  login        登录 TRAE 账号（保存登录状态）
  logout       清除登录状态
  status       查看当前登录状态
  screenshot   截图当前页面（用于调试）
  help         显示帮助信息

选项:
  --headless   无头模式运行（默认）
  --headed     有头模式运行（显示浏览器窗口）
  --json       以 JSON 格式输出结果
  --debug      调试模式，输出更多信息

示例:
  trae-credits check              # 检查速通额度
  trae-credits login --headed     # 有头模式登录
  trae-credits check --json       # JSON 格式输出
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    command: 'check',
    headless: true,
    json: false,
    debug: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case 'check':
      case 'login':
      case 'logout':
      case 'status':
      case 'screenshot':
      case 'help':
        result.command = arg;
        break;
      case '--headless':
        result.headless = true;
        break;
      case '--headed':
        result.headless = false;
        break;
      case '--json':
        result.json = true;
        break;
      case '--debug':
        result.debug = true;
        break;
      case '-h':
      case '--help':
        result.command = 'help';
        break;
      default:
        break;
    }
  }

  return result;
}

function formatResult(result) {
  const lines = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('           TRAE 速通额度查询结果');
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  if (result.fastPass && result.fastPass.remaining !== null) {
    lines.push(`  ⚡  剩余速通次数: ${result.fastPass.remaining} 次`);
    lines.push('');
    lines.push(`  📅 查询时间: ${new Date(result.timestamp).toLocaleString('zh-CN')}`);
    if (result.fastPass.rawText) {
      lines.push(`  📝 原始文本: ${result.fastPass.rawText}`);
    }
  } else {
    lines.push('  ⚠️  未能获取速通额度信息');
    lines.push('');
    if (result.fastPass && result.fastPass.note) {
      lines.push(`  ℹ️  ${result.fastPass.note}`);
      lines.push('');
    }
    lines.push('  💡 可能的原因:');
    lines.push('     - 页面结构发生变化');
    lines.push('     - 未购买速通权益');
    lines.push('     - 登录状态已过期');
    lines.push('');
    lines.push(`  🔗 当前页面: ${result.pageUrl}`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

async function cmdLogin(options) {
  console.log('🚀 开始登录 TRAE...');
  console.log('');

  const client = new TraeClient({ headless: options.headless });
  try {
    await client.init();
    const success = await client.login();
    if (success) {
      console.log('\n✅ 登录成功！你现在可以使用 check 命令查询速通额度了。');
    } else {
      console.log('\n❌ 登录失败');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ 登录出错:', error.message);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function cmdCheck(options) {
  if (!hasStorageState()) {
    console.log('⚠️  未检测到登录状态，请先运行 login 命令登录');
    console.log('   命令: trae-credits login --headed');
    process.exit(1);
  }

  if (!options.json) {
    console.log('🔍 正在查询速通额度...');
  }

  const client = new TraeClient({ headless: options.headless });
  try {
    await client.init();
    const result = await client.checkCredits();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result));
    }

    if (result.fastPass && result.fastPass.remaining === null && !options.json) {
      const screenshotPath = path.join(DATA_DIR, 'debug-screenshot.png');
      await client.takeScreenshot(screenshotPath);
      console.log(`  📸 已保存调试截图: ${screenshotPath}`);
      console.log('');
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: error.message }, null, 2));
    } else {
      console.error('\n❌ 查询出错:', error.message);
      if (options.debug) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function cmdLogout() {
  const { STORAGE_STATE_PATH } = require('./config');
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    fs.unlinkSync(STORAGE_STATE_PATH);
    console.log('✅ 已清除登录状态');
  } else {
    console.log('ℹ️  未找到登录状态');
  }
}

async function cmdStatus() {
  if (hasStorageState()) {
    console.log('✅ 已登录（存在本地登录状态）');
    console.log('   如需验证，请运行: trae-credits check');
  } else {
    console.log('❌ 未登录');
    console.log('   请运行: trae-credits login --headed');
  }
}

async function cmdScreenshot(options) {
  if (!hasStorageState()) {
    console.log('⚠️  未检测到登录状态，请先登录');
    process.exit(1);
  }

  const client = new TraeClient({ headless: options.headless });
  try {
    await client.init();
    await client.ensureLoggedIn();
    await client.navigateToUsage();
    
    const screenshotPath = path.join(DATA_DIR, `screenshot-${Date.now()}.png`);
    await client.takeScreenshot(screenshotPath);
  } catch (error) {
    console.error('❌ 截图失败:', error.message);
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function main() {
  ensureDataDir();
  const options = parseArgs();

  switch (options.command) {
    case 'help':
      printHelp();
      break;
    case 'login':
      await cmdLogin(options);
      break;
    case 'check':
      await cmdCheck(options);
      break;
    case 'logout':
      await cmdLogout();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'screenshot':
      await cmdScreenshot(options);
      break;
    default:
      printHelp();
      break;
  }
}

main().catch(console.error);
