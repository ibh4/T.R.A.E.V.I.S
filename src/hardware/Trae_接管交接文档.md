# Trae 接管交接文档

整理时间：2026-06-24

本文档用于把当前 ESP32-S3 圆形 AMOLED 吧唧项目的已知信息、已完成验证、现有素材、缺口和下一步建议统一交给 Trae 接管。

---

## 1. 项目目标概述

当前项目的目标是基于 `Waveshare ESP32-S3-Touch-AMOLED-1.75C` 开发一个带圆形 AMOLED 屏幕的 AI 工作搭子 / 电子吧唧设备。

设备方向包括：

- 圆形屏幕状态展示
- 表情 / 动画播放
- 与电脑端状态同步
- 后续接入项目状态、编译失败、修复成功、任务推进等事件

团队现有素材中，这个设备视觉形象被命名为 `TraePal`。

---

## 2. 硬件信息

### 2.1 开发板型号

- `ESP32-S3-Touch-AMOLED-1.75C`

### 2.2 已知板载能力

- 主控：`ESP32-S3`
- 无线：`Wi-Fi`、`Bluetooth LE`
- 屏幕：`1.75"` 圆形 AMOLED，`466x466`
- 触摸：电容触摸
- 音频：
  - `ES8311` 编解码
  - 双麦克风相关音频链路
  - 扬声器功放控制
- 传感器：`QMI8658C` IMU
- 电源管理：`AXP2101`

### 2.3 本地硬件资料位置

- 官方仓库解压目录：
  `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main`
- 原理图 PDF：
  `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/Schematic/ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf`
- 固件 bin：
  `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/Firmware/ESP32-S3-Touch-AMOLED-1.75C-FactoryOnly-260114.bin`

---

## 3. 已确认引脚

已经整理成单独文档：

- [ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md](/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md)

最关键的当前开发引脚如下：

### 3.1 显示屏

- `GPIO1` = `LCD_RESET`
- `GPIO12` = `LCD_CS`
- `GPIO13` = `LCD_TE`
- `GPIO38` = `QSPI_SCL`
- `GPIO4` = `QSPI_SIO0`
- `GPIO5` = `QSPI_SI1`
- `GPIO6` = `QSPI_SI2`
- `GPIO7` = `QSPI_SI3`

### 3.2 触摸

- `GPIO2` = `TP_RESET`
- `GPIO11` = `TP_INT`
- `GPIO14` = `TP_SCL`
- `GPIO15` = `TP_SDA`

### 3.3 IMU

- `GPIO14` = `ESP32_SCL`
- `GPIO15` = `ESP32_SDA`
- `GPIO21` = `QMI_INT1`

### 3.4 音频

- `GPIO8` = `I2S_DSDIN`
- `GPIO9` = `I2S_SCLK`
- `GPIO10` = `I2S_ASDOUT`
- `GPIO16` = `I2S_MCLK`
- `GPIO45` = `I2S_LRCK`
- `GPIO46` = `PA_CTRL`

### 3.5 USB / 串口

- `GPIO19` = `USB_N`
- `GPIO20` = `USB_P`
- `GPIO43` = `U0TXD`
- `GPIO44` = `U0RXD`

---

## 4. ESP-IDF 环境状态

### 4.1 已安装

- `ESP-IDF v5.5.2`

本地位置：

- `/Users/pwngwc/projects/ESP32/esp-idf`

### 4.2 已验证

已经完成以下验证：

1. `ESP-IDF` 可正常配置和编译
2. 板子可通过 USB 正常烧录
3. `hello_world` 已经成功跑通过
4. 官方 `01_AXP2101` 示例已成功编译、烧录、串口抓日志

---

## 5. 实机测试结果

### 5.1 串口设备

测试时曾识别到设备串口：

- `/dev/cu.usbmodem21201`

注意：设备重启后串口号可能变化，需要动态扫描 `/dev/cu.usbmodem*`

### 5.2 AXP2101 官方示例测试结果

测试工程：

- `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/examples/ESP-IDF-v5.5/01_AXP2101`

已确认：

- 板子能正常启动
- `AXP2101` 初始化成功
- USB 供电正常
- 系统电压读数正常
- 当前无电池时，电池电压 / 电量为 0 或无效值，属于预期

关键日志结论：

- `Init PMU SUCCESS!`
- `isVbusIn: YES`
- `isVbusGood: YES`
- `getVbusVoltage: 5220~5222 mV`
- `getSystemVoltage: 3751~3755 mV`
- `battery percentage: -1 %`
- `getBattVoltage: 0 mV`

### 5.3 已知注意事项

- 官方示例工程当前镜像头按 `2MB flash` 生成
- 板子实测识别到的是更大的 flash
- 当前示例能跑，但后续正式项目应修正 flash 配置

---

## 6. 官方 ESP-IDF 示例目录

位置：

- `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/examples/ESP-IDF-v5.5`

目前已知有这些工程：

- `01_AXP2101`
- `02_lvgl_demo_v9`
- `03_esp-brookesia`
- `04_Immersive_block`
- `05_Spec_Analyzer`

建议优先级：

1. `01_AXP2101`
   已验证硬件基础链路正常
2. `02_lvgl_demo_v9`
   下一步优先验证屏幕和触摸
3. `05_Spec_Analyzer`
   可能与音频 / UI 状态展示更相关

---

## 7. 团队提供的 Trae 素材包

压缩包：

- `/Users/pwngwc/projects/ESP32/Trae_proj-main.zip`

已知关键内容：

### 7.1 表情网页原型

- `/Users/pwngwc/projects/ESP32/Trae_proj-main/art_prototype/traepal_round_badge.html`

这是一个圆形屏预览网页，可以切换状态：

- `Idle`
- `Scan`
- `Bug`
- `Fixed`
- `Sync`
- `Charge`
- `Nudge`
- `Maze`

### 7.2 视觉资源

- `/Users/pwngwc/projects/ESP32/Trae_proj-main/assets/trae-color.svg`

### 7.3 动画输出资源

- `/Users/pwngwc/projects/ESP32/Trae_proj-main/output/traepal_sequences`
- `/Users/pwngwc/projects/ESP32/Trae_proj-main/output/traepal_sequences_hardware`

### 7.4 已定义的状态 / 表情资源

从 `manifest.json` 中已确认：

- `idle_ready`
- `thinking_scan`
- `bug_alert`
- `fix_success`
- `sync_ping`
- `task_charge`
- `sleepy_nudge`
- `bug_maze`

### 7.5 资源生成脚本

- `/Users/pwngwc/projects/ESP32/Trae_proj-main/tools/render_traepal_sequences.ps1`

该脚本可以生成：

- PNG 帧
- GIF
- spritesheet
- RGB565 硬件播放包

---

## 8. 当前缺口

这是最关键的一部分。

### 8.1 已有但未接上的部分

- 有圆形屏网页原型
- 有动画状态资源
- 有 RGB565 硬件帧资源
- 有状态映射设计文档

### 8.2 还没有实现的部分

- 没有真正的电脑端 `Bridge` 程序
- 没有真正的 “Trae work 输出 / 项目状态 / 编译错误” 自动检测脚本
- 没有实现 ESP32 与电脑端的串口 / Wi-Fi / BLE 状态同步协议
- 没有把网页原型里的状态切换真正映射到实物板屏幕播放

换句话说：

当前团队素材更像是：

- `设计稿`
- `资源包`
- `播放资产`
- `接入说明`

而不是一个完整可运行的：

- `项目状态检测器`
- `Bridge`
- `ESP32 播放固件`

---

## 9. 文档中已经规划但尚未落地的交互模型

文档里已经规划了电脑端发送 JSON 给硬件端，格式大致如下：

```json
{
  "mode": "guardian",
  "event": "compile_failed",
  "asset": "bug_alert",
  "message": "Build failed",
  "suggestion": "Lower animation fps and use partial refresh"
}
```

即：

- 电脑端负责读取项目状态 / 编译结果 / 错误日志
- 转成轻量 JSON
- ESP32 根据 `asset` 或 `event` 切换动画

---

## 10. 推荐的下一步实施路径

### 路线 A：先打通实机屏幕播放

目标：

- 先让板子跑起来 `TraePal` 动画，而不是先做复杂监控

建议顺序：

1. 跑通官方 `02_lvgl_demo_v9`
2. 确认 `466x466 AMOLED` 和触摸链路正常
3. 做一个最小播放器：
   - 先硬编码播放一个状态，如 `idle_ready`
   - 读取 `RGB565` 帧或 `GIF`
4. 再做本地状态切换：
   - 按键切换
   - 定时切换
5. 最后再接电脑端 Bridge

### 路线 B：先做电脑端 Bridge

目标：

- 先能检测工程输出，并把状态发给 ESP32

建议顺序：

1. 写一个本地脚本监听：
   - 编译成功 / 失败
   - 测试成功 / 失败
   - 长时间空闲
2. 输出统一 JSON
3. 通过串口把 JSON 发给 ESP32
4. ESP32 收到后切换对应动画

### 当前推荐

建议先走 `路线 A`，因为：

- 硬件屏幕链路还没完全跑通
- 没必要在屏幕都没确认之前先做复杂电脑端检测
- 先确认“能显示动画”，再做状态感知，风险更低

---

## 11. 建议 Trae 优先完成的里程碑

建议按以下顺序接管：

1. 跑通 `02_lvgl_demo_v9`
2. 记录屏幕初始化、触摸是否可用
3. 写一个最小 `TraePal` 动画播放器
4. 先播放 `idle_ready`
5. 支持切到 `bug_alert` / `fix_success`
6. 再实现电脑端状态 Bridge MVP

---

## 12. Trae 接管提示词

下面这段提示词可以直接给 Trae：

```text
你现在接管一个 ESP32-S3 圆形 AMOLED 吧唧项目，请严格基于本地工作区内容推进，不要假设不存在的文件或功能。

工作区根目录：
/Users/pwngwc/projects/ESP32

请先完整阅读以下关键文件：

1. /Users/pwngwc/projects/ESP32/Trae_接管交接文档.md
2. /Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md
3. /Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/examples/ESP-IDF-v5.5 下的官方示例
4. /Users/pwngwc/projects/ESP32/Trae_proj-main/docs/HARDWARE_INTEGRATION.md
5. /Users/pwngwc/projects/ESP32/Trae_proj-main/docs/ART_PROTOTYPE_USAGE.md
6. /Users/pwngwc/projects/ESP32/Trae_proj-main/art_prototype/traepal_round_badge.html
7. /Users/pwngwc/projects/ESP32/Trae_proj-main/output/traepal_sequences/manifest.json
8. /Users/pwngwc/projects/ESP32/Trae_proj-main/output/traepal_sequences_hardware/manifest.json

当前已知事实：

- 开发板是 Waveshare ESP32-S3-Touch-AMOLED-1.75C
- ESP-IDF v5.5.2 已装好
- hello_world 已在实机跑通过
- 官方 01_AXP2101 示例已编译、烧录、串口验证通过
- AXP2101 初始化成功，USB 供电正常
- 屏幕相关引脚、触摸引脚、音频引脚已在引脚速查表中确认
- 团队素材包里已有 TraePal 网页原型和动画资源
- 还没有真正实现电脑端 Bridge 和 Trae work 输出检测逻辑

你的第一优先级不是做抽象设计，而是把实机显示链路推进到可见结果。

请按这个顺序执行：

1. 先梳理并验证官方 02_lvgl_demo_v9 工程的依赖和配置
2. 在不破坏现有工作区的前提下，编译并尝试烧录 02_lvgl_demo_v9
3. 记录屏幕、触摸是否正常
4. 如果官方 demo 可跑，创建一个最小 TraePal 播放实验工程：
   - 先只支持播放 idle_ready
   - 资源优先用 Trae_proj-main/output/traepal_sequences_hardware 或 preview 资源
5. 为后续 Bridge 预留一个简单状态接口，例如：
   - idle_ready
   - thinking_scan
   - bug_alert
   - fix_success

约束：

- 不要假设已有 Bridge 可用，因为目前并没有实现
- 不要把 Wokwi 示例当成真板驱动
- 优先复用官方 BSP / esp_lcd / LVGL 初始化路径
- 每一步都要输出你修改了哪些文件、如何验证、下一步风险是什么

如果 02_lvgl_demo_v9 编译或烧录失败，请先定位真实错误，再决定是否切换到 03_esp-brookesia 或 05_Spec_Analyzer 的显示路径。
```

---

## 13. 交接结论

当前项目状态可以概括为：

- 硬件基础链路通了
- AXP2101 已实机验证
- 屏幕 / TraePal 动画 / 状态同步还没有真正跑通
- 团队已经有不错的视觉原型和动画资源
- 现在最缺的是：
  - 实机屏幕播放 MVP
  - 电脑端状态 Bridge

所以 Trae 最合理的接管方式是：

- 先把屏幕播放跑通
- 再把项目状态检测接上

