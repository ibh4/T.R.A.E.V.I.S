# v4_0702_quota_dual_channel — ESP32 圆屏会员额度页（双通道混合渲染版）

> 推送日期：2026-07-02  
> 分支：`Peng_0702_traepal_quota`  
> 目标硬件：ESP32-S3-Touch-AMOLED-1.75C（466×466 圆形 AMOLED）  
> ESP-IDF 版本：v5.5.2

## 版本亮点

本版本在 v3（Codey 风格额度页）基础上引入 **双通道混合渲染技术**：

- **中文层**：32×32 字库 2:1 降采样到 16×16，用低亮度色（灰白 COL_GRAY）作低分辨率背景层
- **ASCII/数字层**：8×16 字体 × scale 放大，用高亮色（白/绿/cyan）作高分辨率前景层
- **视觉效果**：中文作装饰背景不抢眼，英文/数字清晰可读，解决圆屏信息密度过高问题

其他改动：
- 边缘弧填充动画（20帧 40fps ease-out cubic，从 0% 渐进到 56%）
- 边缘弧三层圆帽结构（外亮边 + 中主色 + 内暗边 + 终点圆帽）
- 实时时钟（基于 FreeRTOS tick 递增，初始时间 2026/07/02 23:58 周四）
- 删除升级信息区，主信息下移填补空白
- header 缩小到 80% (48px) 并下移

## 目录结构

```
v4_0702_quota_dual_channel/
├── README.md              ← 本文件
├── CMakeLists.txt         ← 工程顶层 CMake
├── partitions.csv         ← 分区表 (32MB Flash)
├── sdkconfig.defaults     ← ESP32-S3 配置
├── font_atlas.bin         ← 字库 (210字 × 32×32 alpha mask = 215KB)
├── font_chars.txt         ← 字库字符索引表
├── states_anim.bin        ← 10状态动画 (240×240 RGB565 × 12帧 × 10)
├── gen_font_atlas.py      ← 字库生成脚本
├── gen_demo_resources.py  ← 动画资源生成脚本
├── PLAN.md                ← 工程设计文档
└── main/
    ├── CMakeLists.txt
    └── main.c             ← 固件主程序 (~1500行)
```

## 额度页布局（draw_quota）

屏幕 466×466，中心 CX=CY=233，半径 233。

### 字号坐标表

| # | 元素 | 文本 | x | y | scale | bold | 颜色 | 渲染方式 |
|---|------|------|---|---|-------|------|------|----------|
| 1 | header | `TRAE Work` | 居中 | 52 | 2 (48px) | 1 | 渐变 DARK_GR→BRIGHT_GR | draw_text_sb |
| 2 | 3D球体+头像 | thinking_focus | 183,100 | 150 | 100×100圆裁 | — | shade(TRAE_GRN) R=63 | draw_avatar_orb |
| 3 | 套餐 | `速通 Pro+ 单月` | 居中 | 226 | 1 | 0 | 中文GRAY+ASCII白 | draw_text_bgfg |
| 4a | meter1 label | `已用` | 86 | 272 | 1 | 0 | 中文GRAY+ASCII白 | draw_text_bgfg |
| 4b | meter1 段条 | 10段 | 165 | 275 | segW11/segH10/pitch14 | — | TRAE_GRN/0x1082 | fill_rounded_rect |
| 4c | meter1 pct | `56%` | 310 | 272 | 1 | 1 | COL_WHITE | draw_text_sb |
| 4d | meter1 右值 | `168/300` | 362 | 272 | 1 | 0 | 中文GRAY+ASCII白 | draw_text_bgfg |
| 5a | meter2 label | `剩余` | 86 | 308 | 1 | 0 | 中文GRAY+ASCII白 | draw_text_bgfg |
| 5b | meter2 段条 | 10段 | 165 | 311 | 同上 | — | BRIGHT_GR/0x1082 | fill_rounded_rect |
| 5c | meter2 pct | `44%` | 310 | 308 | 1 | 1 | COL_WHITE | draw_text_sb |
| 5d | meter2 右值 | `132次` | 362 | 308 | 1 | 0 | 中文GRAY+ASCII白 | draw_text_bgfg |
| 6 | 主信息 | `可用 132 次` | 居中 | 372 | 2 | 混合 | 中文GRAY+数字BRIGHT_GR粗 | draw_text_bgfg |
| 7 | 日期时间 | `14:30 07/01 周四` | 居中 | 444 | 1 | 0 | 中文GRAY+ASCII灰白 | draw_text_bgfg |

### 边缘弧调用参数

```c
draw_arc_range(buf, 233, 233, 194, 214,
               COL_TRAE_GRN, 0x1082, 56, -132.0f, 264.0f);
```

| 参数 | 值 | 说明 |
|------|----|------|
| 圆心 | (233, 233) | 屏幕中心 |
| rIn | 194 | 弧带内边 |
| rOut | 214 | 弧带外边 |
| 弧宽 | 20px | rOut - rIn |
| startDeg | -132° | design angle (0=顶, cw) |
| sweepDeg | 264° | 总弧长 |
| 底部缺口 | 96° | 360-264, 居中底部 |
| pct | 56% | QUOTA_USED_PCT |
| 填充动画 | 20帧/40fps | ease-out cubic `1-(1-t)³` |

### 三层圆帽结构

- **外亮边** [rOut-2, rOut]：`color_lighten_565(fill, 0.15)`
- **中层主色** [rIn+2, rOut-2]：`color_darken_565(fill, 0.08)`（比纯色稍暗，降低刺眼感）
- **内暗边** [rIn, rIn+2]：`color_darken_565(fill, 0.35)`
- **终点圆帽**：glow r=6 + 白心 r=4 + 主色芯 r=2（三层圆帽，精致不糊）
- **角度步进**：0.2°（比 0.3° 更细腻）
- **渲染方式**：fill_circle 逐角度打点（消除径向接缝锯齿）

## 双通道混合渲染详解

### 核心函数

```c
static int  text_width_bgfg(const char *text, int ascii_scale);
static int  draw_text_bgfg(uint16_t *buf, const char *text, int x, int y,
                           uint16_t cn_color, uint16_t ascii_color,
                           int ascii_scale, int bold);
static void draw_text_bgfg_center(uint16_t *buf, const char *text, int y,
                                   uint16_t cn_color, uint16_t ascii_color,
                                   int ascii_scale, int bold);
```

### 渲染流程

**第一遍（中文背景层）**：
1. 遍历 UTF-8 字符串，识别中文字符（3 字节 UTF-8）
2. 从 `font_atlas.bin` 分区读取 32×32 alpha mask（1024 bytes/字）
3. 2:1 降采样：2×2 邻域取最大 alpha，得到 16×16 低分辨率位图
4. 用 `cn_color`（COL_GRAY 灰白）绘制

**第二遍（ASCII 前景层）**：
1. 遍历 UTF-8 字符串，识别 ASCII 字符（1 字节）
2. 从 `font8x16[96][16]` 查表获取 8×16 位图
3. 按 `ascii_scale` 放大（scale 2 = 16×32）
4. 用 `ascii_color`（COL_WHITE/COL_BRIGHT_GR/COL_CYAN）绘制
5. bold=1 时向右下偏移 1px 叠加，模拟粗体

**宽度计算**：中文 16px/字，ASCII 8×scale px/字，混合字符串总宽 = 各字符宽之和。

### 字库访问

```c
// 字库存储在 font 分区 (0x1210000)
// 每字 1024 bytes (32×32 alpha mask)
// 偏移 = find_chinese_index(utf8_ptr) × 1024
esp_partition_read(s_font_part, (uint32_t)idx * 1024, mask, 1024);
```

## 字库生成方法

### 字库规格

- **字体**：Hiragino Sans GB（苹果系统自带黑体）
- **字号**：34px（渲染到 32×32 cell）
- **格式**：每字 32×32 alpha mask = 1024 bytes
- **字数**：210 字
- **总大小**：210 × 1024 = 215,040 bytes ≈ 210 KB
- **存储**：烧录到 flash `font` 分区（0x1210000）

### 生成命令

```bash
cd v4_0702_quota_dual_channel
python3 gen_font_atlas.py
```

输出：
- `font_atlas.bin`（字库二进制）
- `font_chars.txt`（字符索引表，格式 `idx: 字`）

### 字库字符集（210字）

字库按主题分组，覆盖所有页面文字需求：

```
药物研发智能体集合          # 项目描述 (0-8)
虚拟筛选分子设计蛋白构象      # 三个任务 (9-20)
生成训练对接失败完成提交结果  # 任务动作 (21-33)
等待启动任务执行中错误告警修复成功  # 状态 (34-49)
运行重跑下一当前选择确认取消返回上级  # 菜单操作 (50-65)
主菜单进度总结状态详情        # UI 文字 (66-75)
项目离线版本关于             # 标题 (76-83)
数据准备模型评估参数优化      # 子任务 (84-94)
操作精度触摸滑后退步          # 补全 (95-103)
药靶点预测结合亲和力度量      # 专业 (104-111)
构象多样性采样              # 专业 (112-115)
测试演示应用系统设置间        # 通用 (116-124)
连接准备待机入页面试         # 演示版 UI (125-129)
蜘蛛能量异关于扫描聚焦脉冲荷  # 状态名 (130-139)
休眠迷宫圆形离屏界面         # 其他 (140-147)
设备屏幕模式动画帧率亮度      # 设置页 (148-155)
硬件存储内存处理器           # 关于页 (156-163)
会员额速通剩余已升级实际支付抵扣到期时权益名称金可使率有效方案价值月年日次今星期二三四五六秒周天元  # 会员额度页+日期 (164-209)
```

### 字库校验

`gen_font_atlas.py` 内置校验：生成后自动检查所有菜单文字是否在字库中，缺字会打印警告。

## 颜色定义

```c
#define COL_BLACK     0x0000   // 纯黑
#define COL_WHITE     0xFFFF   // 纯白
#define COL_TRAE_GRN  0x07F0   // Trae 主绿 (fill_color)
#define COL_BRIGHT_GR 0x2FFE   // 亮绿 (meter2 主色, 主信息数字)
#define COL_DARK_GR   0x0120   // 暗绿 (header 渐变起点)
#define COL_DEEP_BLK  0x0202   // 深黑带绿调
#define COL_GRAY      0x4208   // 灰白 (双通道中文层)
#define COL_DIM_GRAY  0x2104   // 暗灰 (日期时间)
#define COL_RED       0xF800   // 红 (meter 高温告警)
#define COL_CYAN      0x07FF   // 青色 (升级信息)
#define COL_YELLOW    0xFFE0   // 黄
```

## 编译与烧录

### 编译

```bash
source /path/to/esp-idf/export.sh
cd v4_0702_quota_dual_channel
idf.py build
```

### 烧录（5 个分区）

```bash
esptool.py --chip esp32s3 -b 460800 \
  --before default_reset --after hard_reset write_flash \
  --flash_mode dio --flash_size 32MB --flash_freq 80m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x10000 build/traepal_player.bin \
  0x410000 states_anim.bin \
  0x1210000 font_atlas.bin
```

### 分区表

| 分区 | 地址 | 大小 | 内容 |
|------|------|------|------|
| bootloader | 0x0 | 22KB | 引导程序 |
| partition_table | 0x8000 | 3KB | 分区表 |
| traepal_player | 0x10000 | ~314KB | 主固件 |
| states_anim | 0x410000 | 13.2MB | 10状态动画 |
| font_atlas | 0x1210000 | 210KB | 中文字库 |

## 页面流程

1. **连接页** (1.5s) → 自动进入待机页
2. **待机页**：idle_ready 12帧动画，上滑进菜单，**右滑进额度页**
3. **额度页**：边缘弧填充动画 → 稳定显示
   - 长按 800ms → 回待机
   - 上滑 → 回待机
4. **菜单页**：6 个圆形径向菜单按钮

## 相比 v3 的改动

| 项目 | v3 | v4 |
|------|----|----|
| 中文渲染 | 32×32 × scale | **16×16 降采样**（双通道背景层） |
| ASCII渲染 | 8×16 × scale | 8×16 × scale（保持高分辨率） |
| 中文颜色 | COL_WHITE/COL_GRAY | **COL_GRAY 灰白**（统一背景层） |
| 边缘弧 | 静态 56% | **填充动画**（20帧 ease-out cubic） |
| 边缘弧结构 | 三层 | 三层 + 圆帽缩小（r9→r6） |
| 升级信息 | 有（2行） | **已删除** |
| header | y=40, 64px | y=52, **48px**（下移+缩小80%） |
| 主信息 y | 336 | **372**（下移填补升级区） |
| 时钟 | 14:30 固定 | **23:58 实时走动** |

## 可继续优化

1. 字库降采样可改用双线性插值替代最大值采样，中文边缘更柔和
2. 双通道渲染的中文层可加 50% 透明度，让背景更弱不抢前景
3. 边缘弧填充动画可加轻微回弹（overshoot 5%再收回），增加弹性感

## 技术约束

- ESP-IDF v5.5.2
- 32MB Flash, 八线 PSRAM 80MHz
- RGB565 格式（资源小端序，SPI AMOLED 大端序，flush 时交换高低字节）
- 完全离线运行，无 WiFi/BLE
- 字体：Hiragino Sans GB 34px → 32×32 cell
