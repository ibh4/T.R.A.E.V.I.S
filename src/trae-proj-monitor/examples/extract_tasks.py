"""
示例：一键提取 TRAE WORK 任务列表

运行前请确保：
1. TRAE WORK 正在运行
2. 已安装依赖（pip install -r requirements.txt）
3. 首次运行需要下载 OCR 模型，请确保网络畅通
"""

import os
import sys
import json
import time

# 添加模块路径（如果模块不在 Python 路径中）
module_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if module_path not in sys.path:
    sys.path.insert(0, module_path)

from capture import capture_trae_window, enhance_image
from ocr_extractor import extract_text_with_easyocr
from task_parser import parse_tasks_from_ocr, print_task_list, get_project_task_map


def main():
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
    os.makedirs(output_dir, exist_ok=True)

    print("=" * 60)
    print("TRAE WORK 任务列表提取工具")
    print("=" * 60)

    # 步骤 1：截取 TRAE WORK 窗口
    print("\n[1/3] 截取 TRAE WORK 窗口...")
    try:
        full_img, panel_img, window_info = capture_trae_window(
            output_dir=output_dir,
            panel_width_ratio=0.2
        )
        print(f"  窗口标题: {window_info['title']}")
        print(f"  窗口大小: {window_info['width']}x{window_info['height']}")
        print(f"  完整截图: {os.path.join(output_dir, 'trae_work_window.png')}")
        print(f"  任务面板: {os.path.join(output_dir, 'trae_work_task_panel.png')}")
    except Exception as e:
        print(f"  截图失败: {e}")
        print("  请确保 TRAE WORK 正在运行且窗口可见")
        return

    # 步骤 2：OCR 文本提取
    print("\n[2/3] OCR 文本识别中（首次运行需下载模型，请耐心等待）...")
    model_dir = os.path.join(output_dir, '.EasyOCR', 'model')
    raw_result_path = os.path.join(output_dir, 'ocr_raw.json')

    try:
        ocr_results = extract_text_with_easyocr(
            panel_img,
            model_dir=model_dir,
            output_raw_path=raw_result_path
        )
        print(f"  识别到 {len(ocr_results)} 个文本区域")
        print(f"  原始结果: {raw_result_path}")
    except Exception as e:
        print(f"  OCR 识别失败: {e}")
        return

    # 步骤 3：解析任务列表
    print("\n[3/3] 解析任务列表...")
    known_projects = ['Trae_proj', 'TRAE_Music', 'HeartNote']

    tasks = parse_tasks_from_ocr(
        ocr_results,
        known_projects=known_projects,
        min_confidence=0.3
    )

    # 保存最终结果
    result = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'window_info': window_info,
        'ocr_count': len(ocr_results),
        'tasks_count': len(tasks),
        'tasks': tasks,
        'project_map': get_project_task_map(tasks)
    }

    result_path = os.path.join(output_dir, 'tasks_result.json')
    with open(result_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"  最终结果: {result_path}")

    # 打印任务列表
    print("\n")
    print_task_list(tasks)

    print(f"\n结果文件已保存到: {output_dir}")
    print("- trae_work_window.png - 完整窗口截图")
    print("- trae_work_task_panel.png - 左侧任务面板")
    print("- ocr_raw.json - OCR 原始识别结果")
    print("- tasks_result.json - 结构化任务列表")


if __name__ == "__main__":
    main()
