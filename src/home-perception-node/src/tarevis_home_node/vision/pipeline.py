from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2

from ..contracts import EventLevel, EventSource, SensingEvent, create_event
from .motion import MotionDetector, MotionDetectorConfig, MotionObservation
from .object_detector import Detection, ObjectDetector
from .sources import Frame, VideoSource

FrameObserver = Callable[[Frame, MotionObservation], None]


@dataclass(frozen=True, slots=True)
class VisionMonitorConfig:
    device_id: str
    camera_id: str = "cam_default"
    zone: str = "unknown"
    width: int = 640
    height: int = 480
    target_fps: float | None = 5.0
    max_frames: int | None = None
    snapshots_enabled: bool = True
    snapshots_dir: Path = Path("data/snapshots")
    max_snapshot_files: int = 5

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("vision width and height must be positive")
        if self.target_fps is not None and self.target_fps <= 0:
            raise ValueError("target_fps must be positive or None")
        if self.max_frames is not None and self.max_frames < 1:
            raise ValueError("max_frames must be positive or None")
        if self.max_snapshot_files < 0:
            raise ValueError("max_snapshot_files must be non-negative")


class SnapshotStore:
    def __init__(self, directory: Path, max_files: int = 5) -> None:
        self.directory = directory
        self.max_files = max_files

    def save(self, frame: Frame, *, camera_id: str, frame_index: int) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
        path = self.directory / f"{timestamp}_{camera_id}_{frame_index:06d}.jpg"
        if not cv2.imwrite(str(path), frame):
            raise RuntimeError(f"unable to save snapshot: {path}")
        self._prune()
        return path

    def _prune(self) -> None:
        if self.max_files <= 0:
            return
        snapshots = sorted(self.directory.glob("*.jpg"), key=lambda path: path.stat().st_mtime)
        for stale_path in snapshots[:-self.max_files]:
            stale_path.unlink(missing_ok=True)


class VisionMotionMonitor:
    def __init__(
        self,
        source: VideoSource,
        monitor_config: VisionMonitorConfig,
        detector_config: MotionDetectorConfig,
        object_detector: ObjectDetector | None = None,
        confirmation_labels: frozenset[str] | None = None,
    ) -> None:
        self.source = source
        self.monitor_config = monitor_config
        self.detector = MotionDetector(detector_config)
        self.detector_config = detector_config
        self.object_detector = object_detector
        self.confirmation_labels = confirmation_labels or frozenset({"person"})
        self.snapshot_store = (
            SnapshotStore(
                monitor_config.snapshots_dir,
                max_files=monitor_config.max_snapshot_files,
            )
            if monitor_config.snapshots_enabled
            else None
        )

    def iter_events(
        self,
        observer: FrameObserver | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[SensingEvent]:
        for batch in self.iter_event_batches(observer=observer, should_stop=should_stop):
            yield from batch

    def iter_event_batches(
        self,
        observer: FrameObserver | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[list[SensingEvent]]:
        frame_count = 0
        next_frame_at = time.monotonic()
        try:
            while True:
                if should_stop is not None and should_stop():
                    return
                if (
                    self.monitor_config.max_frames is not None
                    and frame_count >= self.monitor_config.max_frames
                ):
                    return
                self._throttle(next_frame_at)
                if self.monitor_config.target_fps is not None:
                    next_frame_at = max(
                        next_frame_at + (1.0 / self.monitor_config.target_fps),
                        time.monotonic(),
                    )

                ok, frame = self.source.read()
                if not ok or frame is None:
                    return
                frame_count += 1
                frame = self._prepare_frame(frame)
                observation = self.detector.process(frame)
                if observer is not None:
                    observer(frame, observation)
                if observation.triggered:
                    yield self._build_events(frame, observation)
        finally:
            self.source.close()

    def _throttle(self, next_frame_at: float) -> None:
        if self.monitor_config.target_fps is None:
            return
        now = time.monotonic()
        if now < next_frame_at:
            time.sleep(next_frame_at - now)

    def _prepare_frame(self, frame: Frame) -> Frame:
        if (
            frame.shape[1] == self.monitor_config.width
            and frame.shape[0] == self.monitor_config.height
        ):
            return frame
        return cv2.resize(frame, (self.monitor_config.width, self.monitor_config.height))

    def _build_events(self, frame: Frame, observation: MotionObservation) -> list[SensingEvent]:
        detections = self.object_detector.detect(frame) if self.object_detector is not None else []
        payload: dict[str, object] = {
            "camera_id": self.monitor_config.camera_id,
            "source": self.source.source_name,
            "frame_index": observation.frame_index,
            "frame_size": {
                "width": frame.shape[1],
                "height": frame.shape[0],
            },
            "roi": {
                "x": self.detector_config.roi[0],
                "y": self.detector_config.roi[1],
                "width": self.detector_config.roi[2],
                "height": self.detector_config.roi[3],
            },
            "bbox": {
                "x": observation.bbox[0],
                "y": observation.bbox[1],
                "width": observation.bbox[2],
                "height": observation.bbox[3],
            },
            "motion_area": observation.motion_area,
            "motion_score": round(observation.motion_score, 6),
            "detections": [detection.to_dict() for detection in detections],
        }
        if self.object_detector is not None:
            payload["secondary_model"] = self.object_detector.model_id
        if self.snapshot_store is not None:
            snapshot_path = self.snapshot_store.save(
                frame,
                camera_id=self.monitor_config.camera_id,
                frame_index=observation.frame_index,
            )
            payload["snapshot_path"] = snapshot_path.as_posix()
        motion_event = create_event(
            device_id=self.monitor_config.device_id,
            source=EventSource.VISION,
            event_type="motion_detected",
            level=EventLevel.INFO,
            zone=self.monitor_config.zone,
            confidence=None,
            payload=payload,
        )
        events = [motion_event]
        events.extend(self._build_confirmation_events(motion_event, detections))
        return events

    def _build_confirmation_events(
        self,
        motion_event: SensingEvent,
        detections: list[Detection],
    ) -> list[SensingEvent]:
        best_by_label: dict[str, Detection] = {}
        for detection in detections:
            if detection.label not in self.confirmation_labels:
                continue
            current = best_by_label.get(detection.label)
            if current is None or detection.confidence > current.confidence:
                best_by_label[detection.label] = detection

        return [
            create_event(
                device_id=self.monitor_config.device_id,
                source=EventSource.VISION,
                event_type=f"{_normalize_label(label)}_detected",
                level=EventLevel.INFO,
                zone=self.monitor_config.zone,
                confidence=detection.confidence,
                payload={
                    "camera_id": self.monitor_config.camera_id,
                    "model": self.object_detector.model_id if self.object_detector else "unknown",
                    "parent_event_id": motion_event.event_id,
                    "detection": detection.to_dict(),
                    "snapshot_path": motion_event.payload.get("snapshot_path"),
                },
            )
            for label, detection in sorted(best_by_label.items())
        ]


def _normalize_label(label: str) -> str:
    normalized = "_".join(label.lower().strip().split())
    return "".join(character for character in normalized if character.isalnum() or character == "_")
