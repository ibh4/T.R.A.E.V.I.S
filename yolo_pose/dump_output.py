"""dump NCNN 输出查看实际数据格式"""
import os
import numpy as np
import cv2
import ncnn

BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE, "models", "yolov8n-pose_ncnn_model")
PARAM_PATH = os.path.join(MODEL_DIR, "model.ncnn.param")
BIN_PATH = os.path.join(MODEL_DIR, "model.ncnn.bin")
IMG = "/Users/pwngwc/projects/ESP32/YOLO/zidane.jpg"

img = cv2.imread(IMG)
h, w = img.shape[:2]
input_size = 320
scale = min(input_size / h, input_size / w)
new_h, new_w = int(h * scale), int(w * scale)
resized = cv2.resize(img, (new_w, new_h))
canvas = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
canvas[:new_h, :new_w] = resized
canvas = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
canvas = canvas.transpose(2, 0, 1).astype(np.float32) / 255.0

net = ncnn.Net()
net.load_param(PARAM_PATH)
net.load_model(BIN_PATH)

ex = net.create_extractor()
ex.input("in0", ncnn.Mat(canvas))
ret, mat_out = ex.extract("out0")
print(f"ret={ret}")

out = np.array(mat_out)
print(f"shape: {out.shape}")
print(f"min={out.min():.4f} max={out.max():.4f}")
print(f"row 0 (前 10): {out[0, :10]}")
print(f"col 0 (前 10): {out[:10, 0]}")

# 第 4 列（可能是 conf）的分布
if out.shape[0] >= 5:
    confs = out[4]
    print(f"\n第 4 行 (conf?): min={confs.min():.4f} max={confs.max():.4f}")
    print(f"top 10 confs: {sorted(confs, reverse=True)[:10]}")

# 试试 [1, 56, 2100] 或 [2100, 56] 不同维度
if len(out.shape) == 2:
    print(f"\n2D shape {out.shape}:")
    print(f"  行均值: {out.mean(axis=1)[:10]}")
    print(f"  列均值: {out.mean(axis=0)[:10]}")
