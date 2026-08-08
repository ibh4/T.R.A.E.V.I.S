from __future__ import annotations

import hashlib
import math
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from .sources import Frame

BoundingBox = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class Detection:
    class_id: int
    label: str
    confidence: float
    bbox: BoundingBox

    def to_dict(self) -> dict[str, object]:
        return {
            "class_id": self.class_id,
            "label": self.label,
            "confidence": round(self.confidence, 6),
            "bbox": {
                "x": self.bbox[0],
                "y": self.bbox[1],
                "width": self.bbox[2],
                "height": self.bbox[3],
            },
        }


class ObjectDetector(Protocol):
    model_id: str

    def detect(self, frame: Frame) -> list[Detection]: ...


@dataclass(frozen=True, slots=True)
class YoloV8Config:
    model_path: Path
    labels: tuple[str, ...]
    input_width: int = 640
    input_height: int = 640
    confidence_threshold: float = 0.25
    nms_threshold: float = 0.45

    def __post_init__(self) -> None:
        if not self.model_path.exists():
            raise FileNotFoundError(f"object model does not exist: {self.model_path}")
        if not self.labels:
            raise ValueError("object detector labels must not be empty")
        if self.input_width < 1 or self.input_height < 1:
            raise ValueError("object detector input size must be positive")
        if not 0.0 <= self.confidence_threshold <= 1.0:
            raise ValueError("confidence_threshold must be between 0.0 and 1.0")
        if not 0.0 <= self.nms_threshold <= 1.0:
            raise ValueError("nms_threshold must be between 0.0 and 1.0")


@dataclass(frozen=True, slots=True)
class LetterboxTransform:
    scale: float
    pad_x: float
    pad_y: float
    original_width: int
    original_height: int


class OpenCvYoloV8Detector:
    def __init__(self, config: YoloV8Config) -> None:
        self.config = config
        self.model_id = f"{config.model_path.name}:{sha256_file(config.model_path)[:12]}"
        try:
            self._net = cv2.dnn.readNetFromONNX(str(config.model_path))
        except cv2.error as exc:
            raise RuntimeError(f"unable to load ONNX model: {config.model_path}") from exc

    def detect(self, frame: Frame) -> list[Detection]:
        if frame.size == 0:
            raise ValueError("frame must not be empty")
        input_frame, transform = letterbox(
            frame,
            self.config.input_width,
            self.config.input_height,
        )
        blob = cv2.dnn.blobFromImage(
            input_frame,
            scalefactor=1.0 / 255.0,
            size=(self.config.input_width, self.config.input_height),
            swapRB=True,
            crop=False,
        )
        self._net.setInput(blob)
        output = self._net.forward()
        return decode_yolov8_output(
            output,
            labels=self.config.labels,
            transform=transform,
            confidence_threshold=self.config.confidence_threshold,
            nms_threshold=self.config.nms_threshold,
        )


class MockObjectDetector:
    def __init__(self, detections: list[Detection] | None = None) -> None:
        self.model_id = "mock-object-detector"
        self.detections = detections or []
        self.call_count = 0

    def detect(self, frame: Frame) -> list[Detection]:
        self.call_count += 1
        return list(self.detections)


def load_labels(path: Path) -> tuple[str, ...]:
    if not path.exists():
        raise FileNotFoundError(f"label file does not exist: {path}")
    labels = tuple(
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )
    if not labels:
        raise ValueError(f"label file is empty: {path}")
    return labels


def letterbox(frame: Frame, input_width: int, input_height: int) -> tuple[Frame, LetterboxTransform]:
    original_height, original_width = frame.shape[:2]
    scale = min(input_width / original_width, input_height / original_height)
    resized_width = max(1, round(original_width * scale))
    resized_height = max(1, round(original_height * scale))
    resized = cv2.resize(frame, (resized_width, resized_height))
    pad_x = (input_width - resized_width) / 2.0
    pad_y = (input_height - resized_height) / 2.0
    left = int(np.floor(pad_x))
    right = input_width - resized_width - left
    top = int(np.floor(pad_y))
    bottom = input_height - resized_height - top
    padded = cv2.copyMakeBorder(
        resized,
        top,
        bottom,
        left,
        right,
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )
    return padded, LetterboxTransform(
        scale=scale,
        pad_x=float(left),
        pad_y=float(top),
        original_width=original_width,
        original_height=original_height,
    )


def decode_yolov8_output(
    output: np.ndarray,
    *,
    labels: tuple[str, ...],
    transform: LetterboxTransform,
    confidence_threshold: float,
    nms_threshold: float,
) -> list[Detection]:
    rows = _normalize_output_rows(output, expected_features=len(labels) + 4)
    boxes: list[BoundingBox] = []
    scores: list[float] = []
    class_ids: list[int] = []

    for row in rows:
        class_scores = row[4:]
        class_id = int(np.argmax(class_scores))
        confidence = float(class_scores[class_id])
        if confidence < confidence_threshold:
            continue
        bbox = _model_box_to_original(row[:4], transform)
        if bbox[2] <= 0 or bbox[3] <= 0:
            continue
        boxes.append(bbox)
        scores.append(confidence)
        class_ids.append(class_id)

    if not boxes:
        return []
    kept_indices: list[int] = []
    for class_id in sorted(set(class_ids)):
        candidate_indices = [
            index for index, candidate_class_id in enumerate(class_ids) if candidate_class_id == class_id
        ]
        class_boxes = [boxes[index] for index in candidate_indices]
        class_scores = [scores[index] for index in candidate_indices]
        indices = cv2.dnn.NMSBoxes(
            class_boxes,
            class_scores,
            confidence_threshold,
            nms_threshold,
        )
        flat_indices = np.asarray(indices).reshape(-1).tolist() if len(indices) else []
        kept_indices.extend(candidate_indices[index] for index in flat_indices)
    detections = [
        Detection(
            class_id=class_ids[index],
            label=labels[class_ids[index]],
            confidence=scores[index],
            bbox=boxes[index],
        )
        for index in kept_indices
    ]
    return sorted(detections, key=lambda detection: detection.confidence, reverse=True)


def benchmark_detector(
    detector: ObjectDetector,
    *,
    iterations: int = 5,
    warmup_iterations: int = 1,
    frame_width: int = 640,
    frame_height: int = 640,
    frame: Frame | None = None,
) -> dict[str, object]:
    if iterations < 1:
        raise ValueError("iterations must be positive")
    if warmup_iterations < 0:
        raise ValueError("warmup_iterations must be non-negative")
    benchmark_frame = (
        frame
        if frame is not None
        else np.zeros((frame_height, frame_width, 3), dtype=np.uint8)
    )
    if benchmark_frame.size == 0:
        raise ValueError("benchmark frame must not be empty")
    for _ in range(warmup_iterations):
        detector.detect(benchmark_frame)
    timings: list[float] = []
    detections: list[Detection] = []
    for _ in range(iterations):
        started = time.perf_counter()
        detections = detector.detect(benchmark_frame)
        timings.append((time.perf_counter() - started) * 1000.0)
    mean_ms = statistics.mean(timings)
    height, width = benchmark_frame.shape[:2]
    return {
        "model_id": detector.model_id,
        "iterations": iterations,
        "warmup_iterations": warmup_iterations,
        "frame_size": {"width": int(width), "height": int(height)},
        "mean_ms": round(mean_ms, 3),
        "median_ms": round(statistics.median(timings), 3),
        "p95_ms": round(_nearest_rank_percentile(timings, 0.95), 3),
        "stddev_ms": round(statistics.pstdev(timings), 3),
        "min_ms": round(min(timings), 3),
        "max_ms": round(max(timings), 3),
        "throughput_fps": round(1000.0 / mean_ms, 3) if mean_ms > 0 else None,
        "last_detection_count": len(detections),
        "detections": [detection.to_dict() for detection in detections],
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _nearest_rank_percentile(values: list[float], percentile: float) -> float:
    if not values:
        raise ValueError("percentile requires at least one value")
    if not 0.0 < percentile <= 1.0:
        raise ValueError("percentile must be between 0 and 1")
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def _normalize_output_rows(output: np.ndarray, expected_features: int) -> np.ndarray:
    array = np.asarray(output)
    if array.ndim == 3 and array.shape[0] == 1:
        array = array[0]
    if array.ndim != 2:
        raise ValueError(f"unsupported YOLO output shape: {tuple(output.shape)}")
    if array.shape[0] == expected_features:
        return array.T
    if array.shape[1] == expected_features:
        return array
    raise ValueError(
        f"YOLO output features do not match {expected_features - 4} labels: "
        f"{tuple(output.shape)}"
    )


def _model_box_to_original(box: np.ndarray, transform: LetterboxTransform) -> BoundingBox:
    center_x, center_y, width, height = (float(value) for value in box)
    x1 = (center_x - width / 2.0 - transform.pad_x) / transform.scale
    y1 = (center_y - height / 2.0 - transform.pad_y) / transform.scale
    x2 = (center_x + width / 2.0 - transform.pad_x) / transform.scale
    y2 = (center_y + height / 2.0 - transform.pad_y) / transform.scale
    x1 = max(0.0, min(float(transform.original_width), x1))
    y1 = max(0.0, min(float(transform.original_height), y1))
    x2 = max(0.0, min(float(transform.original_width), x2))
    y2 = max(0.0, min(float(transform.original_height), y2))
    return (
        int(round(x1)),
        int(round(y1)),
        max(0, int(round(x2 - x1))),
        max(0, int(round(y2 - y1))),
    )
