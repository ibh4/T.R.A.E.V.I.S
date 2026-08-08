# TRAE Proj Monitor

通过**截图 + OCR** 技术提取 TRAE WORK 左侧任务列表的 Python 模块。

## 功能特性

- 自动查找并截取 TRAE WORK 窗口
- 裁剪左侧任务面板区域
- 使用 EasyOCR 进行中英文文本识别
- 智能解析项目分组和任务列表
- 输出结构化的 JSON 数据

## 环境要求

- **操作系统**: Windows 10/11（使用 Windows API 查找窗口）
- **Python**: 3.9 及以上
- **网络**: 首次运行需下载 OCR 模型文件（约 100MB）

## 快速开始

### 1. 安装依赖

```bash
# 进入模块目录
cd src/trae-proj-monitor

# 创建虚拟环境（推荐）
python -m venv .venv
.venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

> **注意**: 如果下载速度慢，可以使用国内镜像源：
> ```bash
> pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```

### 2. 运行示例

确保 TRAE WORK 正在运行，然后执行：

```bash
cd examples
python extract_tasks.py
```

首次运行会自动下载 OCR 模型，请耐心等待。

### 3. 查看结果

运行成功后，在 `examples/output/` 目录下会生成：

| 文件 | 说明 |
|------|------|
| `trae_work_window.png` | 完整的 TRAE WORK 窗口截图 |
| `trae_work_task_panel.png` | 裁剪后的左侧任务面板 |
| `ocr_raw.json` | OCR 原始识别结果 |
| `tasks_result.json` | 结构化的任务列表 |

## 集成使用

### 基本用法

```python
import sys
sys.path.insert(0, 'path/to/trae-proj-monitor')

from capture import capture_trae_window
from ocr_extractor import extract_text_with_easyocr
from task_parser import parse_tasks_from_ocr, print_task_list

# 1. 截取窗口
full_img, panel_img, window_info = capture_trae_window(output_dir='./output')

# 2. OCR 识别
ocr_results = extract_text_with_easyocr(panel_img, model_dir='./output/.EasyOCR/model')

# 3. 解析任务
tasks = parse_tasks_from_ocr(
    ocr_results,
    known_projects=['Trae_proj', 'TRAE_Music', 'HeartNote']
)

# 4. 打印结果
print_task_list(tasks)
```

### API 说明

#### capture.py - 窗口截图模块

**`find_trae_windows()`**

查找所有 TRAE 相关的窗口。

返回：窗口信息列表，每个元素包含 `hwnd`, `title`, `left`, `top`, `width`, `height`, `visible`。

---

**`capture_trae_window(output_dir=None, panel_width_ratio=0.2)`**

截取 TRAE WORK 窗口并裁剪左侧任务面板。

参数：
- `output_dir`: 输出目录，为 None 则不保存文件
- `panel_width_ratio`: 左侧任务面板占窗口宽度的比例（默认 0.2）

返回：`(full_window_img, panel_img, window_info)` 元组

---

**`enhance_image(img, contrast_factor=2.0, sharpness_factor=1.5)`**

增强图像质量，提高 OCR 识别率。

---

#### ocr_extractor.py - OCR 提取模块

**`extract_text_with_easyocr(image_source, model_dir=None, languages=None, gpu=False, output_raw_path=None)`**

使用 EasyOCR 提取图像中的文本。

参数：
- `image_source`: 图像路径或 PIL.Image 对象
- `model_dir`: 模型存储目录（默认 `./.EasyOCR/model`）
- `languages`: 识别语言列表（默认 `['ch_sim', 'en']`）
- `gpu`: 是否使用 GPU（默认 False）
- `output_raw_path`: 原始结果保存路径（JSON 格式）

返回：OCR 结果列表，每个元素包含：
- `text`: 识别的文本
- `confidence`: 置信度 (0-1)
- `bbox`: 文本框坐标

---

**`sort_ocr_results_by_position(ocr_results, direction='vertical')`**

按位置排序 OCR 结果。

---

**`filter_low_confidence(ocr_results, min_confidence=0.3)`**

过滤低置信度的结果。

---

#### task_parser.py - 任务解析模块

**`parse_tasks_from_ocr(ocr_results, known_projects=None, skip_keywords=None, min_confidence=0.3)`**

从 OCR 结果解析出结构化的任务列表。

参数：
- `ocr_results`: OCR 结果列表
- `known_projects`: 已知的项目名称列表（用于识别项目分组）
- `skip_keywords`: 跳过的关键词列表
- `min_confidence`: 最小置信度阈值

返回：任务列表，每个元素包含 `type`（'project' 或 'task'）、`name`、`project`、`confidence`

---

**`get_project_task_map(tasks)`**

将任务列表转换为按项目分组的字典。

---

**`print_task_list(tasks)`**

美观地打印任务列表。

## 自定义配置

### 添加项目名称

如果你的项目不在默认列表中，可以在解析时指定：

```python
tasks = parse_tasks_from_ocr(
    ocr_results,
    known_projects=['我的项目A', '我的项目B', 'Trae_proj']
)
```

### 调整面板宽度

如果任务面板占比不是 20%，可以调整：

```python
full_img, panel_img, info = capture_trae_window(
    output_dir='./output',
    panel_width_ratio=0.25  # 调整为 25%
)
```

### 提高识别准确率

```python
from capture import enhance_image

# 先增强图像再识别
enhanced_img = enhance_image(panel_img, contrast_factor=2.5, sharpness_factor=2.0)
ocr_results = extract_text_with_easyocr(enhanced_img)
```

## 常见问题

### Q: 提示"未找到 TRAE WORK 窗口"

A: 请确保：
1. TRAE WORK 正在运行
2. 窗口没有最小化
3. 窗口标题包含 "Trae" 或 "TRAE" 字样

### Q: OCR 识别准确率不高

A: 可以尝试以下方法：
1. 调整 `panel_width_ratio`，确保任务面板裁剪准确
2. 使用 `enhance_image()` 增强图像
3. 调整 `min_confidence` 阈值
4. 窗口字体较小的话，可以放大图像后再识别

### Q: 首次运行很慢

A: 首次运行需要下载 OCR 模型文件（约 100MB），请耐心等待。后续运行会直接使用本地缓存的模型。

### Q: 可以在 Linux/Mac 上运行吗？

A: 窗口查找功能目前只支持 Windows（使用了 Windows API）。OCR 识别部分是跨平台的。如果需要在其他平台使用，可以自行实现截图部分，然后调用 OCR 和解析模块。

## 目录结构

```
trae-proj-monitor/
├── __init__.py          # 模块入口
├── capture.py           # 窗口截图模块
├── ocr_extractor.py     # OCR 提取模块
├── task_parser.py       # 任务解析模块
├── requirements.txt     # 依赖列表
├── README.md            # 使用文档
└── examples/
    └── extract_tasks.py # 完整使用示例
```

## 技术栈

- [EasyOCR](https://github.com/JaidedAI/EasyOCR) - 开源 OCR 引擎
- [Pillow](https://python-pillow.org/) - 图像处理
- [PyTorch](https://pytorch.org/) - 深度学习框架（EasyOCR 依赖）

## License

MIT
