# ESP32-S3-Touch-AMOLED-1.75C 引脚速查表

整理时间：2026-06-22

这份速查表基于以下信息交叉整理：

- 售后工程师提供的引脚表图片
- 官方仓库源码：`examples/ESP-IDF-v5.5`
- 官方原理图文字抽取结果

目的：后续写 ESP-IDF 驱动和做板级初始化时，优先查这份表，不用反复翻截图和原理图。

## 1. 已确认一致的主功能引脚

| ESP32-S3 GPIO | 功能模块 | 信号名 | 说明 |
| --- | --- | --- | --- |
| GPIO1 | LCD | `LCD_RESET` | AMOLED 复位 |
| GPIO2 | Touch | `TP_RESET` | 触摸复位 |
| GPIO4 | LCD QSPI | `QSPI_SIO0` | 屏幕数据 0 |
| GPIO5 | LCD QSPI | `QSPI_SI1` | 屏幕数据 1 |
| GPIO6 | LCD QSPI | `QSPI_SI2` | 屏幕数据 2 |
| GPIO7 | LCD QSPI | `QSPI_SI3` | 屏幕数据 3 |
| GPIO8 | ES8311 / I2S | `I2S_DSDIN` | 音频输出数据，官方 BSP 名为 `BSP_I2S_DOUT` |
| GPIO9 | ES8311 / I2S | `I2S_SCLK` | I2S Bit Clock |
| GPIO10 | ES8311 / I2S | `I2S_ASDOUT` | 音频输入数据，官方 BSP 名为 `BSP_I2S_DSIN` |
| GPIO11 | Touch | `TP_INT` | 触摸中断 |
| GPIO12 | LCD | `LCD_CS` | 屏幕片选 |
| GPIO13 | LCD | `LCD_TE` | 屏幕 TE 同步信号 |
| GPIO14 | I2C | `TP_SCL` / `ESP32_SCL` | 触摸、IMU、音频控制总线共用 SCL |
| GPIO15 | I2C | `TP_SDA` / `ESP32_SDA` | 触摸、IMU、音频控制总线共用 SDA |
| GPIO16 | ES8311 / I2S | `I2S_MCLK` | I2S 主时钟 |
| GPIO19 | USB | `USB_N` | USB D- |
| GPIO20 | USB | `USB_P` | USB D+ |
| GPIO21 | QMI8658C | `QMI_INT1` | IMU 中断 |
| GPIO38 | LCD QSPI | `QSPI_SCL` | 屏幕 QSPI 时钟，官方 BSP 名为 `BSP_LCD_PCLK` |
| GPIO43 | UART0 | `U0TXD` | 默认串口 TX |
| GPIO44 | UART0 | `U0RXD` | 默认串口 RX |
| GPIO45 | ES8311 / I2S | `I2S_LRCK` | I2S 左右声道时钟 |
| GPIO46 | 功放控制 | `PA_CTRL` | 扬声器功放使能 |

## 2. 售后表中给出、且和原理图网络名对得上的辅助信号

| ESP32-S3 GPIO | 信号名 | 说明 |
| --- | --- | --- |
| GPIO3 | `SYS_OUT` | 电源相关输出，官方示例里不常直接使用 |
| GPIO17 | `GPIO17` | 焊盘 / 扩展信号 |
| GPIO18 | `GPIO18` | 焊盘 / 扩展信号 |
| GPIO39 | `GPIO39` | 焊盘 / 扩展信号 |
| GPIO40 | `GPIO40` | 焊盘 / 扩展信号 |
| GPIO41 | `GPIO41` | 焊盘 / 扩展信号 |
| GPIO42 | `GPIO42` | 焊盘 / 扩展信号 |

## 3. 开发时最常用的分组

### 3.1 显示屏 CO5300

| 信号 | GPIO |
| --- | --- |
| `LCD_RESET` | GPIO1 |
| `LCD_CS` | GPIO12 |
| `LCD_TE` | GPIO13 |
| `QSPI_SIO0` | GPIO4 |
| `QSPI_SI1` | GPIO5 |
| `QSPI_SI2` | GPIO6 |
| `QSPI_SI3` | GPIO7 |
| `QSPI_SCL` | GPIO38 |

### 3.2 触摸 CST9217

| 信号 | GPIO |
| --- | --- |
| `TP_RESET` | GPIO2 |
| `TP_INT` | GPIO11 |
| `TP_SCL` | GPIO14 |
| `TP_SDA` | GPIO15 |

### 3.3 IMU QMI8658C

| 信号 | GPIO |
| --- | --- |
| `ESP32_SCL` | GPIO14 |
| `ESP32_SDA` | GPIO15 |
| `QMI_INT1` | GPIO21 |

### 3.4 音频 ES8311

| 信号 | GPIO |
| --- | --- |
| `I2S_DSDIN` | GPIO8 |
| `I2S_SCLK` | GPIO9 |
| `I2S_ASDOUT` | GPIO10 |
| `I2S_MCLK` | GPIO16 |
| `I2S_LRCK` | GPIO45 |
| `PA_CTRL` | GPIO46 |
| 控制 I2C `SCL` | GPIO14 |
| 控制 I2C `SDA` | GPIO15 |

### 3.5 USB 与调试串口

| 信号 | GPIO |
| --- | --- |
| `USB_N` | GPIO19 |
| `USB_P` | GPIO20 |
| `U0TXD` | GPIO43 |
| `U0RXD` | GPIO44 |

## 4. 和官方 BSP 对应的宏名

官方 ESP-IDF BSP 里，常见宏和实际 GPIO 对应如下：

| BSP 宏名 | GPIO | 含义 |
| --- | --- | --- |
| `BSP_I2C_SCL` | GPIO14 | 板级 I2C SCL |
| `BSP_I2C_SDA` | GPIO15 | 板级 I2C SDA |
| `BSP_I2S_SCLK` | GPIO9 | I2S BCLK |
| `BSP_I2S_MCLK` | GPIO16 | I2S MCLK |
| `BSP_I2S_LCLK` | GPIO45 | I2S LRCK |
| `BSP_I2S_DOUT` | GPIO8 | I2S 输出到 ES8311 |
| `BSP_I2S_DSIN` | GPIO10 | I2S 输入回 ESP32-S3 |
| `BSP_POWER_AMP_IO` | GPIO46 | 功放控制 |
| `BSP_LCD_CS` | GPIO12 | LCD 片选 |
| `BSP_LCD_PCLK` | GPIO38 | LCD QSPI 时钟 |
| `BSP_LCD_DATA0` | GPIO4 | LCD QSPI D0 |
| `BSP_LCD_DATA1` | GPIO5 | LCD QSPI D1 |
| `BSP_LCD_DATA2` | GPIO6 | LCD QSPI D2 |
| `BSP_LCD_DATA3` | GPIO7 | LCD QSPI D3 |
| `BSP_LCD_RST` | GPIO1 | LCD Reset |
| `BSP_LCD_TOUCH_RST` | GPIO2 | Touch Reset |
| `BSP_LCD_TOUCH_INT` | GPIO11 | Touch INT |

## 5. 备注

- 官方 BSP 宏定义和售后图片主表基本一致，可作为当前开发依据。
- 官方代码中的部分注释有模板复用痕迹，个别器件名称注释不一定准确；开发时以 GPIO 宏定义和原理图网络名为准。
- `GPIO14` 和 `GPIO15` 是这块板最关键的共用 I2C 总线，触摸、IMU、音频控制都会用到。
- 如果后面要补 `AXP2101`、`RTC`、双麦克风 ES7210 的更细引脚表，建议再从原理图 PDF 精查一轮后追加到这份文档。

## 6. 参考位置

- 官方工程目录：`/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/examples/ESP-IDF-v5.5`
- 官方 BSP 头文件：
  `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/examples/ESP-IDF-v5.5/05_Spec_Analyzer/components/esp32_s3_touch_amoled_1_75c/include/bsp/esp32_s3_touch_amoled_1_75c.h`
- 原理图 PDF：
  `/Users/pwngwc/projects/ESP32/ESP32-S3-Touch-AMOLED-1.75C-main/Schematic/ESP32-S3-Touch-AMOLED-1.75C-schematic.pdf`
