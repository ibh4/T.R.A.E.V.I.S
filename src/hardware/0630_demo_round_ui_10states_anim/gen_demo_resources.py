#!/usr/bin/env python3
"""gen_demo_resources.py - 生成演示版资源 binary (v3, 240x240 全屏帧)

输出 1 个文件:
1. states_anim.bin - 10 状态各 12 帧 240x240 RGB565 全屏帧
   格式: 48B 头 + 10 状态 × 12 帧 × (240*240*2=115200B) = 48 + 13.82MB
   ESP32 端近邻采样放大到 466x466 显示
   - Status 页面: 左右滑动切换状态, 默认循环播放当前状态 12 帧动画
   - Alert 页面: bug_alert ↔ fix_success 动画切换
   - Energy 页面: task_charge/thinking_scan/thinking_focus 动画轮播
   - Ready 页面: idle_ready 12 帧循环 (待机动画)
   - Spider 页面: spider_bot 12 帧循环

源: trae_proj_main/output/traepal_sequences/<state>/frames/frame_*.png  (240x240)
     内切圆裁剪 + RGB565 (不放大, 保持 240x240 原始分辨率)
"""
import struct
import os
from pathlib import Path
from PIL import Image, ImageDraw

# ========== 配置 ==========
# 路径自适应: 脚本在 src/hardware/0630_demo_round_ui_10states_anim/, 仓库根在 3 级之上
# parents[0]=0630_xxx/  parents[1]=hardware/  parents[2]=src/  parents[3]=trae_proj_main/
REPO_ROOT = Path(__file__).resolve().parents[3]
SEQ_DIR = REPO_ROOT / "output" / "traepal_sequences"
OUT_DIR = Path(__file__).parent
W, H = 240, 240  # 保持源分辨率, ESP32 端放大
FRAME_BYTES = W * H * 2  # 115200

# 10 个状态 (顺序固定, 与 main.c state_names[] 一致)
STATES = [
    "idle_ready",    # 0
    "thinking_scan", # 1
    "thinking_focus",# 2
    "bug_alert",     # 3
    "fix_success",   # 4
    "sync_ping",     # 5
    "task_charge",   # 6
    "spider_bot",    # 7
    "sleepy_nudge",  # 8
    "bug_maze",      # 9
]

# 每状态采样的帧数 (从 24/36 帧中均匀采样)
FRAMES_PER_STATE = 12

def rgb_to_rgb565(r, g, b):
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    return (r5 << 11) | (g6 << 5) | b5

def make_circle_mask():
    """内切圆遮罩 (圆内白, 圆外黑)"""
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([0, 0, W-1, H-1], fill=255)
    return mask

def png_to_rgb565_frame(png_path, mask):
    """PNG 240x240 → 圆形遮罩 → RGB565 little-endian bytes (保持 240x240)"""
    src = Image.open(png_path).convert("RGBA")
    # 应用圆形遮罩
    rgb = Image.new("RGB", (W, H), (0, 0, 0))
    rgb.paste(src, mask=mask)
    # RGB → RGB565
    pixels = list(rgb.getdata())
    data = bytearray()
    for r, g, b in pixels:
        v = rgb_to_rgb565(r, g, b)
        data.extend(struct.pack('<H', v))
    return bytes(data)

def sample_frames(frame_paths, n):
    """从 frame_paths 中均匀采样 n 帧"""
    total = len(frame_paths)
    if total <= n:
        return list(frame_paths)
    indices = [int(i * (total - 1) / (n - 1)) for i in range(n)]
    return [frame_paths[i] for i in indices]

def main():
    print("=== 演示版资源生成 v3 (240x240 全屏帧, 10 状态全动态) ===")
    mask = make_circle_mask()

    # 生成所有帧数据
    all_frames = bytearray()
    state_frame_counts = []

    for state in STATES:
        state_dir = SEQ_DIR / state / "frames"
        if not state_dir.exists():
            print(f"  [SKIP] {state}: 目录不存在")
            state_frame_counts.append(0)
            all_frames.extend(b'\x00' * (FRAMES_PER_STATE * FRAME_BYTES))
            continue

        frames_paths = sorted(state_dir.glob("frame_*.png"))
        sampled = sample_frames(frames_paths, FRAMES_PER_STATE)
        n = len(sampled)
        state_frame_counts.append(n)

        for fp in sampled:
            frame_data = png_to_rgb565_frame(fp, mask)
            all_frames.extend(frame_data)

        print(f"  {state}: {n} 帧 × {FRAME_BYTES}B = {n * FRAME_BYTES / 1024:.1f}KB")

    # 头: 10 状态 × (offset:4B, frame_count:2B) = 60B
    HEADER_SIZE = 10 * 6
    header = bytearray()
    offset = HEADER_SIZE
    for i in range(len(STATES)):
        header.extend(struct.pack('<IH', offset, state_frame_counts[i]))
        offset += state_frame_counts[i] * FRAME_BYTES

    bin_data = header + all_frames
    out_path = OUT_DIR / "states_anim.bin"
    out_path.write_bytes(bin_data)

    print(f"\n  总计: {len(bin_data)/1024:.1f}KB → {out_path.name}")
    print(f"  头: {HEADER_SIZE}B (10 状态 × 6B)")
    print(f"  数据: {len(all_frames)/1024:.1f}KB")
    for i, s in enumerate(STATES):
        off = struct.unpack('<I', header[i*6:i*6+4])[0]
        cnt = struct.unpack('<H', header[i*6+4:i*6+6])[0]
        print(f"    [{i}] {s}: offset={off}, frames={cnt}")

if __name__ == "__main__":
    main()
