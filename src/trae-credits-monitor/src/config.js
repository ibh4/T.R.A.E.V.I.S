const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const BROWSERS_DIR = path.join(PROJECT_ROOT, '.browsers');
const STORAGE_STATE_PATH = path.join(DATA_DIR, 'storage-state.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
}

const DEFAULT_CONFIG = {
  baseUrl: 'https://www.trae.cn',
  headless: true,
  timeout: 30000,
  viewport: { width: 1280, height: 720 },
  useEdge: false
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureDataDir();
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch (e) {
      console.warn('配置文件解析失败，使用默认配置');
    }
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function hasStorageState() {
  return fs.existsSync(STORAGE_STATE_PATH);
}

function getStorageStatePath() {
  ensureDataDir();
  return STORAGE_STATE_PATH;
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  BROWSERS_DIR,
  STORAGE_STATE_PATH,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  hasStorageState,
  getStorageStatePath,
  ensureDataDir
};
