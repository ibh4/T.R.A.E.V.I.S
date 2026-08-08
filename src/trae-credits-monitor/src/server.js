const http = require('http');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_STATE_PATH = path.join(DATA_DIR, 'server-storage-state.json');

class TraeCreditsServer {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
    this.isLoggedIn = false;
    this.lastCheckResult = null;
    this.lastCheckTime = null;
  }

  async init(headed = false, useEdge = false) {
    console.log('🚀 正在启动 TRAE 速通额度监控服务...');

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let browserConfig = {
      headless: !headed,
      args: ['--no-sandbox']
    };

    if (useEdge) {
      const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
      const edgeUserDataDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
      
      if (fs.existsSync(edgePath)) {
        console.log('📂 使用 Edge 浏览器');
        this.context = await chromium.launchPersistentContext(
          path.join(edgeUserDataDir, 'Default'),
          {
            headless: !headed,
            executablePath: edgePath,
            args: ['--no-sandbox']
          }
        );
        this.browser = this.context.browser();
        this.isReady = true;
        this.page = this.context.pages()[0] || await this.context.newPage();
        return;
      }
    }

    const browserPath = path.join(__dirname, '..', '.browsers', 'chromium-1228', 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(browserPath)) {
      browserConfig.executablePath = browserPath;
    }

    const storageStateExists = fs.existsSync(STORAGE_STATE_PATH);

    this.browser = await chromium.launch(browserConfig);
    
    const contextOptions = { viewport: { width: 1280, height: 720 } };
    if (storageStateExists) {
      contextOptions.storageState = STORAGE_STATE_PATH;
    }
    
    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.isReady = true;

    if (storageStateExists) {
      console.log('✅ 已加载登录状态');
      this.isLoggedIn = true;
    }

    console.log('✅ 浏览器启动成功');
  }

  async checkLoginStatus() {
    if (!this.isReady) return false;

    try {
      await this.page.goto('https://www.trae.cn/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.page.waitForTimeout(2000);

      const bodyText = await this.page.innerText('body');
      const hasLoginButton = bodyText.includes('登录') && bodyText.includes('扫码');
      
      if (hasLoginButton) {
        this.isLoggedIn = false;
        return false;
      } else {
        this.isLoggedIn = true;
        return true;
      }
    } catch (e) {
      console.error('检查登录状态失败:', e.message);
      return false;
    }
  }

  async getCredits() {
    if (!this.isReady) {
      return { success: false, error: '服务未就绪', code: 'NOT_READY' };
    }

    try {
      const urls = [
        'https://www.trae.cn/settings/usage',
        'https://www.trae.cn/settings/subscription',
        'https://www.trae.cn/pricing'
      ];

      let found = null;

      for (const targetUrl of urls) {
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await this.page.waitForTimeout(2000);

        const bodyText = await this.page.innerText('body');

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
              found = {
                success: true,
                fastPass: {
                  remaining: remaining,
                  rawText: match[0],
                  pageUrl: targetUrl
                },
                timestamp: new Date().toISOString()
              };
              break;
            }
          }
        }

        if (found) break;
      }

      if (found) {
        this.lastCheckResult = found;
        this.lastCheckTime = Date.now();
        return found;
      }

      return {
        success: false,
        error: '未能解析速通额度信息',
        code: 'PARSE_ERROR'
      };

    } catch (e) {
      return {
        success: false,
        error: e.message,
        code: 'UNKNOWN_ERROR'
      };
    }
  }

  async saveStorageState() {
    if (this.context) {
      const state = await this.context.storageState();
      fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state, null, 2));
      console.log('✅ 登录状态已保存');
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this.isReady = false;
  }
}

const server = new TraeCreditsServer();

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, {
      status: server.isReady ? 'ready' : 'starting',
      isLoggedIn: server.isLoggedIn,
      lastCheckTime: server.lastCheckTime ? new Date(server.lastCheckTime).toISOString() : null,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/credits') {
    if (!server.isReady) {
      sendJson(res, { success: false, error: '服务未就绪', code: 'NOT_READY' }, 503);
      return;
    }

    const forceRefresh = parsedUrl.query.force === 'true';
    
    if (!forceRefresh && server.lastCheckResult && 
        Date.now() - server.lastCheckTime < 5 * 60 * 1000) {
      sendJson(res, { ...server.lastCheckResult, cached: true });
      return;
    }

    const result = await server.getCredits();
    sendJson(res, result, result.success ? 200 : 500);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    if (!server.isReady) {
      sendJson(res, { success: false, error: '服务未就绪', code: 'NOT_READY' }, 503);
      return;
    }

    try {
      await server.page.goto('https://www.trae.cn/', { waitUntil: 'domcontentloaded' });
      sendJson(res, {
        success: true,
        message: '请在浏览器中扫码登录',
        loginUrl: 'https://www.trae.cn/'
      });
    } catch (e) {
      sendJson(res, { success: false, error: e.message, code: 'LOGIN_ERROR' }, 500);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-state') {
    if (!server.isReady) {
      sendJson(res, { success: false, error: '服务未就绪', code: 'NOT_READY' }, 503);
      return;
    }

    await server.saveStorageState();
    sendJson(res, { success: true, message: '登录状态已保存' });
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>TRAE 速通额度监控</title>
        <style>
          body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
          h1 { color: #333; }
          .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
          .ready { background: #d4edda; color: #155724; }
          .not-ready { background: #f8d7da; color: #721c24; }
          code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>TRAE 速通额度监控服务</h1>
        <div class="status ${server.isReady ? 'ready' : 'not-ready'}">
          服务状态: ${server.isReady ? '已就绪' : '启动中...'}
        </div>
        <h3>API 接口</h3>
        <ul>
          <li><code>GET /health</code> - 健康检查</li>
          <li><code>GET /api/credits</code> - 查询速通额度（5分钟缓存）</li>
          <li><code>GET /api/credits?force=true</code> - 强制刷新查询</li>
          <li><code>POST /api/login</code> - 打开登录页面</li>
          <li><code>POST /api/save-state</code> - 保存登录状态</li>
        </ul>
      </body>
      </html>
    `);
    return;
  }

  sendJson(res, { success: false, error: '接口不存在', code: 'NOT_FOUND' }, 404);
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed');
  const useEdge = args.includes('--edge');
  const port = parseInt(process.env.PORT || '3000', 10);

  await server.init(headed, useEdge);

  const httpServer = http.createServer(handleRequest);

  httpServer.listen(port, () => {
    console.log(`\n🎉 TRAE 速通额度监控服务已启动！`);
    console.log(`   地址: http://localhost:${port}`);
    console.log(`   健康检查: http://localhost:${port}/health`);
    console.log(`   查询额度: http://localhost:${port}/api/credits`);
    console.log(`\n   按 Ctrl+C 停止服务\n`);
  });

  process.on('SIGINT', async () => {
    console.log('\n正在关闭服务...');
    await server.saveStorageState();
    await server.close();
    httpServer.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
