const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function checkWithEdge() {
  console.log('🚀 使用 Edge 浏览器查询速通额度...');

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edgeUserDataDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
  const profileDir = path.join(edgeUserDataDir, 'Default');

  if (!fs.existsSync(edgePath)) {
    console.error('❌ 未找到 Edge 浏览器');
    return;
  }

  if (!fs.existsSync(profileDir)) {
    console.error('❌ 未找到 Edge 用户数据目录');
    return;
  }

  console.log('📂 Edge 可执行文件:', edgePath);
  console.log('📂 Edge 用户数据:', profileDir);
  console.log('');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: edgePath,
    args: ['--no-sandbox']
  });

  console.log('✅ Edge 浏览器启动成功！');

  const page = context.pages()[0] || await context.newPage();

  console.log('🌐 正在访问 TRAE...');
  await page.goto('https://www.trae.cn/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const pageUrl = page.url();
  console.log(`📍 当前页面: ${pageUrl}\n`);

  if (pageUrl.includes('/login')) {
    console.log('⚠️  未登录，需要先登录');
    console.log('请在打开的浏览器中登录 TRAE，然后按 Enter 继续...');
    await new Promise(resolve => {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
  }

  const urls = [
    'https://www.trae.cn/settings/usage',
    'https://www.trae.cn/settings/subscription',
    'https://www.trae.cn/user/usage',
    'https://www.trae.cn/pricing',
    'https://www.trae.cn/work'
  ];

  let found = false;

  for (const url of urls) {
    console.log(`\n🔍 尝试访问: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const bodyText = await page.innerText('body');

    if (bodyText.includes('速通') && /(\d+).*次/.test(bodyText)) {
      console.log('✅ 找到速通额度信息！');

      const patterns = [
        /速通.*?(\d+).*?次/,
        /剩余.*?(\d+).*?次/,
        /可用.*?(\d+).*?次/,
        /(\d+).*?次.*?速通/
      ];

      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const remaining = parseInt(match[1], 10);
          if (!isNaN(remaining)) {
            const result = {
              success: true,
              fastPass: {
                remaining: remaining,
                rawText: match[0],
                pageUrl: url
              },
              timestamp: new Date().toISOString()
            };
            
            // 输出 JSON 格式（便于程序解析）
            console.log(JSON.stringify(result, null, 2));
            found = true;
            break;
          }
        }
      }

      if (found) break;
    }
  }

  if (!found) {
    console.log('\n⚠️  未能获取速通额度信息');
    console.log('页面内容预览（前3000字符）：');
    console.log('─'.repeat(50));
    const bodyText = await page.innerText('body');
    console.log(bodyText.slice(0, 3000));
    console.log('─'.repeat(50));

    const screenshotPath = path.join(__dirname, '..', 'data', 'edge-debug-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\n📸 截图已保存: ${screenshotPath}`);
  }

  await context.close();
  console.log('✅ 完成！');
}

checkWithEdge().catch(err => {
  console.error('❌ 发生错误:', err.message);
  process.exit(1);
});
