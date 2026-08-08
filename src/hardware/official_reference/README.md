# 官方参考资料 (Official Reference)

从 Waveshare 官方仓库 [ESP32-S3-Touch-AMOLED-1.75C](https://www.waveshare.com/esp32-s3-touch-amoled-1.75c.htm) 提取的工程资料，用于硬件开发和调试参考。

## 内容

### ESP-IDF-v5.5/ - 官方 ESP-IDF 示例工程

包含 5 个完整示例，已排除 build/managed_components/sdkconfig 等编译产物：

| 示例 | 说明 |
|------|------|
| 01_AXP2101 | AXP2101 电源管理芯片测试 |
| 02_lvgl_demo_v9 | LVGL v9 屏幕显示 demo (本项目 traepal_player 的基础) |
| 03_esp-brookesia | ESP Brookesia UI 框架示例 |
| 04_Immersive_block | 沉浸式方块 demo |
| 05_Spec_Analyzer | 频谱分析仪 (含完整 BSP 头文件) |

**关键文件**:
- `ESP-IDF-v5.5/05_Spec_Analyzer/components/esp32_s3_touch_amoled_1_75c/include/bsp/esp32_s3_touch_amoled_1_75c.h` - 完整 BSP API 定义
- `ESP-IDF-v5.5/02_lvgl_demo_v9/components/esp32_s3_touch_amoled_1_75c/esp32_s3_touch_amoled_1_75c.c` - BSP 实现 (引脚定义+驱动)

### ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf - 原理图

官方硬件原理图 PDF，包含完整电路连接和引脚定义。

## 使用说明

这些资料仅供参考，实际开发使用 `../traepal_player/` 下的工程。如需运行官方示例：

```bash
cd ESP-IDF-v5.5/02_lvgl_demo_v9
source /path/to/esp-idf/export.sh
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/cu.usbmodemXXXX flash
```

## 来源

- 官方产品页: https://www.waveshare.com/esp32-s3-touch-amoled-1.75c.htm
- 官方 Wiki: https://www.waveshare.net/wiki/ESP32-S3-Touch-AMOLED-1.75C
- ESP-IDF 版本要求: >= 5.3.1 (本项目使用 v5.5.2)
