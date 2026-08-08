# TraePal 硬件播放器 (ESP32-S3-Touch-AMOLED-1.75C)

在 Waveshare ESP32-S3-Touch-AMOLED-1.75C 圆形 AMOLED 屏幕上播放 TraePal 表情动画，并播放启动提示音。

## 硬件平台

- **开发板**: Waveshare ESP32-S3-Touch-AMOLED-1.75C
- **主控**: ESP32-S3R8 (240MHz, 8MB PSRAM, 32MB Flash)
- **屏幕**: 1.75" 圆形 AMOLED 466x466, CO5300 驱动 (QSPI)
- **触摸**: CST9217 电容触摸 (I2C 0x5A)
- **音频**: ES8311 编解码 (I2C 0x18, I2S)
- **IMU**: QMI8658C 六轴 (I2C 0x6B)
- **PMU**: AXP2101 (I2C 0x34)

## 已实现功能

1. **屏幕显示**: CO5300 AMOLED 466x466 初始化, LVGL v9.5 渲染
2. **动画播放**: 从 SPIFFS 预加载 16 帧 RGB565 到 PSRAM, 12fps 循环播放 idle_ready
3. **启动提示音**: ES8311 + I2S 输出 1kHz 正弦波 0.3 秒
4. **触摸链路**: CST9217 已初始化 (暂未绑定交互事件)

## 工程结构

```
traepal_player/
├── CMakeLists.txt              # 顶层 CMake (project traepal_player)
├── sdkconfig.defaults          # ESP-IDF 配置 (32MB Flash, 八线 PSRAM 80M, LVGL)
├── partitions.csv              # 分区表 (factory 4MB + storage 12MB SPIFFS)
├── main/
│   ├── main.c                  # 主程序: 屏幕+SPIFFS+动画+提示音
│   ├── CMakeLists.txt          # 含 spiffs_create_partition_image
│   └── idf_component.yml       # 依赖 waveshare BSP + LVGL 9
├── components/
│   └── esp32_s3_touch_amoled_1_75c/  # 官方 BSP (引脚定义+驱动)
└── spiffs_image/               # 运行时生成 (不推送, 见下方说明)
```

## 编译烧录步骤

### 1. 环境要求

- ESP-IDF v5.5.2 (>= 5.3.1)
- macOS / Linux / Windows
- USB-C 数据线

### 2. 生成 SPIFFS 镜像

SPIFFS 需要存放 idle_ready 的 24 帧 RGB565 数据 (每帧 434312 字节, 共约 10MB)。

从仓库的 `output/traepal_sequences_466_display/idle_ready/frames_rgb565/` 复制帧到 `spiffs_image/`:

```bash
mkdir -p spiffs_image
cd ../output/traepal_sequences_466_display/idle_ready/frames_rgb565
for i in $(seq 0 23); do
    cp frame_$(printf %03d $i).bin ../../../../src/hardware/traepal_player/spiffs_image/f$(printf %02d $i).bin
done
```

### 3. 编译烧录

```bash
source /path/to/esp-idf/export.sh
cd src/hardware/traepal_player
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/cu.usbmodemXXXX flash
```

### 4. 查看串口日志

```bash
idf.py -p /dev/cu.usbmodemXXXX monitor
```

或用 pyserial (非交互环境):

```bash
python3 -c "
import serial, time
ser = serial.Serial('/dev/cu.usbmodemXXXX', 115200, timeout=1)
ser.setDTR(False); ser.setRTS(True); time.sleep(0.1)
ser.setDTR(True); ser.setRTS(False); time.sleep(0.1)
ser.setRTS(True); time.sleep(0.5)
ser.reset_input_buffer()
end = time.time() + 15
while time.time() < end:
    data = ser.read(4096)
    if data: print(data.decode('utf-8', errors='replace'), end='')
ser.close()
"
```

## 实机验证日志

```
I (2229) TRAEPAL: 屏幕初始化成功
I (2184) CST9217: Resolution X: 466, Y: 466
I (2463) TRAEPAL: SPIFFS 挂载成功 (11MB total, 10MB used)
I (6325) TRAEPAL: 预加载完成: 16 帧, 共 6948992 字节
I (6329) TRAEPAL: TraePal idle_ready 动画播放中 (12fps, 16帧循环)
I (6335) ES8311: Work in Slave mode
I (6383) Adev_Codec: Open codec device OK
I (6733) TRAEPAL: 提示音: 播放完成
```

## 关键引脚

| 功能 | GPIO | 说明 |
|------|------|------|
| LCD_CS | 12 | 屏幕片选 |
| LCD_RST | 1 | 屏幕复位 |
| QSPI_SCL | 38 | 屏幕 QSPI 时钟 |
| QSPI_SIO0-3 | 4,5,6,7 | 屏幕 QSPI 数据 |
| I2C_SCL | 14 | 共用 I2C 总线 |
| I2C_SDA | 15 | 共用 I2C 总线 |
| I2S_SCLK | 9 | I2S 位时钟 |
| I2S_MCLK | 16 | I2S 主时钟 |
| I2S_LCLK | 45 | I2S 左右时钟 |
| I2S_DOUT | 8 | I2S 输出 (到 ES8311) |
| PA_CTRL | 46 | 扬声器功放使能 |

完整引脚定义见 `../ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md`

## 技术要点

### 动画播放机制

1. 24 帧 RGB565 (466x466x2 = 434312 字节/帧) 存入 SPIFFS 分区
2. 启动时预加载 16 帧到 PSRAM (6.6MB, 耗时约 4 秒)
3. LVGL canvas 绑定第一帧 buffer
4. LVGL timer 每 83ms (12fps) 切换 canvas buffer 指针到下一帧
5. 预加载只做一次, 播放期间无 IO 开销

### 提示音实现

1. `bsp_audio_codec_speaker_init()` 初始化 ES8311 (I2C 控制 + I2S 数据)
2. 独立 FreeRTOS task 生成 1kHz 正弦波 (22050Hz, 16bit, mono, 0.3 秒)
3. `esp_codec_dev_write()` 输出 PCM 数据
4. 播放完成后关闭 codec, task 自删除

## 下一步规划

- [ ] 触摸切换状态 (idle_ready <-> bug_alert <-> fix_success)
- [ ] 状态切换时播放不同提示音
- [ ] 电脑端 Bridge (串口 JSON 协议控制状态切换)
- [ ] IMU 姿态交互 (摇晃切换状态)
- [ ] WiFi 联网状态同步

## 相关文档

- [Trae_接管交接文档.md](./Trae_接管交接文档.md) - 项目整体交接信息
- [ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md](./ESP32-S3-Touch-AMOLED-1.75C-引脚速查表.md) - 完整引脚定义
