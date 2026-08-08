# TRAE 速通额度监控工具

用于查询 TRAE 速通权益剩余次数的工具，支持**常驻 HTTP 服务模式**和命令行模式，适合硬件设备集成或自动化任务。

## ✨ 核心特性

- 🔄 **常驻服务模式**：浏览器只启动一次，登录一次，持续提供服务
- ⚡ **毫秒级响应**：5分钟缓存，查询速度极快
- 🔐 **登录状态持久化**：自动保存 Cookie，重启服务也不用重新登录
- 🌐 **HTTP API 接口**：硬件设备直接发 HTTP 请求即可查询
- 🖥️ **支持 Edge 浏览器**：复用系统已登录的 Edge 浏览器
- 📊 **JSON 格式输出**：便于程序解析和集成

## 快速开始

### 方式一：常驻 HTTP 服务（推荐 ⭐⭐⭐⭐⭐）

**启动服务**：

```bash
cd src/trae-credits-monitor

# 使用 Edge 浏览器（推荐，复用系统登录状态）
node src/server.js --headed --edge

# 或使用 Chromium 浏览器
node src/server.js --headed
```

服务启动后访问：http://localhost:3000

**查询额度**：

```bash
# 直接访问 API
curl http://localhost:3000/api/credits

# 或使用 PowerShell
Invoke-RestMethod http://localhost:3000/api/credits
```

**输出**：
```json
{
  "success": true,
  "fastPass": {
    "remaining": 100,
    "rawText": "100 次免排队速通",
    "pageUrl": "https://www.trae.cn/pricing"
  },
  "timestamp": "2026-06-29T14:31:52.508Z",
  "cached": true
}
```

### 方式二：命令行查询

```bash
# 使用 Edge 浏览器（推荐）
node src/edge-check.js

# 或使用 Chromium 浏览器
node src/index.js check
```

## HTTP API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 服务首页，显示接口列表 |
| `/health` | GET | 健康检查，查看服务状态 |
| `/api/credits` | GET | 查询速通额度（5分钟缓存） |
| `/api/credits?force=true` | GET | 强制刷新，忽略缓存重新查询 |
| `/api/login` | POST | 打开 TRAE 登录页面（需扫码时调用） |
| `/api/save-state` | POST | 手动保存当前登录状态 |

### 接口详情

#### 健康检查

```
GET /health
```

响应：
```json
{
  "status": "ready",
  "isLoggedIn": false,
  "lastCheckTime": "2026-06-29T14:31:52.508Z",
  "timestamp": "2026-06-29T14:35:00.000Z"
}
```

#### 查询额度

```
GET /api/credits
```

- **缓存机制**：5分钟内重复调用返回缓存结果（`cached: true`）
- **强制刷新**：添加 `?force=true` 参数跳过缓存

成功响应：
```json
{
  "success": true,
  "fastPass": {
    "remaining": 100,
    "rawText": "100 次免排队速通",
    "pageUrl": "https://www.trae.cn/pricing"
  },
  "timestamp": "2026-06-29T14:31:52.508Z",
  "cached": false
}
```

失败响应：
```json
{
  "success": false,
  "error": "未能解析速通额度信息",
  "code": "PARSE_ERROR"
}
```

#### 触发登录

```
POST /api/login
```

当检测到未登录时，调用此接口在浏览器中打开 TRAE 登录页，用户扫码登录后，再调用 `/api/save-state` 保存登录状态。

#### 保存登录状态

```
POST /api/save-state
```

手动保存当前浏览器的登录状态到本地文件，下次启动服务时自动加载。

## 启动参数

| 参数 | 说明 |
|------|------|
| `--headed` | 有头模式（显示浏览器窗口），首次登录建议使用 |
| `--edge` | 使用 Edge 浏览器（复用系统登录状态） |
| `--port 3000` | 指定服务端口（默认 3000） |

**环境变量**：
- `PORT` - 服务端口，默认 3000

## 硬件集成指南

### Arduino / ESP32 调用示例

```cpp
#include <HTTPClient.h>

int getTraeCredits() {
  HTTPClient http;
  http.begin("http://192.168.1.100:3000/api/credits");
  
  int httpCode = http.GET();
  if (httpCode > 0) {
    String payload = http.getString();
    // 简单 JSON 解析
    int remainingIndex = payload.indexOf("\"remaining\":");
    if (remainingIndex > 0) {
      int start = remainingIndex + 13;
      int end = payload.indexOf(",", start);
      return payload.substring(start, end).toInt();
    }
  }
  return -1;
}
```

### Python 集成

```python
import requests

def get_trae_credits(host='http://localhost:3000', force=False):
    url = f'{host}/api/credits'
    if force:
        url += '?force=true'
    
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
        if data.get('success'):
            return data['fastPass']['remaining']
        else:
            return None
    except Exception as e:
        print(f'查询失败: {e}')
        return None

# 使用
remaining = get_trae_credits('http://192.168.1.100:3000')
if remaining:
    print(f'剩余速通次数: {remaining}')
```

### Node.js 集成

```javascript
const http = require('http');

function getTraeCredits(host = 'localhost', port = 3000, force = false) {
  return new Promise((resolve, reject) => {
    const path = force ? '/api/credits?force=true' : '/api/credits';
    
    http.get({ host, port, path }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 使用
getTraeCredits().then(credits => {
  if (credits.success) {
    console.log(`剩余 ${credits.fastPass.remaining} 次`);
  }
});
```

### Shell / curl

```bash
# 查询额度
curl http://localhost:3000/api/credits

# 强制刷新
curl "http://localhost:3000/api/credits?force=true"

# 健康检查
curl http://localhost:3000/health
```

## 部署指南

### Windows 后台运行

使用 `nssm` 或 Windows 任务计划程序将服务设为开机自启：

```batch
:: 使用 nssm 注册服务
nssm install TraeCreditsMonitor "node" "src\server.js --edge"
nssm set TraeCreditsMonitor AppDirectory "D:\path\to\trae-credits-monitor"
nssm start TraeCreditsMonitor
```

### Linux 后台运行

```bash
# 使用 PM2
npm install -g pm2
pm2 start src/server.js --name trae-credits -- --edge
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:18-slim
RUN apt-get update && apt-get install -y chromium
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

## 错误码

| 代码 | 说明 | 处理方式 |
|------|------|----------|
| `NOT_READY` | 服务未就绪 | 等待服务启动完成后重试 |
| `NOT_LOGGED_IN` | 未登录 | 调用 `/api/login` 打开登录页扫码 |
| `TIMEOUT` | 页面加载超时 | 检查网络，或调用 `?force=true` 重试 |
| `PARSE_ERROR` | 解析失败 | 可能 TRAE 页面结构变化，需要更新代码 |
| `UNKNOWN_ERROR` | 未知错误 | 查看服务日志排查 |

## 目录结构

```
trae-credits-monitor/
├── src/
│   ├── server.js         # ⭐ 常驻 HTTP 服务（推荐）
│   ├── edge-check.js     # Edge 命令行版本
│   ├── index.js          # Chromium 命令行版本
│   ├── traeClient.js     # TRAE 客户端核心
│   └── config.js         # 配置管理
├── examples/             # 集成示例
│   ├── get_credits_simple.js  # Node.js 命令行示例
│   └── get_credits.py        # Python 命令行示例
├── data/                 # 运行时数据
│   ├── server-storage-state.json  # 服务端登录状态
│   └── config.json         # 用户配置
├── .browsers/            # Chromium 浏览器
├── package.json
└── README.md
```

## 常见问题

### Q: 每次重启服务都要重新登录吗？
**A:** 不用。服务会自动保存登录状态到 `data/server-storage-state.json`，下次启动时自动加载。

### Q: Edge 浏览器模式和 Chromium 模式有什么区别？
- **Edge 模式**（`--edge`）：复用系统 Edge 浏览器的登录状态，适合本地使用
- **Chromium 模式**：独立浏览器，登录状态独立保存，适合服务器部署

### Q: 查询速度有多快？
- 缓存命中：**10ms 以内**
- 强制刷新：**2-5 秒**（取决于网络和页面加载速度）

### Q: 如何修改缓存时间？
修改 `src/server.js` 中的 `5 * 60 * 1000`（5分钟）为你想要的值。

### Q: 服务会自动刷新登录状态吗？
目前需要手动调用 `/api/save-state` 保存。建议定期（如每天）保存一次。

## 注意事项

1. **登录状态有效期**：Cookie 有有效期，过期后需要重新登录
2. **网络要求**：需要能正常访问 `trae.cn`
3. **页面变化**：如果 TRAE 网站结构变化，可能需要更新解析逻辑
4. **资源占用**：常驻服务会占用约 100-200MB 内存（浏览器进程）

## 技术栈

- Node.js
- Playwright（浏览器自动化）
- 原生 HTTP 模块（零依赖 Web 服务）

## 免责声明

本工具仅供个人学习和使用，请遵守 TRAE 的服务条款。

