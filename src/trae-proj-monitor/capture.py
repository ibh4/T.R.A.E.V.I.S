"""
窗口截图模块 - 截取 TRAE WORK 应用窗口

支持 Windows 平台，使用 PIL + PowerShell 方式获取窗口位置并截图。
"""

import os
import subprocess
from PIL import ImageGrab, Image


def find_trae_windows():
    """
    查找所有 TRAE 相关的窗口

    Returns:
        list: 窗口信息列表，每个元素包含 hwnd, title, left, top, width, height, visible
    """
    result = subprocess.run(
        ['powershell', '-Command', '''
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class WinAPI {
            [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
            [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
            [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
            [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hwnd, StringBuilder lpString, int nMaxCount);
        }
        public struct RECT { public int Left, Top, Right, Bottom; }
"@

        Get-Process | Where-Object { $_.MainWindowTitle -like "*Trae*" -or $_.MainWindowTitle -like "*TRAE*" } | ForEach-Object {
            $hwnd = $_.MainWindowHandle
            $title = $_.MainWindowTitle

            $visible = [WinAPI]::IsWindowVisible($hwnd)

            $r = New-Object RECT
            [WinAPI]::GetWindowRect($hwnd, [ref]$r)

            $width = $r.Right - $r.Left
            $height = $r.Bottom - $r.Top

            Write-Output "$hwnd|$title|$($r.Left)|$($r.Top)|$width|$height|$visible"
        }
        '''],
        capture_output=True,
        text=True
    )

    windows = []
    for line in result.stdout.strip().split('\n'):
        if line and '|' in line:
            parts = line.split('|')
            if len(parts) >= 7:
                try:
                    windows.append({
                        'hwnd': parts[0],
                        'title': parts[1],
                        'left': int(parts[2]),
                        'top': int(parts[3]),
                        'width': int(parts[4]),
                        'height': int(parts[5]),
                        'visible': parts[6] == 'True'
                    })
                except ValueError:
                    pass

    return windows


def capture_full_screen():
    """
    截取整个屏幕

    Returns:
        PIL.Image: 屏幕截图
    """
    return ImageGrab.grab()


def capture_window_by_rect(left, top, width, height):
    """
    根据坐标截取指定区域

    Args:
        left: 左边界
        top: 上边界
        width: 宽度
        height: 高度

    Returns:
        PIL.Image: 裁剪后的图像
    """
    screenshot = ImageGrab.grab()
    cropped = screenshot.crop((left, top, left + width, top + height))
    return cropped


def capture_trae_window(output_dir=None, panel_width_ratio=0.2):
    """
    截取 TRAE WORK 窗口并裁剪左侧任务面板

    Args:
        output_dir: 输出目录，为 None 则不保存文件
        panel_width_ratio: 左侧任务面板占窗口宽度的比例

    Returns:
        tuple: (full_window_img, panel_img, window_info)
            - full_window_img: 完整窗口截图 (PIL.Image)
            - panel_img: 左侧任务面板截图 (PIL.Image)
            - window_info: 窗口信息字典
    """
    windows = find_trae_windows()

    if not windows:
        raise RuntimeError("未找到 TRAE WORK 窗口，请确保 TRAE WORK 正在运行")

    # 选择第一个可见的大窗口
    target_window = None
    for win in windows:
        if win['visible'] and win['width'] > 400 and win['height'] > 300:
            target_window = win
            break

    if target_window is None:
        target_window = windows[0]

    # 截取完整窗口
    full_img = capture_window_by_rect(
        target_window['left'],
        target_window['top'],
        target_window['width'],
        target_window['height']
    )

    # 裁剪左侧任务面板（默认左 20% 宽度）
    panel_width = int(target_window['width'] * panel_width_ratio)
    panel_img = full_img.crop((0, 0, panel_width, target_window['height']))

    # 保存文件
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        full_path = os.path.join(output_dir, 'trae_work_window.png')
        panel_path = os.path.join(output_dir, 'trae_work_task_panel.png')
        full_img.save(full_path)
        panel_img.save(panel_path)

    return full_img, panel_img, target_window


def enhance_image(img, contrast_factor=2.0, sharpness_factor=1.5):
    """
    增强图像质量，提高 OCR 识别率

    Args:
        img: PIL.Image 对象
        contrast_factor: 对比度增强系数
        sharpness_factor: 锐化系数

    Returns:
        PIL.Image: 增强后的图像
    """
    from PIL import ImageEnhance, ImageFilter

    # 增强对比度
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(contrast_factor)

    # 锐化
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(sharpness_factor)

    return img
