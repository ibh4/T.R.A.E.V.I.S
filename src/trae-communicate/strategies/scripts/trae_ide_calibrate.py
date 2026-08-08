#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import trae_ide_send as sender


CROP_RIGHT_RATIO = 0.45


def find_input_candidates(lines, image_width, image_height):
    candidates = []
    for line in lines or []:
        text = sender.normalize_ocr_text(line.get("text"))
        compact = sender.compact_text(text)
        try:
            x = float(line.get("x", 0))
            y = float(line.get("y", 0))
            width = float(line.get("width", 0))
            height = float(line.get("height", 0))
        except (TypeError, ValueError):
            continue

        if y < image_height * 0.65:
            continue

        if "聊天" in compact and x < image_width * 0.65:
            score = 100
            if "正在与" in compact or "止在与" in compact:
                score += 30
            candidates.append({
                "score": score,
                "x": x + max(20, width * 0.5),
                "y": y + max(8, height * 0.5),
                "method": "ocr-placeholder",
                "matchedText": text,
            })

        if "Auto" in compact:
            candidates.append({
                "score": 50,
                "x": image_width * 0.42,
                "y": max(image_height * 0.68, y - image_height * 0.08),
                "method": "ocr-toolbar",
                "matchedText": text,
            })

    candidates.append({
        "score": 10,
        "x": image_width * 0.50,
        "y": image_height * 0.85,
        "method": "panel-fallback",
        "matchedText": None,
    })
    return sorted(candidates, key=lambda item: item["score"], reverse=True)


def validate_input_anchor(x, y, pyautogui, pyperclip):
    marker = f"TRAE_CALIBRATION_{int(time.time() * 1000)}"
    previous_clipboard = pyperclip.paste()
    copied = ""
    inserted = False
    try:
        sender.click_screen_point(x, y)
        pyperclip.copy(marker)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.35)
        pyautogui.hotkey("ctrl", "a")
        pyautogui.hotkey("ctrl", "c")
        time.sleep(0.15)
        copied = pyperclip.paste()
        inserted = marker in copied
        if inserted:
            pyautogui.hotkey("ctrl", "z")
            time.sleep(0.2)
        return inserted
    finally:
        pyperclip.copy(previous_clipboard)


def write_calibration(output_path, calibration):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(calibration, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temp_path, output_path)


def build_result(success, **kwargs):
    print("JSON_RESULT:" + json.dumps({"success": success, **kwargs}, ensure_ascii=False))


def main():
    default_output = Path(__file__).resolve().parents[2] / ".trae-calibration.json"
    parser = argparse.ArgumentParser(description="Auto-calibrate the TRAE Agent chat input position.")
    parser.add_argument("--window", default="Trae CN", help="Window title keyword")
    parser.add_argument("--shortcut", default="ctrl+u", help="Shortcut that opens the Agent panel")
    parser.add_argument("--focus-wait", type=int, default=300, help="Focus wait in milliseconds")
    parser.add_argument("--output", default=str(default_output), help="Calibration JSON output path")
    parser.add_argument(
        "--evidence-dir",
        default=os.path.join(tempfile.gettempdir(), "trae-communicate"),
        help="Directory for calibration screenshots",
    )
    args = parser.parse_args()

    deps = sender.import_deps()
    pyautogui = deps["pyautogui"]
    pyperclip = deps["pyperclip"]
    Desktop = deps["Desktop"]
    ShowWindow = deps["ShowWindow"]
    SW_RESTORE = deps["SW_RESTORE"]
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.1

    try:
        windows = Desktop(backend="uia").windows(title_re=f".*{re.escape(args.window)}.*")
        if not windows:
            raise RuntimeError(f"No window title contains '{args.window}'")

        window = windows[0]
        window.set_focus()
        if window.is_minimized():
            ShowWindow(window.handle, SW_RESTORE)
            time.sleep(0.3)
        time.sleep(args.focus_wait / 1000.0)

        shortcut_keys = [key for key in args.shortcut.split("+") if key]
        panel_open, panel_probe = sender.ensure_chat_panel_open(
            window,
            pyautogui,
            shortcut_keys,
            args.evidence_dir,
            "",
        )
        if not panel_open:
            raise RuntimeError("Could not confirm that the TRAE Agent panel is open")

        evidence = sender.capture_window_bmp(
            window,
            args.evidence_dir,
            crop_right_ratio=CROP_RIGHT_RATIO,
        )
        ocr = sender.run_windows_ocr(evidence, "")
        if not ocr or ocr.get("status") != "ok":
            raise RuntimeError(f"Windows OCR failed: {ocr.get('error') if ocr else 'no result'}")

        rect = window.rectangle()
        window_width = max(1, rect.width())
        window_height = max(1, rect.height())
        image_width = max(1, int(window_width * CROP_RIGHT_RATIO))
        image_height = window_height
        crop_left = rect.right - image_width

        selected = None
        attempts = []
        seen = set()
        for candidate in find_input_candidates(ocr.get("lines"), image_width, image_height):
            absolute_x = int(crop_left + candidate["x"])
            absolute_y = int(rect.top + candidate["y"])
            key = (absolute_x, absolute_y)
            if key in seen:
                continue
            seen.add(key)
            valid = validate_input_anchor(absolute_x, absolute_y, pyautogui, pyperclip)
            attempts.append({
                "method": candidate["method"],
                "x": absolute_x,
                "y": absolute_y,
                "valid": valid,
            })
            if valid:
                selected = {**candidate, "absoluteX": absolute_x, "absoluteY": absolute_y}
                break

        if not selected:
            raise RuntimeError("Could not find and validate the TRAE chat input")

        x_ratio = (selected["absoluteX"] - rect.left) / window_width
        y_ratio = (selected["absoluteY"] - rect.top) / window_height
        calibration = {
            "version": 1,
            "calibratedAt": datetime.now(timezone.utc).isoformat(),
            "windowKeyword": args.window,
            "windowTitle": window.window_text(),
            "window": {
                "left": rect.left,
                "top": rect.top,
                "width": window_width,
                "height": window_height,
            },
            "inputClickRatio": {
                "x": round(x_ratio, 6),
                "y": round(y_ratio, 6),
            },
            "inputAbsoluteAtCalibration": {
                "x": selected["absoluteX"],
                "y": selected["absoluteY"],
            },
            "method": selected["method"],
            "matchedText": selected.get("matchedText"),
            "evidencePath": evidence,
        }
        output_path = Path(args.output).resolve()
        write_calibration(output_path, calibration)
        print("CALIBRATION_SUCCESS")
        print(f"Input ratio: x={x_ratio:.6f}, y={y_ratio:.6f}")
        print(f"Saved: {output_path}")
        build_result(
            True,
            calibration=calibration,
            outputPath=str(output_path),
            attempts=attempts,
            panelProbe={
                "attempt": panel_probe.get("attempt") if panel_probe else None,
                "evidencePath": panel_probe.get("evidencePath") if panel_probe else None,
                "ocrStatus": panel_probe.get("ocrStatus") if panel_probe else None,
            },
        )
    except Exception as exc:
        print(f"CALIBRATION_FAILED: {exc}")
        build_result(False, error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
