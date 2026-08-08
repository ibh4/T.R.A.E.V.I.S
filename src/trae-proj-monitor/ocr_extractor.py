"""
OCR 提取模块 - 使用 EasyOCR 提取图像中的文本

支持中英文识别，首次运行会自动下载模型文件。
"""

import os
import json
from typing import List, Dict, Union, Optional
from PIL import Image


def extract_text_with_easyocr(
    image_source: Union[str, Image.Image],
    model_dir: Optional[str] = None,
    languages: Optional[List[str]] = None,
    gpu: bool = False,
    output_raw_path: Optional[str] = None
) -> List[Dict]:
    """
    使用 EasyOCR 提取图像中的文本

    Args:
        image_source: 图像路径或 PIL.Image 对象
        model_dir: 模型存储目录，默认在当前目录下的 .EasyOCR/model
        languages: 识别语言列表，默认 ['ch_sim', 'en'] (简体中文+英文)
        gpu: 是否使用 GPU，默认 False
        output_raw_path: 原始 OCR 结果保存路径（JSON 格式），为 None 则不保存

    Returns:
        list: OCR 结果列表，每个元素包含:
            - text: 识别的文本
            - confidence: 置信度 (0-1)
            - bbox: 文本框坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    """
    import easyocr

    if languages is None:
        languages = ['ch_sim', 'en']

    # 设置模型存储目录
    if model_dir is None:
        model_dir = os.path.join(os.getcwd(), '.EasyOCR', 'model')
    os.makedirs(model_dir, exist_ok=True)

    # 创建 OCR reader
    reader = easyocr.Reader(languages, gpu=gpu, model_storage_directory=model_dir)

    # 读取图像
    if isinstance(image_source, str):
        results = reader.readtext(image_source)
    else:
        import numpy as np
        img_array = np.array(image_source)
        results = reader.readtext(img_array)

    # 格式化结果
    texts = []
    for (bbox, text, confidence) in results:
        texts.append({
            'text': text,
            'confidence': float(confidence),
            'bbox': [[float(point[0]), float(point[1])] for point in bbox]
        })

    # 保存原始结果
    if output_raw_path:
        os.makedirs(os.path.dirname(output_raw_path), exist_ok=True)
        with open(output_raw_path, 'w', encoding='utf-8') as f:
            json.dump(texts, f, indent=2, ensure_ascii=False)

    return texts


def sort_ocr_results_by_position(
    ocr_results: List[Dict],
    direction: str = 'vertical'
) -> List[Dict]:
    """
    按位置排序 OCR 结果

    Args:
        ocr_results: OCR 结果列表
        direction: 排序方向，'vertical' 按从上到下，'horizontal' 按从左到右

    Returns:
        list: 排序后的 OCR 结果
    """
    if direction == 'vertical':
        # 按 y 坐标排序（取文本框的中间 y 值）
        return sorted(
            ocr_results,
            key=lambda x: (x['bbox'][0][1] + x['bbox'][2][1]) / 2
        )
    else:
        # 按 x 坐标排序
        return sorted(
            ocr_results,
            key=lambda x: (x['bbox'][0][0] + x['bbox'][2][0]) / 2
        )


def filter_low_confidence(
    ocr_results: List[Dict],
    min_confidence: float = 0.3
) -> List[Dict]:
    """
    过滤低置信度的 OCR 结果

    Args:
        ocr_results: OCR 结果列表
        min_confidence: 最小置信度阈值

    Returns:
        list: 过滤后的 OCR 结果
    """
    return [r for r in ocr_results if r['confidence'] >= min_confidence]
