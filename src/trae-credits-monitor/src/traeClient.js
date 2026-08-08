const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { loadConfig, getStorageStatePath, hasStorageState, ensureDataDir, BROWSERS_DIR } = require('./config');

function findChromeExecutable() {
  const candidates = [
    path.join(BROWSERS_DIR, 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    path.join(BROWSERS_DIR, 'chrome-win', 'chrome.exe'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

class TraeClient {
  constructor(options = {}) {
    this.config = { ...loadConfig(), ...options };
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    ensureDataDir();
    const executablePath = findChromeExecutable();
    
    const launchOptions = {
      headless: this.config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    this.browser = await chromium.launch(launchOptions);

    const contextOptions = {
      viewport: this.config.viewport,
      ignoreHTTPSErrors: true
    };

    if (hasStorageState()) {
      contextOptions.storageState = getStorageStatePath();
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);
  }

  async close() {
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  async saveStorageState() {
    if (this.context) {
      await this.context.storageState({ path: getStorageStatePath() });
    }
  }

  async isLoggedIn() {
    try {
      await this.page.goto(this.config.baseUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      const loginBtn = await this.page.$('a[class*="loginBtn"], a[href*="login"]');
      return loginBtn === null;
    } catch (e) {
      return false;
    }
  }

  async login(headless = false) {
    console.log('正在打开 TRAE 登录页面...');
    const loginUrl = `${this.config.baseUrl}/login`;
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(2000);

    console.log('\n请使用手机扫描页面上的二维码进行登录');
    console.log('登录成功后，程序将自动继续...\n');

    try {
      await this.page.waitForFunction(() => {
        const loginBtn = document.querySelector('a[class*="loginBtn"], a[href*="login"]');
        return !loginBtn || window.location.pathname !== '/login';
      }, { timeout: 120000 });

      await this.page.waitForTimeout(2000);
      console.log('登录成功！');
      await this.saveStorageState();
      console.log('登录状态已保存');
      return true;
    } catch (e) {
      console.error('登录超时或失败');
      return false;
    }
  }

  async ensureLoggedIn() {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) {
      console.log('未检测到登录状态，请先登录');
      return await this.login();
    }
    console.log('已登录');
    return true;
  }

  async navigateToUsage() {
    console.log('正在导航到用量管理页面...');

    const candidateUrls = [
      `${this.config.baseUrl}/settings/usage`,
      `${this.config.baseUrl}/settings/subscription`,
      `${this.config.baseUrl}/account/usage`,
      `${this.config.baseUrl}/user/usage`,
    ];

    for (const url of candidateUrls) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(2000);
        const text = await this.page.innerText('body');
        if (text.includes('速通') || text.includes('用量') || text.includes('订阅')) {
          console.log(`成功进入页面: ${url}`);
          return true;
        }
      } catch (e) {
        continue;
      }
    }

    console.warn('未找到明确的用量页面，停留在最后尝试的页面');
    return true;
  }

  async getFastPassCredits() {
    console.log('正在获取速通额度信息...');
    
    const fastPassPatterns = [
      /速通.*?(\d+).*?次/,
      /剩余.*?(\d+).*?次/,
      /可用.*?(\d+).*?次/,
      /(\d+).*?次.*?速通/,
      /速通次数[^\d]*(\d+)/,
      /剩余次数[^\d]*(\d+)/
    ];

    const textSelectors = [
      '[class*="fast-pass"]',
      '[class*="fastpass"]',
      '[class*="credit"]',
      '[class*="quota"]',
      '[class*="usage"]',
      '[class*="subscription"]',
      'body'
    ];

    let pageText = '';
    for (const selector of textSelectors) {
      try {
        const el = await this.page.$(selector);
        if (el) {
          const text = await el.innerText();
          if (text && text.includes('速通')) {
            pageText = text;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!pageText) {
      pageText = await this.page.innerText('body');
    }

    for (const pattern of fastPassPatterns) {
      const match = pageText.match(pattern);
      if (match && match[1]) {
        const remaining = parseInt(match[1], 10);
        if (!isNaN(remaining)) {
          return {
            remaining,
            rawText: match[0],
            pageUrl: this.page.url()
          };
        }
      }
    }

    return {
      remaining: null,
      rawText: null,
      pageUrl: this.page.url(),
      note: '未能解析到速通次数，请检查页面是否正确加载'
    };
  }

  async getUsageDetails() {
    const result = {
      fastPass: null,
      timestamp: new Date().toISOString(),
      pageUrl: this.page.url()
    };

    const fastPassInfo = await this.getFastPassCredits();
    result.fastPass = fastPassInfo;

    return result;
  }

  async checkCredits() {
    await this.ensureLoggedIn();
    await this.navigateToUsage();
    return await this.getUsageDetails();
  }

  async takeScreenshot(savePath) {
    if (this.page) {
      await this.page.screenshot({ path: savePath, fullPage: true });
      console.log(`截图已保存到: ${savePath}`);
    }
  }
}

module.exports = TraeClient;
