"""OpenCV video sources and lightweight motion detection."""

from .motion import MotionDetector, MotionDetectorConfig, MotionObservation, parse_roi
from .object_detector import (
    Detection,
    MockObjectDetector,
    ObjectDetector,
    OpenCvYoloV8Detector,
    YoloV8Config,
    benchmark_detector,
    load_labels,
)
from .pipeline import SnapshotStore, VisionMotionMonitor, VisionMonitorConfig
from .model_manifest import MANIFEST_SCHEMA_VERSION, ObjectModelManifest
from .sources import (
    OpenCvVideoSource,
    Picamera2VideoSource,
    VideoSource,
    create_video_source,
    parse_picamera2_source,
    parse_video_source,
)

__all__ = [
    "MotionDetector",
    "MotionDetectorConfig",
    "MotionObservation",
    "MANIFEST_SCHEMA_VERSION",
    "Detection",
    "MockObjectDetector",
    "ObjectDetector",
    "ObjectModelManifest",
    "OpenCvVideoSource",
    "Picamera2VideoSource",
    "OpenCvYoloV8Detector",
    "SnapshotStore",
    "VideoSource",
    "VisionMotionMonitor",
    "VisionMonitorConfig",
    "YoloV8Config",
    "benchmark_detector",
    "create_video_source",
    "load_labels",
    "parse_picamera2_source",
    "parse_roi",
    "parse_video_source",
]
