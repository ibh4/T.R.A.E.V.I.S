"""
任务解析模块 - 从 OCR 结果中解析出结构化的任务列表

根据 TRAE WORK 的界面特征，识别项目分组和任务项。
"""

import re
from typing import List, Dict, Optional


# 默认的跳过关键词（界面元素，不是任务）
DEFAULT_SKIP_KEYWORDS = [
    'TRAE', 'Work', 'Code', 'CN', '工作区',
    '设置', '帮助', '新建任务', '任务列表',
    '自动化', '技能', '话', '中车工', '下公任务',
    'PRO', 'Universa', 'JisplaySe',
]

# 默认的已知项目名称（用于识别项目分组）
DEFAULT_KNOWN_PROJECTS = [
    'Trae_proj', 'TRAE_Music', 'HeartNote',
]


def is_project_header(text: str, known_projects: Optional[List[str]] = None) -> bool:
    """
    判断文本是否是项目分组标题

    Args:
        text: 待判断的文本
        known_projects: 已知的项目名称列表

    Returns:
        bool: 是否是项目分组
    """
    if known_projects is None:
        known_projects = DEFAULT_KNOWN_PROJECTS

    text_clean = text.strip()

    # 精确匹配或包含已知项目名
    for proj in known_projects:
        if proj.lower() in text_clean.lower():
            return True

    return False


def should_skip_text(text: str, skip_keywords: Optional[List[str]] = None, min_length: int = 5) -> bool:
    """
    判断是否应该跳过该文本（非任务内容）

    Args:
        text: 待判断的文本
        skip_keywords: 跳过关键词列表
        min_length: 最小文本长度

    Returns:
        bool: 是否应该跳过
    """
    if skip_keywords is None:
        skip_keywords = DEFAULT_SKIP_KEYWORDS

    text_clean = text.strip()

    # 太短的跳过
    if len(text_clean) < min_length:
        return True

    # 包含跳过关键词的跳过
    for kw in skip_keywords:
        if kw in text_clean and len(text_clean) < 20:
            return True

    return False


def clean_task_text(text: str) -> str:
    """
    清理任务文本，去除 OCR 识别噪声

    Args:
        text: 原始文本

    Returns:
        str: 清理后的文本
    """
    # 去除首尾空白
    text = text.strip()

    # 去除开头的特殊符号（OCR 误识别的图标）
    text = re.sub(r'^[〈口\s]+', '', text)

    # 去除结尾的特殊符号
    text = re.sub(r'[〈口\s]+$', '', text)

    return text.strip()


def parse_tasks_from_ocr(
    ocr_results: List[Dict],
    known_projects: Optional[List[str]] = None,
    skip_keywords: Optional[List[str]] = None,
    min_confidence: float = 0.3
) -> List[Dict]:
    """
    从 OCR 结果解析出结构化的任务列表

    Args:
        ocr_results: OCR 结果列表（需已按位置排序）
        known_projects: 已知的项目名称列表
        skip_keywords: 跳过关键词列表
        min_confidence: 最小置信度

    Returns:
        list: 解析后的任务列表，每个元素包含:
            - type: 'project' 或 'task'
            - name: 名称
            - project: 所属项目（仅 task 类型有）
            - confidence: 置信度
    """
    from .ocr_extractor import sort_ocr_results_by_position, filter_low_confidence

    # 过滤低置信度
    filtered = filter_low_confidence(ocr_results, min_confidence)

    # 按垂直位置排序
    sorted_results = sort_ocr_results_by_position(filtered, direction='vertical')

    tasks = []
    current_project = ""

    for item in sorted_results:
        text = item['text']
        confidence = item['confidence']

        # 清理文本
        clean_text = clean_task_text(text)
        if not clean_text:
            continue

        # 判断是否是项目分组
        if is_project_header(clean_text, known_projects):
            current_project = clean_text
            tasks.append({
                'type': 'project',
                'name': clean_text,
                'project': '',
                'confidence': confidence
            })
            continue

        # 判断是否应该跳过
        if should_skip_text(clean_text, skip_keywords):
            continue

        # 作为任务添加
        tasks.append({
            'type': 'task',
            'name': clean_text,
            'project': current_project,
            'confidence': confidence
        })

    return tasks


def get_project_task_map(tasks: List[Dict]) -> Dict[str, List[Dict]]:
    """
    将任务列表转换为按项目分组的字典

    Args:
        tasks: 解析后的任务列表

    Returns:
        dict: 项目 -> 任务列表 的映射
    """
    project_map = {}
    current_project = "未分组"

    for task in tasks:
        if task['type'] == 'project':
            current_project = task['name']
            if current_project not in project_map:
                project_map[current_project] = []
        elif task['type'] == 'task':
            proj = task.get('project') or current_project
            if proj not in project_map:
                project_map[proj] = []
            project_map[proj].append(task)

    return project_map


def print_task_list(tasks: List[Dict]):
    """
    美观地打印任务列表

    Args:
        tasks: 解析后的任务列表
    """
    print("=" * 60)
    print("TRAE WORK 任务列表")
    print("=" * 60)

    for task in tasks:
        if task['type'] == 'project':
            print(f"\n📁 {task['name']}")
        else:
            proj_info = f" [{task['project']}]" if task.get('project') else ""
            conf = f" ({task['confidence']:.0%})" if task.get('confidence') else ""
            print(f"  • {task['name']}{proj_info}{conf}")

    total_tasks = sum(1 for t in tasks if t['type'] == 'task')
    total_projects = sum(1 for t in tasks if t['type'] == 'project')
    print(f"\n总计: {total_projects} 个项目, {total_tasks} 个任务")
