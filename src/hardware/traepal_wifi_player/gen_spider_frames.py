#!/usr/bin/env python3
"""
生成电子蜘蛛表情动画帧 (RGB565) for ESP32 466×466 圆形 AMOLED

电子蜘蛛设计 (来自 status-viewer.html):
- 绿色头部 + 黑色脸部 + 菱形眼睛
- 8 条机械腿 (绿色边框 + 蓝色脚尖)
- idle: 上下浮动
- bug_alert: 左右抖动 + 红眼
- fix_success: 浮动 + 琥珀眼

输出: frames_spider.bin (delta patch 压缩格式)
  - 布局: [header][state0 delta data][state1 delta data][state2 delta data]
  - header: 3 states × 8 frames 的 bbox 信息
  - 每个状态: frame_0 全屏 + frame_1-7 delta patches
"""
import struct
import math
import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("需要 Pillow: pip3 install Pillow")

# ========== 配置 ==========
W, H = 466, 466
FRAMES_PER_STATE = 8
STATES = ['idle_ready', 'bug_alert', 'fix_success']
OUTPUT_DIR = Path(__file__).parent / 'spider_frames'
OUTPUT_BIN = Path(__file__).parent / 'frames_spider.bin'

# 颜色 (RGB)
COL_BG = (3, 8, 7)          # #030807 深黑
COL_GREEN = (49, 238, 127)  # #31ee7f
COL_GREEN_DARK = (36, 184, 111)  # #24b86f
COL_RED = (255, 94, 106)    # #ff5e6a
COL_AMBER = (246, 198, 79)  # #f6c64f
COL_BLUE = (115, 167, 255)  # #73a7ff

# 蜘蛛参数 (缩放到 466 画布)
SCALE = 2.0  # 原始 190px → 380px
CX, CY = W // 2, H // 2

def rgb_to_rgb565(r, g, b):
    """RGB → RGB565 little-endian (2 bytes)"""
    r5 = (r >> 3) & 0x1F
    g6 = (g >> 2) & 0x3F
    b5 = (b >> 3) & 0x1F
    v = (r5 << 11) | (g6 << 5) | b5
    return struct.pack('<H', v)

def draw_spider_frame(state, frame_idx):
    """绘制一帧电子蜘蛛, 返回 PIL Image"""
    img = Image.new('RGB', (W, H), COL_BG)
    draw = ImageDraw.Draw(img)

    # 动画偏移
    t = frame_idx / FRAMES_PER_STATE * 2 * math.pi  # 一个完整周期
    if state == 'idle_ready':
        dy = int(8 * SCALE * math.sin(t))
        dx = 0
        eye_color = COL_GREEN
        leg_sway = int(3 * SCALE * math.sin(t))
    elif state == 'bug_alert':
        dy = 0
        dx = int(6 * SCALE * math.sin(t * 8))  # 高频抖动 (每帧不同)
        eye_color = COL_RED
        leg_sway = int(5 * SCALE * math.sin(t * 8))
    else:  # fix_success
        dy = int(6 * SCALE * math.sin(t))
        dx = 0
        eye_color = COL_AMBER
        leg_sway = int(2 * SCALE * math.sin(t))

    cx, cy = CX + dx, CY + dy

    # 蜘蛛尺寸 (缩放后)
    head_w = int(104 * SCALE)
    head_h = int(82 * SCALE)
    head_r = int(16 * SCALE)
    face_w = head_w - int(28 * SCALE)
    face_h = int(44 * SCALE)
    eye_size = int(15 * SCALE)
    neck_w = int(30 * SCALE)
    neck_h = int(16 * SCALE)
    leg_w = int(78 * SCALE)
    leg_h = int(24 * SCALE)
    leg_thickness = max(2, int(4 * SCALE))

    # 1. 绘制 8 条腿 (在头部下方)
    leg_tops = [44, 70, 98, 124]  # 原始 y 偏移
    leg_angles_l = [28, 8, -11, -31]
    leg_angles_r = [-28, -8, 11, 31]

    for i, (top, angle) in enumerate(zip(leg_tops, leg_angles_l)):
        leg_y = cy - int(75 * SCALE) + int(top * SCALE) + leg_sway
        # 左腿
        _draw_leg(draw, cx - int(95 * SCALE), leg_y, leg_w, angle, COL_GREEN, COL_BLUE, leg_thickness, 'left')
        # 右腿
        _draw_leg(draw, cx + int(95 * SCALE), leg_y, leg_w, -angle, COL_GREEN, COL_BLUE, leg_thickness, 'right')

    # 2. 颈部
    neck_x0 = cx - neck_w // 2
    neck_y0 = cy - int(75 * SCALE) + int(112 * SCALE)
    draw.rounded_rectangle([neck_x0, neck_y0, neck_x0 + neck_w, neck_y0 + neck_h],
                            radius=int(8 * SCALE), fill=COL_GREEN_DARK)

    # 3. 头部 (圆角矩形 + 发光)
    head_x0 = cx - head_w // 2
    head_y0 = cy - int(75 * SCALE) + int(32 * SCALE)
    # 发光阴影 (简化: 画一个更大的半透明矩形)
    for glow in range(int(14 * SCALE), 0, -2):
        alpha_col = tuple(min(255, c + 20) for c in COL_GREEN)
        draw.rounded_rectangle(
            [head_x0 - glow, head_y0 - glow,
             head_x0 + head_w + glow, head_y0 + head_h + glow],
            radius=head_r + glow, outline=alpha_col)

    draw.rounded_rectangle([head_x0, head_y0, head_x0 + head_w, head_y0 + head_h],
                            radius=head_r, fill=COL_GREEN)

    # 4. 脸部 (黑色凹槽)
    face_x0 = head_x0 + int(14 * SCALE)
    face_y0 = head_y0 + int(16 * SCALE)
    draw.rounded_rectangle([face_x0, face_y0, face_x0 + face_w, face_y0 + face_h],
                            radius=int(7 * SCALE), fill=COL_BG)

    # 5. 眼睛 (菱形)
    eye_y = face_y0 + int(14 * SCALE)
    eye_left_x = face_x0 + int(22 * SCALE)
    eye_right_x = face_x0 + face_w - int(22 * SCALE) - eye_size

    for ex in [eye_left_x, eye_right_x]:
        _draw_diamond(draw, ex + eye_size // 2, eye_y + eye_size // 2,
                       eye_size // 2, eye_color)

    return img

def _draw_leg(draw, base_x, base_y, length, angle_deg, color, tip_color, thickness, side):
    """绘制一条机械腿 (弧线 + 脚尖)"""
    angle = math.radians(angle_deg)
    # 腿的终点
    if side == 'left':
        end_x = base_x - int(length * math.cos(angle))
        end_y = base_y + int(length * math.sin(angle))
    else:
        end_x = base_x + int(length * math.cos(angle))
        end_y = base_y + int(length * math.sin(angle))

    # 画腿 (粗线)
    draw.line([(base_x, base_y), (end_x, end_y)], fill=color, width=thickness)
    # 脚尖 (蓝色小线段)
    tip_len = int(28 * SCALE)
    tip_angle = angle + math.radians(-32 if side == 'left' else 32)
    tip_x = end_x + int(tip_len * math.cos(tip_angle))
    tip_y = end_y + int(tip_len * math.sin(tip_angle))
    draw.line([(end_x, end_y), (tip_x, tip_y)], fill=tip_color, width=thickness)

def _draw_diamond(draw, cx, cy, r, color):
    """画菱形"""
    pts = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    draw.polygon(pts, fill=color)

def img_to_rgb565(img):
    """PIL Image → RGB565 little-endian bytes"""
    pixels = list(img.getdata())
    data = bytearray()
    for r, g, b in pixels:
        data.extend(rgb_to_rgb565(r, g, b))
    return bytes(data)

def compute_bbox(frame_prev, frame_curr):
    """计算两帧之间的差异 bbox"""
    W, H = 466, 466
    min_x, min_y = W, H
    max_x, max_y = -1, -1
    # 逐像素比较 (4 像素一组加速)
    for y in range(H):
        for x in range(0, W, 4):
            idx = (y * W + x) * 2
            # 比较 8 字节 (4 像素)
            if frame_prev[idx:idx+8] != frame_curr[idx:idx+8]:
                if x < min_x: min_x = x
                if x + 3 > max_x: max_x = x + 3
                if y < min_y: min_y = y
                if y > max_y: max_y = y
            elif frame_prev[idx:idx+8] == frame_curr[idx:idx+8]:
                # 精细比较这 4 像素
                for dx in range(4):
                    px = x + dx
                    pidx = (y * W + px) * 2
                    if px < W and frame_prev[pidx:pidx+2] != frame_curr[pidx:pidx+2]:
                        if px < min_x: min_x = px
                        if px > max_x: max_x = px
                        if y < min_y: min_y = y
                        if y > max_y: max_y = y

    if max_x < 0:
        return None  # 完全相同
    # 对齐到 4 像素边界
    min_x = (min_x // 4) * 4
    max_x = min(W - 1, ((max_x + 4) // 4) * 4)
    min_y = (min_y // 2) * 2
    max_y = min(H - 1, ((max_y + 2) // 2) * 2)
    return (min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)

def extract_patch(frame_full, bbox):
    """从全屏帧提取 bbox 区域数据"""
    x, y, w, h = bbox
    W = 466
    patch = bytearray()
    for row in range(y, y + h):
        start = (row * W + x) * 2
        patch.extend(frame_full[start:start + w * 2])
    return bytes(patch)

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    all_state_data = []
    header = []

    for state_idx, state in enumerate(STATES):
        print(f"生成 {state}...")
        frames_rgb565 = []
        for i in range(FRAMES_PER_STATE):
            img = draw_spider_frame(state, i)
            frame_data = img_to_rgb565(img)
            frames_rgb565.append(frame_data)
            # 保存 PNG 预览
            img.save(OUTPUT_DIR / f"{state}_frame_{i:02d}.png")

        # Delta patch 压缩
        state_data = bytearray()
        state_patches = []

        # frame 0: 全屏基础帧
        base_frame = frames_rgb565[0]
        state_data.extend(base_frame)
        state_patches.append({
            'index': 0, 'isBase': True,
            'x': 0, 'y': 0, 'w': W, 'h': H,
            'offset': len(state_data) - len(base_frame),
            'size': len(base_frame)
        })
        print(f"  frame 0: 全屏 {len(base_frame)} 字节")

        # frame 1-7: delta patches
        prev_frame = base_frame
        for i in range(1, FRAMES_PER_STATE):
            curr_frame = frames_rgb565[i]
            bbox = compute_bbox(prev_frame, curr_frame)
            if bbox is None:
                # 完全相同, 空 patch
                state_patches.append({
                    'index': i, 'isBase': False,
                    'x': 0, 'y': 0, 'w': 0, 'h': 0,
                    'offset': len(state_data), 'size': 0
                })
                print(f"  frame {i}: 无变化")
            else:
                patch = extract_patch(curr_frame, bbox)
                state_data.extend(patch)
                state_patches.append({
                    'index': i, 'isBase': False,
                    'x': bbox[0], 'y': bbox[1], 'w': bbox[2], 'h': bbox[3],
                    'offset': len(state_data) - len(patch),
                    'size': len(patch)
                })
                print(f"  frame {i}: delta bbox={bbox} {len(patch)} 字节")
            prev_frame = curr_frame

        header.append(state_patches)
        all_state_data.append(bytes(state_data))
        print(f"  {state} 总数据: {len(state_data)} 字节")

    # 合并为单个 bin
    # 格式: [3 states × 8 frames header][data...]
    # header entry: 18 bytes (index:1, isBase:1, x:2, y:2, w:2, h:2, offset:4, size:4)
    HEADER_ENTRY_SIZE = 18
    total_header_size = 3 * 8 * HEADER_ENTRY_SIZE

    # 计算数据偏移
    data_offset = total_header_size
    bin_data = bytearray()

    # 写 header
    for state_patches in header:
        for p in state_patches:
            abs_offset = data_offset + p['offset']
            bin_data.extend(struct.pack('<BBHHHHII',
                p['index'], 1 if p['isBase'] else 0,
                p['x'], p['y'], p['w'], p['h'],
                abs_offset, p['size']))

    # 写数据
    for state_data in all_state_data:
        bin_data.extend(state_data)

    OUTPUT_BIN.write_bytes(bin_data)
    total_size = len(bin_data)
    print(f"\n=== 完成 ===")
    print(f"输出: {OUTPUT_BIN}")
    print(f"总大小: {total_size} 字节 ({total_size/1024:.1f} KB)")
    print(f"对比全屏格式: {3 * 8 * W * H * 2} 字节 ({3*8*W*H*2/1024/1024:.1f} MB)")
    print(f"压缩率: {total_size / (3*8*W*H*2) * 100:.1f}%")

    # 保存 header 信息为 JSON
    import json
    header_json = []
    for si, state_patches in enumerate(header):
        header_json.append({
            'state': STATES[si],
            'frames': [{'index': p['index'], 'isBase': p['isBase'],
                        'x': p['x'], 'y': p['y'], 'w': p['w'], 'h': p['h'],
                        'offset': p['offset'], 'size': p['size']} for p in state_patches]
        })
    (OUTPUT_DIR / 'manifest.json').write_text(json.dumps(header_json, indent=2))
    print(f"manifest: {OUTPUT_DIR / 'manifest.json'}")

if __name__ == '__main__':
    main()
