from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .runtime import UiRuntime


class PreviewBuffer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jpeg: bytes | None = None
        self._meta: dict[str, Any] = {"status": "waiting_for_frames"}

    def update(self, jpeg: bytes, meta: dict[str, Any]) -> None:
        with self._lock:
            self._jpeg = jpeg
            self._meta = dict(meta)

    def get_jpeg(self) -> bytes | None:
        with self._lock:
            return self._jpeg

    def clear(self) -> None:
        with self._lock:
            self._jpeg = None
            self._meta = {"status": "waiting_for_frames"}

    def get_meta(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._meta)


@dataclass(frozen=True, slots=True)
class VisionWorkerConfig:
    source: str
    device_id: str
    zone: str
    width: int = 640
    height: int = 480
    target_fps: float | None = 5.0
    snapshots_dir: Path = Path("data/snapshots")
    roi: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)
    warmup_frames: int = 20
    min_area: int = 1500
    min_score: float = 0.015
    min_consecutive_frames: int = 3
    cooldown_seconds: float = 4.0
    object_model: Path | None = None
    object_labels: Path = Path("models/coco80.txt")
    confirmation_labels: frozenset[str] = frozenset({"person"})


class VisionWorker:
    def __init__(
        self,
        runtime: UiRuntime,
        preview: PreviewBuffer,
        config: VisionWorkerConfig,
    ) -> None:
        self.runtime = runtime
        self.preview = preview
        self.config = config
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run, name="tarevis-vision", daemon=True)
            self._thread.start()
            return True

    def stop(self) -> bool:
        with self._lock:
            thread = self._thread
            if thread is None or not thread.is_alive():
                return False
            self._stop_event.set()
        thread.join(timeout=4.0)
        return not thread.is_alive()

    def _run(self) -> None:
        failed = False
        try:
            import cv2

            from ..vision import (
                MotionDetectorConfig,
                OpenCvYoloV8Detector,
                VisionMotionMonitor,
                VisionMonitorConfig,
                YoloV8Config,
                create_video_source,
                load_labels,
            )
            from ..vision.motion import MotionObservation, render_motion_overlay
            from ..vision.sources import Frame

            source = create_video_source(
                self.config.source,
                width=self.config.width,
                height=self.config.height,
            )
            object_detector = (
                OpenCvYoloV8Detector(
                    YoloV8Config(
                        model_path=self.config.object_model,
                        labels=load_labels(self.config.object_labels),
                    )
                )
                if self.config.object_model is not None
                else None
            )
            monitor = VisionMotionMonitor(
                source=source,
                monitor_config=VisionMonitorConfig(
                    device_id=self.config.device_id,
                    zone=self.config.zone,
                    width=self.config.width,
                    height=self.config.height,
                    target_fps=self.config.target_fps,
                    snapshots_dir=self.config.snapshots_dir,
                ),
                detector_config=MotionDetectorConfig(
                    roi=self.config.roi,
                    warmup_frames=self.config.warmup_frames,
                    min_area=self.config.min_area,
                    min_score=self.config.min_score,
                    min_consecutive_frames=self.config.min_consecutive_frames,
                    cooldown_seconds=self.config.cooldown_seconds,
                ),
                object_detector=object_detector,
                confirmation_labels=self.config.confirmation_labels,
            )
            frame_count = 0
            measure_started = time.monotonic()
            last_status_at = 0.0

            def observe(frame: Frame, observation: MotionObservation) -> None:
                nonlocal frame_count, measure_started, last_status_at
                overlay = render_motion_overlay(frame, observation)
                ok, encoded = cv2.imencode(".jpg", overlay, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
                if ok:
                    self.preview.update(encoded.tobytes(), observation.to_dict())
                frame_count += 1
                now = time.monotonic()
                if now - last_status_at < 0.5:
                    return
                elapsed = max(now - measure_started, 0.001)
                self.runtime.update_status(
                    camera="active",
                    vision_fps=round(frame_count / elapsed, 1),
                    motion_score=round(observation.motion_score, 6),
                    preview_url="/media/preview.mjpg",
                    last_error=None,
                )
                frame_count = 0
                measure_started = now
                last_status_at = now

            self.runtime.update_status(camera="active", last_error=None)
            for events in monitor.iter_event_batches(
                observer=observe,
                should_stop=self._stop_event.is_set,
            ):
                for event in events:
                    self.runtime.emit(event)
        except Exception as exc:  # hardware and optional dependencies fail at runtime
            failed = True
            self.runtime.update_status(camera="offline", vision_fps=0.0, last_error=str(exc))
        finally:
            if not failed:
                changes: dict[str, Any] = {"camera": "standby", "vision_fps": 0.0}
                if self._stop_event.is_set():
                    self.preview.clear()
                    changes["preview_url"] = None
                self.runtime.update_status(**changes)


@dataclass(frozen=True, slots=True)
class AudioWorkerConfig:
    device_id: str
    zone: str
    seconds: float = 5.0
    sample_rate: int = 16000
    channels: int = 1
    device_index: int | None = None
    output_path: Path = Path("recordings/ui-latest.wav")
    transcriber: str = "mock"
    mock_text: str = "测试语音"
    funasr_model: str = "iic/SenseVoiceSmall"


class AudioSampleWorker:
    def __init__(self, runtime: UiRuntime, config: AudioWorkerConfig) -> None:
        self.runtime = runtime
        self.config = config
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._thread = threading.Thread(target=self._run, name="tarevis-audio", daemon=True)
            self._thread.start()
            return True

    def _run(self) -> None:
        failed = False
        try:
            from ..audio import (
                AudioEventPipeline,
                AudioPipelineConfig,
                FunAsrTranscriber,
                MicrophoneRecorder,
                MockTranscriber,
            )

            self.runtime.update_status(microphone="active", last_error=None)
            recorder = MicrophoneRecorder(
                sample_rate=self.config.sample_rate,
                channels=self.config.channels,
                device_index=self.config.device_index,
            )
            clip = recorder.record_fixed(self.config.seconds, self.config.output_path)
            transcriber = (
                MockTranscriber(self.config.mock_text)
                if self.config.transcriber == "mock"
                else FunAsrTranscriber(model_name=self.config.funasr_model)
            )
            pipeline = AudioEventPipeline(
                transcriber,
                AudioPipelineConfig(
                    device_id=self.config.device_id,
                    zone=self.config.zone,
                ),
            )
            for event in pipeline.process_wav(clip.path):
                self.runtime.emit(event)
        except Exception as exc:  # microphone and ASR are optional dependencies
            failed = True
            self.runtime.update_status(microphone="offline", last_error=str(exc))
        finally:
            if not failed:
                self.runtime.update_status(microphone="ready")
