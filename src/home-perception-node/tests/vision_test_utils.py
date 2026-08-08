from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def make_motion_frames(width: int = 96, height: int = 72) -> list[np.ndarray]:
    frames = [np.zeros((height, width, 3), dtype=np.uint8) for _ in range(6)]
    for offset in range(8):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        x = 8 + offset * 5
        cv2.rectangle(frame, (x, 22), (x + 20, 48), (255, 255, 255), -1)
        frames.append(frame)
    return frames


def write_video(path: Path, frames: list[np.ndarray], fps: float = 10.0) -> None:
    height, width = frames[0].shape[:2]
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        raise RuntimeError("MJPG VideoWriter is unavailable")
    try:
        for frame in frames:
            writer.write(frame)
    finally:
        writer.release()
