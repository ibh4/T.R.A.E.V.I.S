#!/usr/bin/env python3
"""
YOLOv8n-Pose NCNN 树莓派 USB 摄像头姿势识别
- 修复 torchvision nms 加载失败问题（本地测试验证）
- 摄像头 /dev/video1（v4l2-ctl 确认）
"""
import sys
import time
import cv2
import numpy as np
import torch
import torchvision

# === 修复 torchvision C++ ops 加载失败 ===
def _patched_assert_has_ops():
    pass
torchvision.extension._assert_has_ops = _patched_assert_has_ops

def simple_nms(boxes, scores, iou_threshold):
    """PyTorch 纯 Python NMS 替代 torchvision.ops.nms"""
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.int64, device=boxes.device)
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = boxes[:, 2], boxes[:, 3]
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

# === 导入 ultralytics ===
from ultralytics import YOLO

MODEL_DIR = "/home/peng/yolo_pose_cam/yolov8n-pose_ncnn_model"


# COCO 17 关键点骨架连接
SKELETON = [
    (0, 1), (0, 2), (1, 3), (2, 4),       # 头部（不绘制）
    (5, 6),                                 # 肩
    (5, 11), (6, 12), (11, 12),             # 躯干
    (5, 7), (7, 9),                         # 左臂
    (6, 8), (8, 10),                        # 右臂
    (11, 13), (13, 15),                     # 左腿
    (12, 14), (14, 16),                     # 右腿
]
# 隐藏的关键点索引（鼻子/左眼/右眼/左耳/右耳）
HIDDEN_KP = {0, 1, 2, 3, 4}


def draw_pose(frame, results):
    """自定义绘制：只显示四肢和躯干，隐藏头部（眼/鼻/耳）"""
    annotated = frame.copy()
    if results[0].keypoints is None:
        return annotated

    kpts = results[0].keypoints.data  # [N, 17, 3] (x, y, conf)
    boxes = results[0].boxes

    for person_idx in range(len(kpts)):
        kp = kpts[person_idx].cpu().numpy()  # [17, 3]

        # 框（保留）
        if boxes is not None and person_idx < len(boxes):
            xyxy = boxes[person_idx].xyxy[0].cpu().numpy().astype(int)
            conf = float(boxes[person_idx].conf[0])
            cv2.rectangle(annotated, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]),
                          (0, 255, 0), 2)
            cv2.putText(annotated, f"person {conf:.2f}", (xyxy[0], xyxy[1] - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # 骨架（跳过含头部关键点的连接）
        for i, (a, b) in enumerate(SKELETON):
            if a in HIDDEN_KP or b in HIDDEN_KP:
                continue  # 跳过头部的骨架线
            xa, ya, ca = kp[a]
            xb, yb, cb = kp[b]
            if ca > 0.3 and cb > 0.3:
                # 躯干绿色，四肢青色
                color = (0, 255, 0) if (a, b) in [(5, 6), (5, 11), (6, 12), (11, 12)] else (255, 200, 0)
                cv2.line(annotated, (int(xa), int(ya)), (int(xb), int(yb)),
                         color, 3)

        # 关键点（跳过头部）
        for i, (x, y, c) in enumerate(kp):
            if i in HIDDEN_KP:
                continue
            if c > 0.3:
                cv2.circle(annotated, (int(x), int(y)), 5, (0, 0, 255), -1)

    return annotated


def main():
    print("=" * 50)
    print("YOLOv8n-Pose NCNN 摄像头姿势识别")
    print("=" * 50)

    print("[pose] 加载 NCNN 模型...")
    model = YOLO(MODEL_DIR, task="pose")
    print("[pose] ✓ 模型加载完成")

    # 树莓派 OpenCV 用索引 0 才能读到帧（v4l2 显示 USB 摄像头在 video1，
    # 但 OpenCV VideoCapture(0) 内部映射到可读设备，索引 1 反而读不到）
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[pose] ✗ 无法打开摄像头 (index 0)")
        input("按回车退出...")
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    print("[pose] 摄像头已打开,开始推理 (按 q 退出)")
    prev_t = time.time()
    frame_count = 0
    fps = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[pose] 读取帧失败")
            break

        results = model.predict(
            source=frame, imgsz=320, conf=0.4,
            verbose=False, show=False
        )
        annotated = draw_pose(frame, results)

        frame_count += 1
        now = time.time()
        if frame_count % 10 == 0:
            fps = 10 / (now - prev_t)
            prev_t = now

        inf_ms = results[0].speed.get('inference', 0)
        cv2.putText(annotated, f"FPS: {fps:.1f}  NCNN: {inf_ms:.0f}ms",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        cv2.imshow("YOLOv8n-Pose NCNN (press q)", annotated)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("[pose] 已退出")


if __name__ == "__main__":
    main()
