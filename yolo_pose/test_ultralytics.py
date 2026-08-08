"""
YOLOv8n-Pose NCNN 测试 - 用 ultralytics 但跳过 torchvision nms
"""
import os
import cv2
import numpy as np
import torch
import torchvision

# 修复 torchvision ops 加载问题
def _patched_assert_has_ops():
    pass
torchvision.extension._assert_has_ops = _patched_assert_has_ops

# 手动实现 NMS 替代 torchvision.ops.nms
def simple_nms(boxes, scores, iou_threshold):
    """简单 PyTorch NMS 实现"""
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.int64, device=boxes.device)
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort(descending=True)
    keep = []
    while order.numel() > 0:
        i = order[0].item()
        keep.append(i)
        if order.numel() == 1:
            break
        order = order[1:]
        xx1 = torch.maximum(x1[i], x1[order])
        yy1 = torch.maximum(y1[i], y1[order])
        xx2 = torch.minimum(x2[i], x2[order])
        yy2 = torch.minimum(y2[i], y2[order])
        inter = torch.clamp(xx2 - xx1, min=0) * torch.clamp(yy2 - yy1, min=0)
        union = areas[i] + areas[order] - inter
        iou = inter / union
        order = order[iou < iou_threshold]
    return torch.tensor(keep, dtype=torch.int64)

torchvision.ops.nms = simple_nms

# 现在再导入 ultralytics
from ultralytics import YOLO

BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE, "models", "yolov8n-pose_ncnn_model")
TEST_DIR = "/Users/pwngwc/projects/ESP32/YOLO"
OUT_DIR = os.path.join(BASE, "results")
os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 60)
print("YOLOv8n-Pose NCNN (ultralytics + 修复 torchvision nms)")
print("=" * 60)

print(f"[1/3] 加载 NCNN 模型...")
model = YOLO(MODEL_DIR, task="pose")
print(f"    ✓ 加载完成")

test_images = ["bus.jpg", "zidane.jpg"]
print(f"\n[2/3] 推理 {len(test_images)} 张图片...")

for name in test_images:
    img_path = os.path.join(TEST_DIR, name)
    if not os.path.exists(img_path):
        continue

    print(f"\n  --- {name} ---")
    results = model.predict(
        source=img_path,
        imgsz=320,
        conf=0.4,
        save=False,
        verbose=False,
    )[0]

    annotated = results.plot()
    out_path = os.path.join(OUT_DIR, f"ultra_result_{name}")
    cv2.imwrite(out_path, annotated)

    n = len(results.boxes) if results.boxes is not None else 0
    inf_ms = results.speed.get('inference', 0)
    print(f"    检测: {n} 人, NCNN 推理: {inf_ms:.0f}ms")
    print(f"    保存: {out_path}")

    if results.boxes is not None and n > 0:
        for i, box in enumerate(results.boxes):
            conf = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            print(f"    人 {i+1}: conf={conf:.2f} box=[{xyxy[0]:.0f},{xyxy[1]:.0f},{xyxy[2]:.0f},{xyxy[3]:.0f}]")

print(f"\n✓ 完成，结果图: {OUT_DIR}")
