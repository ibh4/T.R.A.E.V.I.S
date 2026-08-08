# TraePal Player - ESP32 状态显示

ESP32-S3-Touch-AMOLED-1.75C 圆形屏幕上实时显示 TraePal 工作状态表情动画，通过 WiFi 接收状态命令切换显示。

## 硬件

- **开发板**: Waveshare ESP32-S3-Touch-AMOLED-1.75C
- **芯片**: ESP32-S3R8 (240MHz, 8MB PSRAM, 32MB Flash)
- **屏幕**: 1.75" 圆形 AMOLED 466×466, CO5300 驱动, QSPI 接口
- **ESP-IDF**: v5.5.2+

## 功能

- 3 个状态表情动画循环播放 (idle_ready / bug_alert / fix_success)
- WiFi AP 模式 (`TraePal`), 电脑连接后 TCP 推送状态命令
- 底部叠加状态文字条
- raw partition 存储全屏 RGB565 帧, `esp_partition_read` 按偏移读取
- PSRAM 单帧缓冲, 4 行分块刷屏避免 SPI 队列满
- RGB565 字节序转换 (little-endian → big-endian)

## 目录结构

```
traepal_player/
├── main/
│   ├── main.c              # 主程序: 屏幕初始化, 帧加载, 动画播放, 状态切换
│   ├── wifi_tcp.c          # WiFi AP + TCP server (端口 3333)
│   ├── wifi_tcp.h          # WiFi/TCP API 声明
│   └── CMakeLists.txt      # 组件构建配置 + raw bin 自动烧录
├── components/
│   └── esp32_s3_touch_amoled_1_75c/  # Waveshare BSP (CO5300 屏幕驱动)
├── partitions.csv          # 分区表: factory 4MB + frames 11MB raw
├── sdkconfig.defaults      # 32MB Flash + octal PSRAM 80M
├── frames.bin              # 合并的全屏 RGB565 帧 (3 状态 × 8 帧)
├── apkcode_monitor.py      # 电脑端 Apkcode 项目状态监测脚本
├── CMakeLists.txt          # 顶层 CMake
└── README.md               # 本文件
```

## 使用方法

### 1. 编译烧录

```bash
source /Users/pwngwc/projects/ESP32/esp-idf/export.sh
cd traepal_player
idf.py -p /dev/cu.usbmodem21201 flash
```

### 2. 连接 ESP32 WiFi

ESP32 启动后创建 AP:
- **SSID**: `TraePal`
- **密码**: `12345678`
- **IP**: `192.168.4.1`
- **TCP 端口**: `3333`

电脑连接 `TraePal` WiFi 后:

```bash
# macOS
networksetup -setairportnetwork en1 TraePal 12345678
```

### 3. 发送状态命令

#### 方式 A: 手动 TCP

```bash
echo "idle_ready" | nc 192.168.4.1 3333
echo "bug_alert" | nc 192.168.4.1 3333
echo "fix_success" | nc 192.168.4.1 3333
```

#### 方式 B: Apkcode 项目状态监测脚本

```bash
cd traepal_player
python3 apkcode_monitor.py
```

监测脚本功能:
- 源码文件变化 → `idle_ready` (活跃工作中)
- git 新 commit → `fix_success` (8 秒后回 idle)
- build 错误 → `bug_alert` (8 秒后回 idle)
- 手动命令: `bug` / `fix` / `idle` / `demo` / `quit`

## 状态命令协议

TCP 发送文本命令 (大小写不敏感), 支持的关键词:

| 命令 | 匹配关键词 | 显示状态 |
|------|-----------|---------|
| `idle_ready` | `idle` | IDLE READY 表情 |
| `bug_alert` | `bug` | BUG ALERT 表情 |
| `fix_success` | `fix` / `success` | FIX SUCCESS 表情 |

## 帧资源格式

`frames.bin` 布局: `[idle_ready 8帧][bug_alert 8帧][fix_success 8帧]`

- 每帧 434,312 字节 (466×466×2, RGB565)
- 总大小约 10.4 MB
- 烧录到 `frames` 分区 (raw data, subtype=undefined)

### 重新生成 frames.bin

动画源资源在 `Trae_proj-main/output/traepal_sequences_466_aggressive/`, 使用 `prev_bbox` delta patch 格式 (frame_000 是基础全屏帧, 后续帧是裁剪的 bbox 区域)。用 Python 脚本展开为全屏帧后合并:

```python
# 伪代码
for state in ['idle_ready', 'bug_alert', 'fix_success']:
    base = read_frame(state, 0)  # 466×466 全屏
    full_frame = base
    for idx in [0, 3, 6, 9, 12, 15, 18, 21]:  # 采样 8 帧
        if idx > 0:
            patch = read_frame(state, idx)  # bbox 裁剪区域
            apply_delta(full_frame, patch)  # 覆盖到对应 bbox
        frames.bin += full_frame
```

## 关键技术点

- **raw partition 替代 SPIFFS**: 大帧数据 (434KB/帧) 用 `esp_partition_read` 按偏移读取, 比 SPIFFS 更可靠
- **RGB565 字节序**: 资源是 little-endian, SPI 屏幕期望 big-endian, flush 时交换高低字节
- **分块刷屏 + CPU yield**: 每 4 行一块, 每 8 块 `vTaskDelay(1ms)` 让出 CPU 给 WiFi task
- **AP 模式**: 家用路由器 AP 隔离会阻断设备间 TCP, ESP32 AP 模式直连通信最可靠
- **AMOLED 亮度**: 低亮度 (15%) 黑色偏紫 (OLED 漏电流), 推荐 60% 以上
