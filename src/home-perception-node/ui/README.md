# TAREVIS Home Node UI

这是家庭感知节点的独立 480x320 触摸界面，不依赖 TAREVIS 主程序。界面以树莓派 ILI9486 屏幕的原生分辨率设计，并在 Windows 浏览器中等比放大预览。

## Windows 预览

```powershell
cd src/home-perception-node/ui
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/?profile=pi&standalone=1`。`standalone=1` 使用内置模拟状态，不要求 Python 服务在线。

可使用查询参数直接查看页面：

```text
http://127.0.0.1:5173/?page=guard
http://127.0.0.1:5173/?page=vision
http://127.0.0.1:5173/?page=audio
http://127.0.0.1:5173/?page=events
http://127.0.0.1:5173/?page=device
```

增加 `profile=pi` 会启用较低刷新率的树莓派动画节奏：

```text
http://127.0.0.1:5173/?profile=pi
```

Windows 上查看完整平滑动效可使用展示档：

```text
http://127.0.0.1:5173/?motion=showcase&standalone=1
```

两种模式拥有相同的状态和动效种类；`profile=pi` 仅将持续动画离散到约 4-6 fps，降低 SPI 屏幕刷新压力。

## 本地服务联调

在 `src/home-perception-node` 目录安装 Python 可选依赖并构建页面：

```powershell
python -m pip install -e ".[vision,audio,ui]"
cd ui
npm install
npm run build
cd ..
```

启动同进程页面、API 和 WebSocket 服务：

```powershell
.\scripts\start-windows-ui.ps1
```

打开 `http://127.0.0.1:8787/?profile=pi`。此模式下：

- 右上角状态显示 `LOCAL LINK`。
- 模拟面板调用 Python mock API，而不是只修改浏览器内存。
- 高优先级事件自动接管事件页，确认后返回原页面。
- 视觉页可启动配置好的摄像头，显示低帧率预览与事件抓拍。
- 声音页执行一次固定时长麦克风采样，并将转写/关键词事件送入同一状态流。
- 设备页可扫描、选择和测试后台实际使用的摄像头与麦克风，并持久化到本机设置文件。

PC 默认摄像头完整启动示例：

```powershell
.\scripts\start-windows-ui.ps1 -VisionSource 0 -AutoStartVision
```

声音采样默认使用真实麦克风加 mock 转写，因此不下载 ASR 模型。用求助短语验证告警接管：

```powershell
.\scripts\start-windows-ui.ps1 -AudioMockText "请帮帮我"
```

设备设置只在用户主动打开面板时扫描硬件。保存结果会在本地服务下次启动时应用；命令行
传入的设备参数具有更高优先级。浏览器只调用本地 API，不直接使用 `MediaDevices` 代替
Python/OpenCV/sounddevice 的设备清单。麦克风“测试”会在内存中采集约 0.6 秒，显示
RMS 输入电平，不写入录音文件。

## 检查

```powershell
npm run build
npm run test:e2e
```

页面和运行状态是两个独立维度：

- 页面：守护、视觉、声音、事件、设备。
- 状态：就绪、感知、告警、等待确认、已处理。

高优先级事件会自动接管事件页面；普通情况下可以通过触摸底部导航切换页面。PC 摄像头、视频文件和固定时长麦克风采样已接入；OV5647 的 Picamera2 输入适配器已实现但仍需真机验收，ILI9486 kiosk 和触摸校准仍需在树莓派实机阶段完成。
