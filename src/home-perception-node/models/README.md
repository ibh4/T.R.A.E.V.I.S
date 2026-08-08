# Models

模型文件默认不提交到 Git。

引入任意模型前，需要在本文件记录：

- 模型名称和准确版本。
- 官方来源地址。
- 许可证。
- 文件名和 SHA-256。
- 输入尺寸、颜色空间和归一化方式。
- 标签表来源。
- PC 与树莓派的运行时和基准结果。

正式候选模型还应在模型文件同目录提供 JSON 清单，并先执行：

```powershell
python -m tarevis_home_node model-verify --manifest path\to\manifest.json
```

清单格式：

```json
{
  "schema_version": "1.0",
  "model_id": "vendor-model-name",
  "version": "exact-version",
  "source_url": "https://official.example/model",
  "license": "SPDX or exact license name",
  "model_file": "model.onnx",
  "model_sha256": "64_HEX_CHARACTERS",
  "labels_file": "labels.txt",
  "labels_sha256": "64_HEX_CHARACTERS",
  "input_width": 640,
  "input_height": 640,
  "class_count": 80,
  "task": "object_detection",
  "format": "onnx"
}
```

`model-verify` 会同时验证模型哈希、标签哈希和标签数量。未通过时退出码为 `1`，不会进入正式基准或交付记录。

## 当前基线：Ultralytics YOLO26n Detect 640

2026-08-02 选择 YOLO26n 作为 PC 与树莓派的统一人物检测候选。模型二进制只保存在本机，Git 仅提交清单与本节记录。

| 字段 | 值 |
| --- | --- |
| 上游权重 | `yolo26n.pt`，Ultralytics assets `v8.4.0` |
| 官方来源 | `https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt` |
| 上游权重 SHA-256 | `9B09CC8BF347F0FC8A5F7657480587F25DB09B34BF33B0652110FB03A8AD4FEF` |
| 上游权重大小 | 5,544,453 bytes |
| 许可证 | AGPL-3.0；闭源或商业使用需另行核验 Ultralytics Enterprise 条款 |
| 导出器 | Ultralytics `8.4.108`、Torch `2.7.1+cu128`、ONNX `1.19.1` |
| 导出参数 | ONNX、FP32、静态 `640x640`、opset 17、`end2end=False`、`simplify=False` |
| ONNX 输出 | `(1, 84, 8400)`，4 个框参数 + 80 类分数，需要外部 NMS |
| ONNX SHA-256 | `ECB35FA67F893AF1FDDCFEB5816F3332C43254BFBCEC1745ACE500222EAA54D7` |
| ONNX 大小 | 9,884,242 bytes |
| 标签 | 本仓库 `coco80.txt`，顺序与权重内嵌 80 类名称一致 |
| 清单 | `yolo26n-640.manifest.json` |

导出命令的关键参数：

```python
YOLO("yolo26n.pt").export(
    format="onnx",
    imgsz=640,
    end2end=False,
    simplify=False,
    dynamic=False,
    opset=17,
    device="cpu",
)
```

`end2end=False` 不能省略。YOLO26 默认端到端输出为 `(N, 300, 6)`，当前 OpenCV 解析器只接受传统的 `(N, 84, 8400)` 输出。

### Windows PC 基准

环境：AMD Ryzen 7 5800X3D、Python 3.11.9、OpenCV 4.10.0、NumPy 2.2.1。推理由现有 OpenCV DNN 适配器执行，不依赖 Torch。

| 样本 | 迭代 | 平均耗时 | P95 | 吞吐率 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 640x640 全黑负例 | 20 | 87.225 ms | 96.883 ms | 11.465 FPS | `person` 不存在，通过 |
| Ultralytics `bus.jpg` 人物正例 | 20 | 85.403 ms | 91.509 ms | 11.709 FPS | 4 `person` + 1 `bus`，通过 |

人物正例最高置信度为 `0.854796`。这些数字只代表当前 Windows PC；树莓派 4B 的速度、温度、内存和真实摄像头精度仍待实机验收。普通 person 检测不能作为跌倒结论，后续跌倒能力仍需 pose 与时序逻辑，并且只能输出 `fall_suspected`。

## 旧仓库候选模型探测

旧项目中的 `yolov8n.onnx` 不迁移，只记录当前只读探测结果：

| 字段 | 值 |
| --- | --- |
| 文件大小 | 12,769,720 bytes |
| SHA-256 | `DD48A79DD7FEC8CA25FDE4ECA742FF7BCA23B27E2E903EB23BC1D9F83A459BD2` |
| OpenCV 输出 | `(1, 84, 8400)` |
| 推断结构 | 4 个框参数 + 80 类分数 |
| 原始来源 | 未知，来自旧项目仓库 |
| 许可证 | 未核验 |
| 当前状态 | 仅作为本机兼容性候选，不重新分发 |

仓库中的 `coco80.txt` 只是标准 COCO 80 类标签候选。只有确认模型来源和标签对应关系后，才可以把该模型用于正式演示或分发。
