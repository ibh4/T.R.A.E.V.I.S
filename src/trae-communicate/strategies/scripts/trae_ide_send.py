#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path


def import_deps():
    try:
        import pyautogui
        import pyperclip
        from pywinauto import Desktop
        from pywinauto.findwindows import ElementNotFoundError
        try:
            from pywinauto.win32functions import ShowWindow, SW_RESTORE
        except ImportError:
            import win32con
            from pywinauto.win32functions import ShowWindow
            SW_RESTORE = win32con.SW_RESTORE
        return {
            "pyautogui": pyautogui,
            "pyperclip": pyperclip,
            "Desktop": Desktop,
            "ElementNotFoundError": ElementNotFoundError,
            "ShowWindow": ShowWindow,
            "SW_RESTORE": SW_RESTORE,
        }
    except ImportError as exc:
        print(f"ERROR: missing dependency: {exc}")
        print("Please install: pip install pyautogui pywinauto pyperclip pywin32")
        sys.exit(1)


def clean_text(value):
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def collect_visible_texts(window):
    texts = []
    seen = set()
    nodes = [window]
    try:
        nodes.extend(window.descendants())
    except Exception:
        pass

    for node in nodes:
        values = []
        try:
            values.append(node.window_text())
        except Exception:
            pass
        try:
            values.append(node.element_info.name)
        except Exception:
            pass
        for value in values:
            text = clean_text(value)
            if text and text not in seen:
                seen.add(text)
                texts.append(text)
    return texts


def likely_response_texts(before_texts, after_texts, prompt):
    before = set(before_texts)
    prompt_norm = clean_text(prompt)
    candidates = []

    ignored_exact = {
        "",
        "最小化",
        "最大化",
        "关闭",
        "TRAE Work CN",
    }

    for text in after_texts:
        if text in before:
            continue
        if text in ignored_exact:
            continue
        if prompt_norm and (text == prompt_norm or prompt_norm in text):
            continue
        if len(text) < 2:
            continue
        candidates.append(text)

    candidates.sort(key=len, reverse=True)
    return candidates[:8]


def capture_window_bmp(window, evidence_dir, crop_right_ratio=0.45):
    try:
        import win32con
        import win32gui
        import win32ui
    except ImportError:
        return None

    evidence_path = Path(evidence_dir)
    evidence_path.mkdir(parents=True, exist_ok=True)
    filename = f"trae-result-{datetime.now().strftime('%Y%m%d-%H%M%S')}.bmp"
    output_path = evidence_path / filename

    hwnd = window.handle
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    full_width = max(1, right - left)
    height = max(1, bottom - top)
    if crop_right_ratio and 0 < crop_right_ratio < 1:
        width = max(1, int(full_width * crop_right_ratio))
        left = right - width
    else:
        width = full_width

    desktop_hwnd = None
    desktop_dc = None
    mfc_dc = None
    save_dc = None
    bitmap = None
    try:
        desktop_hwnd = win32gui.GetDesktopWindow()
        desktop_dc = win32gui.GetWindowDC(desktop_hwnd)
        mfc_dc = win32ui.CreateDCFromHandle(desktop_dc)
        save_dc = mfc_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(mfc_dc, width, height)
        save_dc.SelectObject(bitmap)
        save_dc.BitBlt((0, 0), (width, height), mfc_dc, (left, top), win32con.SRCCOPY)
        bitmap.SaveBitmapFile(save_dc, str(output_path))
        return str(output_path)
    except Exception:
        return None
    finally:
        try:
            if bitmap is not None:
                win32gui.DeleteObject(bitmap.GetHandle())
            if save_dc is not None:
                save_dc.DeleteDC()
            if mfc_dc is not None:
                mfc_dc.DeleteDC()
            if desktop_dc is not None:
                win32gui.ReleaseDC(desktop_hwnd, desktop_dc)
        except Exception:
            pass


def normalize_ocr_text(text):
    if not text:
        return ""
    value = text.replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", value)
    value = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[，。！？、：；])", "", value)
    value = re.sub(r"(?<=[，。！？、：；])\s+(?=[\u3400-\u9fff])", "", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def compact_text(text):
    return re.sub(r"[\s，。,.、：:；;！!？?（）()\[\]【】_·\\/\-—]+", "", text or "")


def find_fuzzy_prompt_span(text, prompt, min_ratio=0.72):
    target = compact_text(prompt)
    if len(target) < 4:
        return None

    best = None
    min_len = max(2, len(target) - 3)
    max_len = len(target) + 4
    for start in range(len(text)):
        for raw_len in range(min_len, max_len + 1):
            end = min(len(text), start + raw_len)
            candidate = compact_text(text[start:end])
            if not candidate:
                continue
            ratio = SequenceMatcher(None, target, candidate).ratio()
            if best is None or ratio > best[0] or (ratio == best[0] and start > best[1]):
                best = (ratio, start, end)

    if best and best[0] >= min_ratio:
        return best[1], best[2]
    return None


def extract_answer_block(text):
    value = normalize_ocr_text(text)
    if not value:
        return ""

    trae_idx = value.find("TRAE")
    if trae_idx >= 0:
        value = value[trae_idx + len("TRAE"):]

    for marker in ["@Agent", "您正在与 Agent 聊天", "正在与 Agent 聊天", "ratma", "UTF-8"]:
        marker_idx = value.find(marker)
        if marker_idx > 0:
            value = value[:marker_idx]

    start_markers = [
        "项目进度",
        "已完成",
        "所有验收",
        "后端",
        "前端",
        "待办事项",
        "当前无待办任务",
        "下一步建议",
        "Composition",
    ]
    starts = [value.find(marker) for marker in start_markers if value.find(marker) >= 0]
    if starts:
        value = value[min(starts):]

    done_idx = value.rfind("任务完成")
    if done_idx > 0:
        value = value[: done_idx + len("任务完成")]

    return normalize_ocr_text(value)[:4000]


def response_looks_bad(text, min_compact_len=20):
    compact = compact_text(text)
    if len(compact) < min_compact_len:
        return True
    footer_words = ["聊天", "ratma", "UTF8", "Markdown", "Auto"]
    if sum(1 for word in footer_words if word in text) >= 2:
        return True

    # This is the static Agent welcome screen, not a response to the prompt.
    welcome_markers = [
        "轻松应对复杂项目开发",
        "智能任务规划",
        "自主编排智能体",
        "AI专家团队协同开发",
        "升级权益",
    ]
    return any(compact_text(marker) in compact for marker in welcome_markers)


def extract_latest_agent_response(lines, image_width=None, image_height=None):
    normalized = []
    for line in lines or []:
        text = normalize_ocr_text(line.get("text"))
        try:
            x = float(line.get("x", 0))
            y = float(line.get("y", 0))
        except (TypeError, ValueError):
            continue
        if text:
            normalized.append({"text": text, "x": x, "y": y})

    def is_completion_line(line):
        compact = compact_text(line["text"])
        return (
            "任务完成" in compact
            or (compact.endswith("完成") and len(compact) <= 12)
        )

    def is_boundary_line(line):
        compact = compact_text(line["text"])
        return is_completion_line(line) or any(
            marker in compact for marker in ["正在与聊天", "止在与聊天"]
        )

    all_boundary_lines = sorted(
        [line for line in normalized if is_boundary_line(line)],
        key=lambda line: line["y"],
    )
    completion_lines = sorted(
        [line for line in normalized if is_completion_line(line)],
        key=lambda line: line["y"],
    )
    agent_lines = [
        line
        for line in normalized
        if "Agent" in line["text"] and len(compact_text(line["text"])) <= 10
    ]

    if agent_lines:
        latest_agent = max(agent_lines, key=lambda line: line["y"])
        start_y = latest_agent["y"] + 8
        following_terminals = [
            line for line in all_boundary_lines if line["y"] > latest_agent["y"]
        ]
        end_y = min(
            (line["y"] for line in following_terminals),
            default=float("inf"),
        )
    elif completion_lines:
        # A long reply can scroll its Agent label above the visible viewport.
        # In that case, use the visible block ending at the latest completion.
        end_y = completion_lines[-1]["y"]
        prior_terminals = [line for line in completion_lines[:-1] if line["y"] < end_y]
        if prior_terminals:
            start_y = prior_terminals[-1]["y"] + 8
        else:
            height = float(image_height or max(end_y, 1))
            start_y = max(70, height * 0.06)
    else:
        return None

    ignored = ["思考过程", "任务完成", "正在与聊天", "止在与聊天", "Auto", "CUE"]
    def is_ignored_line(line):
        compact = compact_text(line["text"])
        width = float(image_width or 0)
        return (
            any(marker in compact for marker in ignored)
            or (("%" in compact or "％" in compact) and len(compact) <= 10)
            or (width > 0 and line["x"] > width * 0.65 and len(compact) <= 3)
        )

    response_lines = [
        line
        for line in sorted(normalized, key=lambda item: (item["y"], item["x"]))
        if line["y"] > start_y
        and line["y"] < end_y
        and not is_ignored_line(line)
    ]
    text = normalize_ocr_text("\n".join(line["text"] for line in response_lines))
    if response_looks_bad(text, min_compact_len=2):
        return ""
    return text


def extract_response_from_ocr(raw_text, prompt, lines=None, image_width=None, image_height=None):
    positioned_response = extract_latest_agent_response(lines, image_width, image_height)
    if positioned_response is not None:
        return positioned_response

    original_text = normalize_ocr_text(raw_text)
    text = original_text
    if not text:
        return ""

    prompt_norm = normalize_ocr_text(prompt)
    idx = text.rfind(prompt_norm)
    if idx >= 0:
        text = text[idx + len(prompt_norm):]
    else:
        fuzzy_span = find_fuzzy_prompt_span(text, prompt_norm)
        if fuzzy_span:
            text = text[fuzzy_span[1]:]

    agent_match = re.search(r"(?<!@)(?:[臼回口囗0O]\s*)?Agent\s+", text)
    if agent_match:
        text = text[agent_match.end():]

    footer_match = re.search(
        r"\s*[0O]?\s*任务完成(?:您.{0,8}聊天|\s+Auto|\s*$)",
        text,
    )
    if footer_match and footer_match.start() > 0:
        text = text[:footer_match.start()]

    cut_markers = [
        "@Agent",
        "正在与 Agent 聊天",
        "正在与Agent聊天",
        "UTF-8",
        "Markdown",
        "空格",
    ]
    for marker in cut_markers:
        marker_idx = text.find(marker)
        if marker_idx > 0:
            text = text[:marker_idx]

    text = re.sub(r"^[\s@臼回口囗0O]*Agent\s*", "", text).strip()
    text = re.sub(r"^[\s\S]{0,8}?思考中\s*\.{0,3}", "", text).strip()
    text = normalize_ocr_text(text)[:4000]
    if response_looks_bad(text):
        block = extract_answer_block(original_text)
        if block and not response_looks_bad(block):
            return block
        return ""
    return text


def run_windows_ocr(image_path, prompt):
    if not image_path:
        return None

    script = r'''
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$imgPath = $env:TRAE_OCR_IMAGE
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
function Await($AsyncTask, $ResultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1)
  $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($AsyncTask))
  $netTask.Wait()
  $netTask.Result
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imgPath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$lang = New-Object Windows.Globalization.Language 'zh-Hans-CN'
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { throw 'Windows OCR engine is unavailable.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$items = @()
foreach ($line in $result.Lines) {
  $words = @($line.Words)
  if ($words.Count -eq 0) { continue }
  $left = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
  $top = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
  $right = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
  $bottom = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
  $items += [PSCustomObject]@{
    text = $line.Text
    x = $left
    y = $top
    width = ($right - $left)
    height = ($bottom - $top)
  }
}
[PSCustomObject]@{
  width = $bitmap.PixelWidth
  height = $bitmap.PixelHeight
  text = $result.Text
  lines = $items
} | ConvertTo-Json -Depth 4 -Compress
'''
    env = os.environ.copy()
    env["TRAE_OCR_IMAGE"] = image_path
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            env=env,
        )
    except Exception as exc:
        return {"status": "error", "error": str(exc), "text": None, "rawText": None}

    if completed.returncode != 0:
        return {
            "status": "error",
            "error": (completed.stderr or completed.stdout).strip(),
            "text": None,
            "rawText": None,
        }

    output = completed.stdout.strip()
    image_width = None
    image_height = None
    try:
        payload = json.loads(output)
        raw_text = payload.get("text", "")
        lines = payload.get("lines", [])
        image_width = payload.get("width")
        image_height = payload.get("height")
    except json.JSONDecodeError:
        raw_text = output
        lines = []
    return {
        "status": "ok",
        "text": extract_response_from_ocr(
            raw_text,
            prompt,
            lines,
            image_width,
            image_height,
        ),
        "rawText": normalize_ocr_text(raw_text),
        "lines": lines,
    }


def panel_looks_open(ocr_text):
    text = normalize_ocr_text(ocr_text)
    compact = compact_text(text)
    # "TRAE" alone appears on many pages, so require Agent/chat-specific text.
    return (
        ("Agent" in text and ("聊天" in text or "您正在与" in text))
        or ("聊天" in text and "Auto" in text)
        or ("AutoMode" in compact and "AI可能会出错" in compact)
        or "待办事项" in text
        or "下一步建议" in text
        or "速通" in text
    )


def ensure_chat_panel_open(window, pyautogui, shortcut_keys, evidence_dir, prompt, attempts=3):
    last_probe = None
    for attempt in range(attempts):
        evidence = capture_window_bmp(window, evidence_dir)
        ocr = run_windows_ocr(evidence, prompt)
        raw_text = ocr.get("rawText") if ocr else ""
        last_probe = {
            "attempt": attempt + 1,
            "evidencePath": evidence,
            "ocrStatus": ocr.get("status") if ocr else "missing",
            "ocrError": ocr.get("error") if ocr else None,
            "rawText": raw_text,
        }
        if panel_looks_open(raw_text):
            return True, last_probe

        if shortcut_keys:
            pyautogui.hotkey(*shortcut_keys)
            time.sleep(0.8)

    return False, last_probe


def click_screen_point(x, y):
    # pyautogui uses the primary-monitor coordinate space on Windows. Use
    # Win32 input so clicks also work on secondary monitors.
    try:
        import win32api
        import win32con
    except ImportError as exc:
        raise RuntimeError("需要 pywin32 才能点击多显示器上的 TRAE 窗口") from exc

    win32api.SetCursorPos((int(x), int(y)))
    time.sleep(0.05)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.2)


def click_chat_input(window, pyautogui, x_ratio=0.82, y_ratio=0.85):
    rect = window.rectangle()
    width = max(1, rect.width())
    height = max(1, rect.height())
    safe_x_ratio = min(0.98, max(0.02, float(x_ratio)))
    safe_y_ratio = min(0.98, max(0.02, float(y_ratio)))
    x = rect.left + int(width * safe_x_ratio)
    y = rect.top + int(height * safe_y_ratio)
    click_screen_point(x, y)


def wait_for_response(window, prompt, timeout_sec, poll_interval_sec, evidence_dir, before_texts=None):
    started = time.time()
    before = before_texts if before_texts is not None else collect_visible_texts(window)
    last_after = before
    best_candidates = []

    while time.time() - started < timeout_sec:
        time.sleep(poll_interval_sec)
        try:
            after = collect_visible_texts(window)
        except Exception:
            after = []
        last_after = after
        candidates = likely_response_texts(before, after, prompt)
        if candidates:
            best_candidates = candidates
            break

    if best_candidates:
        return {
            "status": "read",
            "text": best_candidates[0],
            "candidates": best_candidates,
            "source": "uia",
            "elapsedSec": round(time.time() - started, 2),
        }

    evidence = capture_window_bmp(window, evidence_dir)
    ocr = run_windows_ocr(evidence, prompt)
    if ocr and ocr.get("status") == "ok" and ocr.get("text"):
        return {
            "status": "read",
            "text": ocr["text"],
            "candidates": [ocr["text"]],
            "source": "windows-ocr",
            "elapsedSec": round(time.time() - started, 2),
            "evidencePath": evidence,
            "rawOcrText": ocr.get("rawText"),
        }

    return {
        "status": "unavailable",
        "text": None,
        "candidates": [],
        "source": "uia+windows-ocr",
        "elapsedSec": round(time.time() - started, 2),
        "reason": "No new readable response text was exposed through Windows UI Automation or OCR.",
        "evidencePath": evidence,
        "ocrError": ocr.get("error") if ocr else None,
        "visibleTextCount": len(last_after),
    }


def build_result(success, **kwargs):
    result = {"success": success, **kwargs}
    print("JSON_RESULT:" + json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Send a prompt to TRAE IDE and optionally read back a visible result.")
    parser.add_argument("--text", required=True, help="Prompt text to send")
    parser.add_argument("--window", default="Trae CN", help="Window title keyword")
    parser.add_argument("--shortcut", default="ctrl+u", help="Shortcut that opens the TRAE chat panel")
    parser.add_argument("--send-key", default="enter", help="Key used to submit the prompt")
    parser.add_argument("--focus-wait", type=int, default=300, help="Focus wait in milliseconds")
    parser.add_argument("--input-x-ratio", type=float, default=0.82, help="Chat input X position relative to the TRAE window")
    parser.add_argument("--input-y-ratio", type=float, default=0.85, help="Chat input Y position relative to the TRAE window")
    parser.add_argument("--response-timeout", type=float, default=25, help="Seconds to wait for a readable result")
    parser.add_argument("--poll-interval", type=float, default=1, help="Seconds between UI read attempts")
    parser.add_argument("--no-read-response", action="store_true", help="Only send, do not try to read a result")
    parser.add_argument(
        "--evidence-dir",
        default=os.path.join(tempfile.gettempdir(), "trae-communicate"),
        help="Directory for fallback screenshots when no readable result is found",
    )
    args = parser.parse_args()

    deps = import_deps()
    pyautogui = deps["pyautogui"]
    pyperclip = deps["pyperclip"]
    Desktop = deps["Desktop"]
    ElementNotFoundError = deps["ElementNotFoundError"]
    ShowWindow = deps["ShowWindow"]
    SW_RESTORE = deps["SW_RESTORE"]

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.1

    result_base = {
        "prompt": args.text,
        "windowKeyword": args.window,
        "sent": False,
    }

    try:
        windows = Desktop(backend="uia").windows(title_re=f".*{re.escape(args.window)}.*")
        if not windows:
            message = f"No window title contains '{args.window}'"
            print(f"ERROR: {message}")
            build_result(False, **result_base, error=message)
            sys.exit(1)

        trae_window = windows[0]
        result_base["windowTitle"] = trae_window.window_text()
        result_base["windowHandle"] = int(trae_window.handle)

        trae_window.set_focus()
        if trae_window.is_minimized():
            ShowWindow(trae_window.handle, SW_RESTORE)
            time.sleep(0.3)

        time.sleep(args.focus_wait / 1000.0)
        shortcut_keys = [key for key in args.shortcut.split("+") if key]
        panel_open, panel_probe = ensure_chat_panel_open(
            trae_window,
            pyautogui,
            shortcut_keys,
            args.evidence_dir,
            args.text,
        )
        result_base["panelProbe"] = {
            "attempt": panel_probe.get("attempt") if panel_probe else None,
            "evidencePath": panel_probe.get("evidencePath") if panel_probe else None,
            "ocrStatus": panel_probe.get("ocrStatus") if panel_probe else None,
        }
        if not panel_open:
            message = "Could not confirm that the TRAE Agent chat panel is open; aborting to avoid pasting into the editor."
            print(f"ERROR: {message}")
            build_result(
                False,
                **result_base,
                error=message,
                response={
                    "status": "unavailable",
                    "reason": message,
                    "source": "panel-probe",
                    "evidencePath": panel_probe.get("evidencePath") if panel_probe else None,
                    "ocrError": panel_probe.get("ocrError") if panel_probe else None,
                },
            )
            sys.exit(1)

        before_texts = collect_visible_texts(trae_window)
        click_chat_input(
            trae_window,
            pyautogui,
            args.input_x_ratio,
            args.input_y_ratio,
        )

        pyperclip.copy(args.text)
        time.sleep(0.1)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.2)

        if args.send_key.lower() == "enter":
            pyautogui.press("enter")
        else:
            pyautogui.press(args.send_key)

        result_base["sent"] = True
        print("SUCCESS: prompt sent to TRAE IDE")
        print(f"Window: {result_base['windowTitle']}")
        print(f"Prompt: {args.text[:80]}..." if len(args.text) > 80 else f"Prompt: {args.text}")

        if args.no_read_response or args.response_timeout <= 0:
            build_result(True, **result_base, response={"status": "skipped"})
            sys.exit(0)

        response = wait_for_response(
            trae_window,
            args.text,
            args.response_timeout,
            args.poll_interval,
            args.evidence_dir,
            before_texts,
        )
        if response["status"] == "read":
            print("RESPONSE_READ:")
            print(response["text"])
        else:
            print(f"RESPONSE_UNAVAILABLE: {response.get('reason')}")
            if response.get("evidencePath"):
                print(f"Evidence: {response['evidencePath']}")

        build_result(True, **result_base, response=response)
        sys.exit(0)

    except ElementNotFoundError:
        message = "Window not found"
        print(f"ERROR: {message}")
        build_result(False, **result_base, error=message)
        sys.exit(1)
    except Exception as exc:
        print(f"ERROR: {exc}")
        import traceback
        traceback.print_exc()
        build_result(False, **result_base, error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
