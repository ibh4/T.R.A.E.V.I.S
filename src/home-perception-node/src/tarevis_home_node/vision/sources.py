from __future__ import annotations

import importlib
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import cv2
import numpy as np

Frame = np.ndarray
VideoSourceValue = int | str
PICAMERA2_SCHEME = "picamera2"


class VideoSource(Protocol):
    source_name: str
    is_live: bool

    def read(self, timeout_seconds: float = 2.0) -> tuple[bool, Frame | None]: ...

    def close(self) -> None: ...


class _LatestFrameReader:
    def __init__(self, capture: cv2.VideoCapture) -> None:
        self.capture = capture
        self._stop_event = threading.Event()
        self._ready_event = threading.Event()
        self._lock = threading.Lock()
        self._latest_frame: Frame | None = None
        self._thread = threading.Thread(target=self._read_loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def read(self, timeout_seconds: float = 2.0) -> tuple[bool, Frame | None]:
        if not self._ready_event.wait(timeout_seconds):
            return False, None
        with self._lock:
            if self._latest_frame is None:
                return False, None
            return True, self._latest_frame.copy()

    def close(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2.0)

    def _read_loop(self) -> None:
        try:
            while not self._stop_event.is_set():
                ok, frame = self.capture.read()
                if not ok or frame is None:
                    return
                with self._lock:
                    self._latest_frame = frame
                self._ready_event.set()
        finally:
            self._ready_event.set()


class OpenCvVideoSource:
    def __init__(
        self,
        source: VideoSourceValue,
        *,
        width: int = 640,
        height: int = 480,
    ) -> None:
        parsed_source = parse_video_source(source)
        self.source_name = str(parsed_source)
        self.is_live = isinstance(parsed_source, int)
        self._capture = cv2.VideoCapture(parsed_source)
        self._closed = False
        self._latest_reader: _LatestFrameReader | None = None

        if not self._capture.isOpened():
            self._capture.release()
            raise RuntimeError(f"unable to open video source: {source}")

        if width > 0:
            self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        if height > 0:
            self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

        if self.is_live:
            self._capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            self._latest_reader = _LatestFrameReader(self._capture)
            self._latest_reader.start()

    def read(self, timeout_seconds: float = 2.0) -> tuple[bool, Frame | None]:
        if self._closed:
            return False, None
        if self._latest_reader is not None:
            return self._latest_reader.read(timeout_seconds)
        ok, frame = self._capture.read()
        return (True, frame) if ok and frame is not None else (False, None)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._latest_reader is not None:
            self._latest_reader.close()
        self._capture.release()

    def __enter__(self) -> "OpenCvVideoSource":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


class Picamera2VideoSource:
    """Picamera2-backed CSI source that returns OpenCV-compatible BGR frames."""

    def __init__(
        self,
        camera_number: int = 0,
        *,
        width: int = 640,
        height: int = 480,
        camera_factory: Callable[[int], Any] | None = None,
    ) -> None:
        if camera_number < 0:
            raise ValueError("Picamera2 camera number must be non-negative")
        if width <= 0 or height <= 0:
            raise ValueError("Picamera2 width and height must be positive")

        self.source_name = f"{PICAMERA2_SCHEME}://{camera_number}"
        self.is_live = True
        self._closed = False
        factory = camera_factory or _load_picamera2_factory()
        self._camera = factory(camera_number)
        try:
            # Picamera2's RGB888 array layout is B, G, R, which matches OpenCV.
            configuration = self._camera.create_video_configuration(
                main={"size": (width, height), "format": "RGB888"},
                buffer_count=4,
            )
            self._camera.configure(configuration)
            self._camera.start()
        except Exception:
            self._camera.close()
            raise

    def read(self, timeout_seconds: float = 2.0) -> tuple[bool, Frame | None]:
        del timeout_seconds  # Picamera2 capture requests are synchronized by libcamera.
        if self._closed:
            return False, None
        frame = self._camera.capture_array("main")
        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            return False, None
        return True, frame

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._camera.stop()
        finally:
            self._camera.close()

    def __enter__(self) -> "Picamera2VideoSource":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


def create_video_source(
    source: VideoSourceValue,
    *,
    width: int = 640,
    height: int = 480,
) -> VideoSource:
    camera_number = parse_picamera2_source(source)
    if camera_number is not None:
        return Picamera2VideoSource(camera_number, width=width, height=height)
    return OpenCvVideoSource(source, width=width, height=height)


def parse_video_source(source: VideoSourceValue) -> VideoSourceValue:
    if isinstance(source, int):
        return source
    text = str(source).strip()
    if text.isdigit():
        return int(text)
    path = Path(text)
    if path.exists():
        return str(path.resolve())
    return text


def parse_picamera2_source(source: VideoSourceValue) -> int | None:
    if isinstance(source, int):
        return None
    text = str(source).strip()
    if text.lower() == PICAMERA2_SCHEME:
        return 0
    parsed = urlparse(text)
    if parsed.scheme.lower() != PICAMERA2_SCHEME:
        return None
    if parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment or parsed.path:
        raise ValueError(f"invalid Picamera2 source: {source}")
    if not parsed.hostname or not parsed.hostname.isdigit():
        raise ValueError(f"invalid Picamera2 source: {source}")
    return int(parsed.hostname)


def _load_picamera2_factory() -> Callable[[int], Any]:
    try:
        module = importlib.import_module("picamera2")
    except ImportError as exc:
        raise RuntimeError(
            "Picamera2 is required for picamera2:// sources; "
            "install python3-picamera2 with apt on Raspberry Pi OS"
        ) from exc
    return module.Picamera2
