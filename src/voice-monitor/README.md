# 中文唤醒词监听器

更新日期：2026-08-01

这是一个在 Windows/macOS/Linux 桌面端运行的离线中文唤醒词监听器。它使用 sherpa-onnx 的开放词汇 KWS，不需要为每个新唤醒词重新训练模型；完成首次依赖和模型准备后，推理过程不需要网络。

## 快速开始

推荐使用 Python 3.10 至 3.12。在本目录打开 PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python setup.py
python voice_monitor.py
```

说出默认唤醒词“摔倒”或“哎呀”后，标准输出会产生一行 JSON：

```json
{"type":"wake_word","keyword":"摔倒","detected_at":"2026-08-01T12:00:00+00:00"}
```

运行日志写到标准错误，事件写到标准输出，因此其他进程可以稳定地逐行消费事件。

如果需要确认麦克风和 KWS 一直在工作，可以打开详细输出：

```powershell
python voice_monitor.py --verbose
```

此时每次 KWS 解码都会在标准错误输出 `[KWS] <未命中>` 或命中的词条；标准输出仍然只保留 JSON 唤醒事件。

## 修改唤醒词

编辑 `keywords_raw.txt`，每行一个词条：

```text
摔倒 :2.0 #0.25 @摔倒
哎呀 :2.0 #0.25 @哎呀
泰瑞泰瑞 :2.0 #0.25 @泰瑞泰瑞
```

然后重新生成词元文件并启动：

```powershell
python setup.py --skip-download
python voice_monitor.py
```

各字段含义：

- 中文短语：实际说出的内容，建议使用 4 至 6 个音节以降低误唤醒。
- `:2.0`：该词条的 boosting score，越大越容易进入候选路径。
- `#0.25`：触发概率阈值，越低越灵敏，也越容易误触发。
- `@摔倒`：检测成功后返回的名称；拼音模型要求必须提供，且不能含空格。

“摔倒”和“哎呀”只有两个音节，环境噪声或普通对话可能更容易误唤醒；误触发较多时，建议将 `#0.25` 提高到 `#0.35` 或更高。

## 麦克风选择

列出所有输入设备：

```powershell
python voice_monitor.py --list-devices
```

把设备编号或设备名写入 `config.json` 的 `audio.device`。`null` 表示系统默认麦克风。

## 灵敏度调节

先针对单个词条调整 `keywords_raw.txt` 中的 `:score` 和 `#threshold`。全局默认值位于 `config.json` 的 `kws` 段，仅对没有单独指定参数的词条生效。

- 漏唤醒较多：逐步降低 threshold，例如从 `0.25` 调到 `0.20`。
- 误唤醒较多：逐步提高 threshold，例如从 `0.25` 调到 `0.35`。
- 相似词很多：把 `num_trailing_blanks` 从 `1` 调高到 `2` 至 `4`，代价是触发稍慢。

## 验证

不需要模型和麦克风即可运行单元测试：

```powershell
python -m unittest -v
```

本实现使用约 5 MB 的 int8 encoder/joiner 和 fp32 decoder，以减小 CPU 与内存开销。模型目录被 Git 忽略，不会误提交大型二进制文件。

注意：KWS 只检测 `keywords_raw.txt` 中配置的唤醒词，不会持续转写任意中文语句。若需要完整语音转文字，需要另接 sherpa-onnx ASR 模型。
