"""
TRAE Proj Monitor - TRAE WORK 任务列表监控模块

通过截图 + OCR 技术提取 TRAE WORK 左侧任务列表。
"""

from .capture import capture_trae_window, find_trae_windows
from .ocr_extractor import extract_text_with_easyocr
from .task_parser import parse_tasks_from_ocr

__version__ = "0.1.0"
__all__ = [
    "capture_trae_window",
    "find_trae_windows",
    "extract_text_with_easyocr",
    "parse_tasks_from_ocr",
]
