# TAREVIS Home Perception Node

TAREVIS 家庭感知节点是一个与主程序隔离的 Python 子项目。它先在 PC 上验证视觉、音频和事件输出，稳定后再部署到树莓派，最后通过适配器接入 TAREVIS。

当前完成 PC 端感知闭环、480x320 触摸界面和本地服务联调；Picamera2 采集适配器和远程 MJPEG 软件链已实现，树莓派实机验收仍待硬件连接：

- 带版本的结构化事件契约。
- PC 与树莓派基础配置。
- 家庭场景 mock 事件。
- 标准输出和 JSONL 事件 sink。
- 无硬件、无网络、无第三方依赖的单元测试。
- 视频文件和摄像头输入。
- 可选 `picamera2://<camera-number>` CSI 摄像头输入。
- OpenCV ROI 运动检测、连续帧、冷却和抓拍。
- 可选浏览器 MJPEG 调试预览。
- PCM WAV 时长、格式与 RMS 检查。
- mock/FunASR 可替换转写器。
- 求助类短语和用户确认类短语路由。
- 可选固定时长麦克风录音。
- 可插拔目标检测器接口。
- OpenCV DNN YOLO 传统 one-to-many 输出的 ONNX 推理与后处理。
- 运动触发后的稀疏二级检测。
- PC/树莓派可复用的模型基准命令。
- PC/树莓派环境 doctor 和部署验收指南。
- 五页 480x320 触摸界面：守护、视觉、声音、事件和设备。
- FastAPI 本地 API、WebSocket 状态推送和同进程静态页面服务。
- 低帧率 MJPEG 视觉预览、事件抓拍和高优先级事件自动接管。
- 固定时长麦克风采样、转写和关键词事件驱动界面。
- 后台音视频设备枚举、稳定标识、本机选择与测试接口。
- 设备页摄像头/麦克风扫描、选择、测试和配置持久化。

麦克风和 FunASR 适配器已经实现，但需要安装各自的可选依赖。YOLO/ONNX 推理接口已实现，但仓库不附带模型。当前尚未接入 TAREVIS 主程序。

## 环境

- Python 3.11+
- Phase 1 无第三方运行依赖
- Phase 2 可选视觉依赖：NumPy、OpenCV headless
- Phase 3 可选麦克风依赖：sounddevice
- Phase 3 可选 ASR 依赖：FunASR、Torch、torchaudio

## 环境诊断

核心环境：

```powershell
python -m tarevis_home_node doctor --profile core
```

PC 视觉环境：

```powershell
python -m tarevis_home_node doctor --profile vision
```

树莓派完整环境：

```bash
python -m tarevis_home_node doctor --profile raspberry-pi \
  --model models/yolo26n.onnx \
  --labels models/coco80.txt
```

只验收树莓派摄像头和 MJPEG 链路：

```bash
python -m tarevis_home_node doctor --profile raspberry-pi-camera
```

Picamera2 应通过 Raspberry Pi OS 的 APT 安装，并使用系统 Python 创建的
`--system-site-packages` 虚拟环境。完整步骤见
[20260806_树莓派MJPEG远程预览部署与验收.md](docs/20260806_树莓派MJPEG远程预览部署与验收.md)。

`doctor` 始终输出 JSON。未满足必需项时退出码为 `1`，命令或配置错误为 `2`。

## 快速运行

在本目录执行：

```powershell
$env:PYTHONPATH = "src"
python -m tarevis_home_node list-scenarios
python -m tarevis_home_node mock-event --scenario fall
python -m tarevis_home_node mock-event --scenario delivery --sink both
```

默认 JSONL 输出位置由 `configs/pc.toml` 控制。显式加载配置：

```powershell
python -m tarevis_home_node --config configs/pc.toml mock-event --scenario motion --sink both
```

也可以安装为可编辑包：

```powershell
python -m pip install -e .
tarevis-home-node mock-event --scenario help
```

安装视觉依赖：

```powershell
python -m pip install -e ".[vision]"
```

安装麦克风或真实 ASR 依赖：

```powershell
python -m pip install -e ".[audio]"
python -m pip install -e ".[asr]"
```

## PC 模型工具环境

Windows 本机的模型下载、YOLO 导出和 FunASR 验证使用独立的
`.venv-ml-tools`。它基于 `llama_finetune` 的 Python 3.10 创建，并通过
`--system-site-packages` 复用该 Conda 环境已有的 CUDA Torch 和
torchaudio；家庭感知节点仍由 Python 3.11 运行，不要在工具环境中安装
本项目。

```powershell
$env:PYTHONNOUSERSITE = "1"
conda run -n llama_finetune python -m venv --system-site-packages .venv-ml-tools
.\.venv-ml-tools\Scripts\python.exe -m pip install `
  --cache-dir .cache\pip `
  -r requirements-ml-tools.txt
```

运行工具前固定本地缓存，避免模型和下载缓存写入系统盘：

```powershell
$env:PYTHONNOUSERSITE = "1"
$env:YOLO_CONFIG_DIR = (Resolve-Path .cache).Path
$env:TORCH_HOME = (Resolve-Path .cache).Path + "\torch"
$env:HF_HOME = (Resolve-Path .cache).Path + "\huggingface"
$env:MODELSCOPE_CACHE = (Resolve-Path .cache).Path + "\modelscope"
```

验证工具层没有复制或串用其他 Torch：

```powershell
.\.venv-ml-tools\Scripts\python.exe -c `
  "import site, torch; print(site.ENABLE_USER_SITE); print(torch.__file__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
.\.venv-ml-tools\Scripts\python.exe -m pip check
```

2026-08-02 本机验证结果：用户包目录已禁用，Torch
`2.7.1+cu128` 和 torchaudio `2.7.1+cu128` 均直接来自
`P:\Dev\Anaconda3\envs\llama_finetune`，CUDA 识别 NVIDIA GeForce RTX
4090，`pip check` 无冲突。工具环境和 `.cache` 都由 Git 忽略。

## Windows 界面预览与联调

只查看界面、不启动 Python 服务：

```powershell
cd ui
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/?profile=pi&standalone=1`。

首次进行完整联调前安装依赖并构建界面：

```powershell
python -m pip install -e ".[vision,audio,ui]"
cd ui
npm install
npm run build
cd ..
```

启动界面、API 和 WebSocket 服务：

```powershell
.\scripts\start-windows-ui.ps1
```

浏览器打开 `http://127.0.0.1:8787/?profile=pi`。接入默认 PC 摄像头并自动启动视觉检测：

```powershell
.\scripts\start-windows-ui.ps1 -VisionSource 0 -AutoStartVision
```

设备页右上角的设置按钮会按需扫描摄像头和麦克风。选择结果保存在
`data/media-settings.json`，显式的 `-VisionSource` 和 `-AudioDeviceIndex` 仍优先于保存值。
为避免切换运行中的硬件句柄，保存前需要先停止视觉采集并等待音频采样结束；配置在服务
下次启动时生效。

使用真实麦克风采样、但以 mock 文本验证求助事件接管：

```powershell
.\scripts\start-windows-ui.ps1 -AudioMockText "请帮帮我"
```

声音页的按钮当前执行一次固定时长采样，不是常驻监听。真实 FunASR 需额外安装 `.[asr]` 并传入 `-AudioTranscriber funasr`。界面详细说明见 [ui/README.md](ui/README.md)。

## PC 视觉

先用视频文件验证：

```powershell
python -m tarevis_home_node vision-motion `
  --source path\to\test.avi `
  --target-fps 0 `
  --max-events 1 `
  --sink both
```

使用电脑默认摄像头，并在浏览器查看预览：

```powershell
python -m tarevis_home_node vision-motion `
  --source 0 `
  --max-events 0 `
  --preview-port 8765 `
  --sink both
```

浏览器打开 `http://127.0.0.1:8765/`。按 `Ctrl+C` 停止。

常用调参项：

- `--roi 0,0,1,1`：归一化 `x,y,width,height`。
- `--min-area`：最大运动轮廓最小面积。
- `--min-score`：运动面积占 ROI 的最小比例。
- `--min-consecutive-frames`：连续命中帧数。
- `--cooldown-seconds`：事件冷却时间。
- `--no-snapshots`：关闭触发抓拍。

## PC 音频

不安装 ASR 模型也能用 mock 转写验证事件链：

```powershell
python -m tarevis_home_node audio-file path\to\test.wav `
  --transcriber mock `
  --mock-text "测试求助短语" `
  --sink both
```

使用真实 FunASR：

```powershell
python -m tarevis_home_node audio-file path\to\test.wav `
  --transcriber funasr `
  --funasr-model iic/SenseVoiceSmall
```

列出麦克风：

```powershell
python -m tarevis_home_node audio-devices
```

不保存音频文件，只采集短时输入并输出 RMS/峰值：

```powershell
python -m tarevis_home_node audio-probe --device-index 0 --seconds 0.6
```

录制固定时长并处理：

```powershell
python -m tarevis_home_node audio-record `
  --seconds 5 `
  --output recordings/test.wav `
  --transcriber funasr
```

第一版不做常驻开放式监听。单独的“啊”或裸“疼”不会触发高等级事件；只匹配明确的求助短语。音频文件当前要求是未压缩 PCM WAV。

## 可选目标检测

模型不会自动下载或进入 Git。准备经过许可核验、使用传统 one-to-many 输出的 YOLO ONNX 模型后，可以先做空白帧基准：

```powershell
python -m tarevis_home_node object-benchmark `
  --model models\yolo26n.onnx `
  --labels models\coco80.txt `
  --iterations 5
```

正式基准前先验证同目录模型清单：

```powershell
python -m tarevis_home_node model-verify `
  --manifest path\to\manifest.json
```

使用人物正例图片并要求检出 `person`：

```powershell
python -m tarevis_home_node object-benchmark `
  --model models\yolo26n.onnx `
  --labels models\coco80.txt `
  --image path\to\person-positive.jpg `
  --expect-label person `
  --iterations 20
```

无人物负例使用 `--reject-label person`。基准输出包含平均值、中位数、P95、标准差、吞吐率和最后一轮检测框；断言失败时退出码为 `1`。

运动触发后再运行目标检测：

```powershell
python -m tarevis_home_node vision-motion `
  --source path\to\test.avi `
  --object-model models\yolo26n.onnx `
  --object-labels models\coco80.txt `
  --confirm-label person `
  --max-events 1
```

此链路会输出原始 `motion_detected`；如果二级检测发现 `person`，再输出带模型置信度的 `person_detected`。普通 COCO 模型没有 `box` 或 `package` 类，不能根据文件名假设具备包裹识别能力。

树莓派安装、分项联调和基准记录见 [20260721_树莓派部署与验收指南.md](docs/20260721_树莓派部署与验收指南.md)。

## 测试

```powershell
$env:PYTHONPATH = "src"
python -m unittest discover -s tests -v
```

## 事件原则

底层感知器只描述它实际证明的事实。OpenCV 运动检测只产生 `motion_detected`，不能直接产生快递、访客或跌倒事件。事件中的 `motion_score` 是运动面积比例，不是模型置信度。`fall` mock 场景产生 `fall_suspected`，真实跌倒结论需要后续姿态和时序证据。

详细计划见 [20260721_家庭感知节点迁移分析与开发计划.md](docs/20260721_家庭感知节点迁移分析与开发计划.md)。
