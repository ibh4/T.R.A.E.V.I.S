# 0630 演示版圆屏 UI - 10 状态全动态

## 概述

ESP32-S3-Touch-AMOLED-1.75C 圆屏设备的离线演示版 UI，对齐网页原型 `art_prototype/traepal_round_badge.html` 的圆屏设计。

- 完全离线，无 WiFi / BLE
- 10 个状态全动态动画（12 帧/状态）
- Connect → Ready → Menu → 6 子页面 流程
- 上滑返回上一级，长按回 Ready

## 硬件

- 板子: Waveshare ESP32-S3-Touch-AMOLED-1.75C
- 屏幕: 1.75" 圆形 AMOLED 466×466, QSPI
- 触摸: CST9217 I2C
- Flash: 32MB, PSRAM: 8MB

## 文件结构

```
0630_demo_round_ui_10states_anim/
├── CMakeLists.txt          # 顶层项目配置
├── partitions.csv          # 分区表 (factory 4M + states 14M + font 1M)
├── sdkconfig.defaults      # ESP-IDF 配置
├── gen_font_atlas.py       # 中文字库生成脚本 (32×32, 164 字)
├── gen_demo_resources.py   # 10 状态动画生成脚本 (240×240, 12 帧/状态)
├── font_chars.txt          # 字符表 (字库顺序参考)
├── README.md               # 本文档
└── main/
    ├── CMakeLists.txt      # main 组件构建配置
    └── main.c              # 主程序 (9 页面 + 触摸 + 动画)
```

## 页面流程

```
Connect (1.5s 自动) → Ready (idle_ready 动画循环 + "上滑进入菜单")
  → 上滑 → Menu (6 圆形径向菜单)
    → 状态 (Status): 左右滑动切换 10 状态, 默认循环播放 12 帧动画
    → 蜘蛛 (Spider): spider_bot 12 帧循环 (50fps 加速)
    → 告警 (Alert): bug_alert ↔ fix_success 自动切换 (每 2.4s)
    → 能量 (Energy): task_charge/thinking_scan/thinking_focus 轮播
    → 设置 (Settings): 假数据展示
    → 关于 (About): 项目信息
  长按 (800ms) → Ready (保险返回)
  上滑: 子页面→Menu, Menu→Ready
```

## 10 个状态

| # | 状态名 | 中文名 | 说明 |
|---|---|---|---|
| 0 | idle_ready | 待机 | Ready 页默认动画 |
| 1 | thinking_scan | 扫描 | Energy 页轮播 |
| 2 | thinking_focus | 聚焦 | Energy 页轮播 |
| 3 | bug_alert | 告警 | Alert 页 |
| 4 | fix_success | 修复 | Alert 页 |
| 5 | sync_ping | 脉冲 | Status 页可切换 |
| 6 | task_charge | 任务 | Energy 页轮播 |
| 7 | spider_bot | 蜘蛛 | Spider 页 |
| 8 | sleepy_nudge | 休眠 | Status 页可切换 |
| 9 | bug_maze | 迷宫 | Status 页可切换 |

## 资源格式

### 字库 (font_atlas.bin)
- 164 个中文字, 每字 32×32 alpha mask = 1024 bytes
- 总大小: 164 KB
- 偏移: index × 1024
- 字体: Hiragino Sans GB (苹果系统自带)

### 状态动画 (states_anim.bin)
- 60B 头: 10 状态 × 6B (offset:4B + frame_count:2B)
- 10 状态 × 12 帧 × 240×240 RGB565 = 13.5 MB
- 每帧 115200 bytes (240×240×2)
- ESP32 端近邻采样放大 240→466

## 编译与烧录

### 1. 生成资源（首次必做）

```bash
# 生成字库
python3 gen_font_atlas.py

# 生成 10 状态动画 (依赖 output/traepal_sequences/<state>/frames/*.png)
python3 gen_demo_resources.py
```

生成产物:
- `font_atlas.bin` (164 KB)
- `states_anim.bin` (13.5 MB)

### 2. 编译

```bash
idf.py build
```

### 3. 烧录

```bash
idf.py -p /dev/cu.usbmodem21101 flash
```

烧录会自动写入:
- bootloader.bin @ 0x0
- partition-table.bin @ 0x8000
- traepal_player.bin @ 0x10000 (app, ~290KB)
- states_anim.bin @ 0x410000 (10 状态动画, 13.5MB)
- font_atlas.bin @ 0x1210000 (字库, 164KB)

## 分区表

```
nvs,      data, nvs,       0x9000,  0x6000,
phy_init, data, phy,       0xf000,  0x1000,
factory,  app,  factory,   ,        4M,
states,   data, undefined, ,        14M,
font,     data, undefined, ,        1M,
```

## 触摸手势

| 手势 | 动作 |
|---|---|
| 上滑 (dy < -80) | 子页面→Menu, Menu→Ready, Ready→Menu |
| 左滑 (dx < -60) | Status 页下一个状态 |
| 右滑 (dx > 60) | Status 页上一个状态 |
| 点击 | Menu 页选择菜单项 |
| 长按 (800ms) | 任意页面→Ready |

## 性能参数

| 页面 | 帧率 |
|---|---|
| Ready | 30ms/帧 (33fps) |
| Status | 30ms/帧 |
| Spider | 20ms/帧 (50fps, 加速) |
| Alert/Energy | 200ms/帧 (每 2.4s 切状态) |
| Menu/Settings/About | 80ms 刷新 |
| 触摸采样 | 10ms (100Hz) |

## 配色

```c
COL_BLACK     0x0000  /* 黑 */
COL_TRAE_GRN  0x07F0  /* Trae 标志绿 */
COL_BRIGHT_GR 0x2FFE  /* 亮绿 */
COL_DARK_GR   0x0120  /* 暗绿背景 */
COL_RED       0xF800  /* 红 (告警) */
COL_GRAY      0x4208  /* 灰 */
COL_DIM_GRAY  0x2104  /* 暗灰 */
```

## 技术要点

1. **RGB565 字节序**: 资源 little-endian, AMOLED big-endian, flush 时交换高低字节
2. **近邻采样放大**: 240×240 → 466×466, `scale_frame_240_to_466()`
3. **4 行分块刷新**: 避免 SPI 队列满
4. **PSRAM 分配**: 帧缓冲 `heap_caps_malloc(MALLOC_CAP_SPIRAM)`
5. **32×32 字库**: 比 24×24 大 33%, 渲染清晰
6. **delta patch 不再使用**: 改用 240×240 全屏帧, ESP32 端放大, 代码更简单

## 回退

如需回退到六宫格版本, 见同目录下其他版本文件夹。
