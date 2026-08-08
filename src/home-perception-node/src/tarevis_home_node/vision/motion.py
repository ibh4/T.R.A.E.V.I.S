from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np

from .sources import Frame

NormalizedRoi = tuple[float, float, float, float]
BoundingBox = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class MotionDetectorConfig:
    roi: NormalizedRoi = (0.0, 0.0, 1.0, 1.0)
    warmup_frames: int = 20
    min_area: int = 1500
    min_score: float = 0.015
    min_consecutive_frames: int = 3
    cooldown_seconds: float = 4.0

    def __post_init__(self) -> None:
        validate_roi(self.roi)
        if self.warmup_frames < 0:
            raise ValueError("warmup_frames must be non-negative")
        if self.min_area < 1:
            raise ValueError("min_area must be positive")
        if not 0.0 <= self.min_score <= 1.0:
            raise ValueError("min_score must be between 0.0 and 1.0")
        if self.min_consecutive_frames < 1:
            raise ValueError("min_consecutive_frames must be positive")
        if self.cooldown_seconds < 0:
            raise ValueError("cooldown_seconds must be non-negative")


@dataclass(frozen=True, slots=True)
class MotionObservation:
    frame_index: int
    roi_bounds: BoundingBox
    bbox: BoundingBox
    motion_area: int
    motion_score: float
    threshold_hit: bool
    triggered: bool
    warming_up: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "frame_index": self.frame_index,
            "roi_bounds": _bbox_dict(self.roi_bounds),
            "bbox": _bbox_dict(self.bbox),
            "motion_area": self.motion_area,
            "motion_score": round(self.motion_score, 6),
            "threshold_hit": self.threshold_hit,
            "triggered": self.triggered,
            "warming_up": self.warming_up,
        }


class MotionDetector:
    def __init__(self, config: MotionDetectorConfig) -> None:
        self.config = config
        self._subtractor = cv2.createBackgroundSubtractorMOG2(
            history=max(60, config.warmup_frames * 3),
            varThreshold=25,
            detectShadows=False,
        )
        self._kernel = np.ones((3, 3), dtype=np.uint8)
        self._frame_index = 0
        self._consecutive_hits = 0
        self._cooldown_until = 0.0

    def process(self, frame: Frame, *, now: float | None = None) -> MotionObservation:
        if frame.size == 0:
            raise ValueError("frame must not be empty")
        self._frame_index += 1
        roi_frame, roi_bounds = extract_roi(frame, self.config.roi)
        mask = self._subtractor.apply(roi_frame)
        warming_up = self._frame_index <= self.config.warmup_frames
        if warming_up:
            return MotionObservation(
                frame_index=self._frame_index,
                roi_bounds=roi_bounds,
                bbox=(0, 0, 0, 0),
                motion_area=0,
                motion_score=0.0,
                threshold_hit=False,
                triggered=False,
                warming_up=True,
            )

        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel, iterations=1)
        mask = cv2.dilate(mask, self._kernel, iterations=2)

        motion_area, relative_bbox = largest_motion_bbox(mask, self.config.min_area)
        roi_area = max(1, roi_frame.shape[0] * roi_frame.shape[1])
        motion_score = motion_area / roi_area
        threshold_hit = (
            motion_area >= self.config.min_area and motion_score >= self.config.min_score
        )

        if threshold_hit:
            self._consecutive_hits += 1
        else:
            self._consecutive_hits = 0

        current_time = time.monotonic() if now is None else now
        triggered = (
            threshold_hit
            and self._consecutive_hits >= self.config.min_consecutive_frames
            and current_time >= self._cooldown_until
        )
        if triggered:
            self._cooldown_until = current_time + self.config.cooldown_seconds
            self._consecutive_hits = 0

        return MotionObservation(
            frame_index=self._frame_index,
            roi_bounds=roi_bounds,
            bbox=offset_bbox(relative_bbox, roi_bounds),
            motion_area=motion_area,
            motion_score=motion_score,
            threshold_hit=threshold_hit,
            triggered=triggered,
            warming_up=False,
        )


def parse_roi(text: str) -> NormalizedRoi:
    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 4:
        raise ValueError("ROI must contain x,y,width,height")
    values = tuple(float(part) for part in parts)
    roi: NormalizedRoi = (values[0], values[1], values[2], values[3])
    validate_roi(roi)
    return roi


def validate_roi(roi: NormalizedRoi) -> None:
    x, y, width, height = roi
    if min(roi) < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        raise ValueError("ROI must stay within normalized frame bounds")


def extract_roi(frame: Frame, roi: NormalizedRoi) -> tuple[Frame, BoundingBox]:
    frame_height, frame_width = frame.shape[:2]
    x = max(0, min(frame_width - 1, int(frame_width * roi[0])))
    y = max(0, min(frame_height - 1, int(frame_height * roi[1])))
    width = max(1, min(frame_width - x, int(frame_width * roi[2])))
    height = max(1, min(frame_height - y, int(frame_height * roi[3])))
    return frame[y : y + height, x : x + width], (x, y, width, height)


def largest_motion_bbox(mask: Frame, min_area: int) -> tuple[int, BoundingBox]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    largest_area = 0
    largest_bbox: BoundingBox = (0, 0, 0, 0)
    for contour in contours:
        area = int(cv2.contourArea(contour))
        if area < min_area or area <= largest_area:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        largest_area = area
        largest_bbox = (x, y, width, height)
    return largest_area, largest_bbox


def offset_bbox(bbox: BoundingBox, roi_bounds: BoundingBox) -> BoundingBox:
    return (
        roi_bounds[0] + bbox[0],
        roi_bounds[1] + bbox[1],
        bbox[2],
        bbox[3],
    )


def render_motion_overlay(frame: Frame, observation: MotionObservation) -> Frame:
    preview = frame.copy()
    roi_x, roi_y, roi_width, roi_height = observation.roi_bounds
    cv2.rectangle(
        preview,
        (roi_x, roi_y),
        (roi_x + roi_width, roi_y + roi_height),
        (0, 255, 255),
        2,
    )
    if observation.bbox[2] > 0 and observation.bbox[3] > 0:
        color = (0, 0, 255) if observation.threshold_hit else (0, 255, 0)
        x, y, width, height = observation.bbox
        cv2.rectangle(preview, (x, y), (x + width, y + height), color, 2)
    status = "TRIGGER" if observation.triggered else "monitoring"
    if observation.warming_up:
        status = "warming_up"
    cv2.putText(
        preview,
        f"frame={observation.frame_index} motion={observation.motion_score:.4f} {status}",
        (12, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return preview


def _bbox_dict(bbox: BoundingBox) -> dict[str, int]:
    return {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3]}
