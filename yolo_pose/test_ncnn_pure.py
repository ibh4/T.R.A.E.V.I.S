"""
YOLOv8n-Pose NCNN 纯 Python 推理测试（不依赖 torch/ultralytics）
- 直接用 ncnn Python API 加载 .param + .bin
- 对 bus.jpg 和 zidane.jpg 做姿势识别
- 输出标注图（关键点 + 骨架）
"""
import os
import sys
import time
import cv2
import numpy as np
import ncnn

BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE, "models", "yolov8n-pose_ncnn_model")
PARAM_PATH = os.path.join(MODEL_DIR, "model.ncnn.param")
BIN_PATH = os.path.join(MODEL_DIR, "model.ncnn.bin")
TEST_DIR = "/Users/pwngwc/projects/ESP32/YOLO"
OUT_DIR = os.path.join(BASE, "results")
os.makedirs(OUT_DIR, exist_ok=True)

# COCO 17 关键点定义
KEYPOINT_NAMES = [
    "nose", "l_eye", "r_eye", "l_ear", "r_ear",
    "l_shoulder", "r_shoulder", "l_elbow", "r_elbow",
    "l_wrist", "r_wrist", "l_hip", "r_hip",
    "l_knee", "r_knee", "l_ankle", "r_ankle"
]
SKELETON = [
    (0, 1), (0, 2), (1, 3), (2, 4),
    (5, 6), (5, 11), (6, 12), (11, 12),
    (5, 7), (7, 9), (6, 8), (8, 10),
    (11, 13), (13, 15), (12, 14), (14, 16),
]
LIMB_COLORS = [
    (255, 100, 100), (100, 255, 100), (100, 100, 255),
    (255, 255, 0), (255, 0, 255), (0, 255, 255),
    (200, 100, 50), (50, 200, 100), (100, 50, 200),
]
KP_COLORS = [
    (0, 0, 255), (255, 0, 0), (0, 255, 0), (255, 255, 0), (255, 0, 255),
    (0, 255, 255), (128, 0, 0), (0, 128, 0), (0, 0, 128),
    (128, 128, 0), (128, 0, 128), (0, 128, 128),
    (200, 100, 50), (50, 200, 100), (100, 50, 200),
    (200, 200, 50), (50, 200, 200),
]


def preprocess(img, input_size=320):
    """预处理: resize + normalize + HWC→CHW"""
    h, w = img.shape[:2]
    scale = min(input_size / h, input_size / w)
    new_h, new_w = int(h * scale), int(w * scale)
    resized = cv2.resize(img, (new_w, new_h))

    # pad to input_size
    canvas = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    canvas[:new_h, :new_w] = resized

    # HWC→CHW, BGR→RGB, normalize to [0,1]
    canvas = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    canvas = canvas.transpose(2, 0, 1).astype(np.float32) / 255.0

    return canvas, scale, new_h, new_w


def detect_pose(img, conf_threshold=0.4, iou_threshold=0.5):
    """NCNN 推理 YOLOv8n-pose"""
    input_size = 320
    input_data, scale, new_h, new_w = preprocess(img, input_size)

    # 创建 NCNN 推理器
    net = ncnn.Net()
    net.load_param(PARAM_PATH)
    net.load_model(BIN_PATH)

    mat_in = ncnn.Mat(input_data)
    ex = net.create_extractor()
    ex.input("in0", mat_in)

    # YOLOv8-pose 输出: [1, 56, 2100] = [batch, 4(box) + 1(conf) + 1(cls) + 17*3(kp), anchors]
    # anchors = (320/8)^2 + (320/16)^2 + (320/32)^2 = 1600 + 400 + 100 = 2100
    ret, mat_out = ex.extract("out0")
    if ret != 0:
        print(f"NCNN 推理失败: {ret}")
        return []

    # 输出 shape: [56, 2100]
    out = np.array(mat_out)
    print(f"  NCNN 输出 shape: {out.shape}")

    if out.shape[0] != 56:
        print(f"  ⚠ 输出维度不是 56 行, 跳过解析")
        return []

    # 转置: [2100, 56]
    preds = out.T

    # 解析: [cx, cy, w, h, conf, cls, 17*(x,y,conf)]
    boxes = preds[:, :4]
    confs = preds[:, 4]
    kps = preds[:, 6:]  # 17*3 = 51

    # 过滤低置信度
    mask = confs > conf_threshold
    boxes = boxes[mask]
    confs = confs[mask]
    kps = kps[mask]

    if len(boxes) == 0:
        return []

    # NMS（简单版）
    # 转为 xyxy
    xyxy = np.zeros_like(boxes)
    xyxy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
    xyxy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
    xyxy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
    xyxy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2

    # 简单 NMS（按 conf 排序后 IoU 去重）
    order = confs.argsort()[::-1]
    keep = []
    while len(order) > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break
        xx1 = np.maximum(xyxy[i, 0], xyxy[order[1:], 0])
        yy1 = np.maximum(xyxy[i, 1], xyxy[order[1:], 1])
        xx2 = np.minimum(xyxy[i, 2], xyxy[order[1:], 2])
        yy2 = np.minimum(xyxy[i, 3], xyxy[order[1:], 3])
        w = np.maximum(0, xx2 - xx1)
        h = np.maximum(0, yy2 - yy1)
        iou = (w * h) / ((xyxy[i, 2] - xyxy[i, 0]) * (xyxy[i, 3] - xyxy[i, 1]) +
                         (xyxy[order[1:], 2] - xyxy[order[1:], 0]) *
                         (xyxy[order[1:], 3] - xyxy[order[1:], 1]) - w * h + 1e-9)
        order = order[1:][iou < iou_threshold]

    # 还原到原图坐标
    results = []
    h_orig, w_orig = img.shape[:2]
    for idx in keep:
        box = xyxy[idx] / input_size
        box[0] *= w_orig / scale * input_size / w_orig if scale != 1 else 1
        # 简化: 直接按 scale 还原
        box_orig = xyxy[idx].copy()
        box_orig[0] = box_orig[0] / scale
        box_orig[1] = box_orig[1] / scale
        box_orig[2] = box_orig[2] / scale
        box_orig[3] = box_orig[3] / scale

        # 关键点 [17, 3]
        kp = kps[idx].reshape(17, 3)
        kp_orig = kp.copy()
        kp_orig[:, 0] /= scale
        kp_orig[:, 1] /= scale

        results.append({
            'box': box_orig,
            'conf': confs[idx],
            'kps': kp_orig,
        })

    return results


def draw_results(img, results):
    """绘制检测框 + 关键点 + 骨架"""
    annotated = img.copy()
    for r in results:
        x1, y1, x2, y2 = r['box'].astype(int)
        conf = r['conf']
        kps = r['kps']

        # 框
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(annotated, f"person {conf:.2f}", (x1, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # 骨架
        for i, (a, b) in enumerate(SKELETON):
            xa, ya, ca = kps[a]
            xb, yb, cb = kps[b]
            if ca > 0.3 and cb > 0.3:
                color = LIMB_COLORS[i % len(LIMB_COLORS)]
                cv2.line(annotated, (int(xa), int(ya)), (int(xb), int(yb)), color, 3)

        # 关键点
        for i, (x, y, c) in enumerate(kps):
            if c > 0.3:
                color = KP_COLORS[i % len(KP_COLORS)]
                cv2.circle(annotated, (int(x), int(y)), 4, color, -1)

    return annotated


def main():
    print("=" * 60)
    print("YOLOv8n-Pose NCNN 纯 Python 推理测试")
    print("=" * 60)
    print(f"模型: {MODEL_DIR}")
    print(f"测试图: {TEST_DIR}")

    test_images = ["bus.jpg", "zidane.jpg"]

    for name in test_images:
        img_path = os.path.join(TEST_DIR, name)
        if not os.path.exists(img_path):
            print(f"\n✗ {name} 不存在")
            continue

        print(f"\n{'=' * 40}")
        print(f"测试: {name}")
        img = cv2.imread(img_path)
        print(f"  图像: {img.shape[1]}x{img.shape[0]}")

        t0 = time.time()
        results = detect_pose(img, conf_threshold=0.4)
        elapsed = (time.time() - t0) * 1000

        print(f"  检测到 {len(results)} 人, NCNN 推理+后处理: {elapsed:.0f}ms")

        annotated = draw_results(img, results)
        out_path = os.path.join(OUT_DIR, f"ncnn_result_{name}")
        cv2.imwrite(out_path, annotated)
        print(f"  ✓ 保存到: {out_path}")

        for i, r in enumerate(results):
            print(f"    人 {i+1}: conf={r['conf']:.2f}, 关键点可见数={sum(1 for k in r['kps'] if k[2] > 0.3)}/17")

    print(f"\n✓ 全部完成，结果在: {OUT_DIR}")


if __name__ == "__main__":
    main()
