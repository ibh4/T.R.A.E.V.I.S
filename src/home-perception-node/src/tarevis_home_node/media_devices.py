from __future__ import annotations

import json
import re
import tempfile
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

MediaKind = Literal["camera", "microphone"]


@dataclass(frozen=True, slots=True)
class MediaDevice:
    kind: MediaKind
    stable_id: str
    name: str
    index: int
    backend: str | None = None
    max_input_channels: int | None = None
    default_sample_rate: float | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    frame_rate: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class MediaSettings:
    camera_id: str | None = None
    camera_index: int | None = None
    microphone_id: str | None = None
    microphone_index: int | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class MediaInventory:
    scanned_at: str
    cameras: tuple[MediaDevice, ...]
    microphones: tuple[MediaDevice, ...]
    settings: MediaSettings
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "scanned_at": self.scanned_at,
            "cameras": [device.to_dict() for device in self.cameras],
            "microphones": [device.to_dict() for device in self.microphones],
            "settings": self.settings.to_dict(),
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class MediaTestResult:
    kind: MediaKind
    ok: bool
    stable_id: str | None
    message: str
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class MediaSettingsStore:
    """Small atomic JSON store for local device choices.

    The file contains configuration only; it never stores camera frames or audio.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> MediaSettings:
        if not self.path.exists():
            return MediaSettings()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"unable to read media settings: {self.path}") from exc
        if not isinstance(data, dict):
            raise ValueError("media settings must be a JSON object")
        return MediaSettings(
            camera_id=_optional_text(data.get("camera_id")),
            camera_index=_optional_index(data.get("camera_index")),
            microphone_id=_optional_text(data.get("microphone_id")),
            microphone_index=_optional_index(data.get("microphone_index")),
            updated_at=_optional_text(data.get("updated_at")),
        )

    def save(self, settings: MediaSettings) -> MediaSettings:
        updated = replace(
            settings,
            updated_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary_name = tempfile.mkstemp(
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            dir=str(self.path.parent),
        )
        try:
            with open(handle, "w", encoding="utf-8", newline="\n") as temporary:
                json.dump(updated.to_dict(), temporary, ensure_ascii=False, indent=2)
                temporary.write("\n")
            Path(temporary_name).replace(self.path)
        finally:
            temporary_path = Path(temporary_name)
            if temporary_path.exists():
                temporary_path.unlink()
        return updated


class MediaDeviceManager:
    def __init__(self, settings_path: Path = Path("data/media-settings.json")) -> None:
        self.store = MediaSettingsStore(settings_path)
        self._last_inventory: MediaInventory | None = None

    def inventory(self, *, refresh: bool = False) -> MediaInventory:
        if self._last_inventory is not None and not refresh:
            return self._last_inventory
        warnings: list[str] = []
        try:
            cameras = tuple(enumerate_video_devices())
        except RuntimeError as exc:
            cameras = ()
            warnings.append(str(exc))
        try:
            microphones = tuple(enumerate_microphone_devices())
        except RuntimeError as exc:
            microphones = ()
            warnings.append(str(exc))
        settings = self._reconcile_settings(self.store.load(), cameras, microphones)
        self._last_inventory = MediaInventory(
            scanned_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            cameras=cameras,
            microphones=microphones,
            settings=settings,
            warnings=tuple(warnings),
        )
        return self._last_inventory

    def save(self, values: dict[str, Any]) -> MediaInventory:
        inventory = self.inventory(refresh=True)
        settings = self._settings_from_values(values, inventory)
        saved = self.store.save(settings)
        self._last_inventory = replace(inventory, settings=saved)
        return self._last_inventory

    def resolve_camera_source(self) -> str | None:
        settings = self.store.load()
        return str(settings.camera_index) if settings.camera_index is not None else None

    def resolve_microphone_index(self) -> int | None:
        return self.store.load().microphone_index

    def test_camera(self, stable_id: str | None = None) -> MediaTestResult:
        inventory = self.inventory(refresh=True)
        device = _find_device(inventory.cameras, stable_id or inventory.settings.camera_id)
        if device is None:
            return MediaTestResult("camera", False, stable_id, "没有可测试的摄像头", {})
        try:
            import cv2

            capture = cv2.VideoCapture(device.index)
            try:
                if not capture.isOpened():
                    return MediaTestResult("camera", False, device.stable_id, "摄像头无法打开", {})
                ok, frame = capture.read()
                if not ok or frame is None:
                    return MediaTestResult("camera", False, device.stable_id, "摄像头未返回画面", {})
                height, width = frame.shape[:2]
                return MediaTestResult(
                    "camera",
                    True,
                    device.stable_id,
                    "摄像头测试通过",
                    {"width": int(width), "height": int(height)},
                )
            finally:
                capture.release()
        except Exception as exc:  # optional drivers expose backend-specific exception types
            return MediaTestResult("camera", False, device.stable_id, f"摄像头测试失败: {exc}", {})

    def test_microphone(
        self,
        stable_id: str | None = None,
        *,
        duration_seconds: float = 0.6,
    ) -> MediaTestResult:
        inventory = self.inventory(refresh=True)
        device = _find_device(inventory.microphones, stable_id or inventory.settings.microphone_id)
        if device is None:
            return MediaTestResult("microphone", False, stable_id, "没有可测试的麦克风", {})
        try:
            from .audio import probe_input_device

            details = probe_input_device(
                device_index=device.index,
                duration_seconds=duration_seconds,
            )
            level = round(float(details["rms"]) * 100)
            return MediaTestResult(
                "microphone",
                True,
                device.stable_id,
                f"麦克风采样通过，输入电平 {level}%",
                details,
            )
        except Exception as exc:  # optional drivers expose backend-specific exception types
            return MediaTestResult("microphone", False, device.stable_id, f"麦克风测试失败: {exc}", {})

    @staticmethod
    def _reconcile_settings(
        settings: MediaSettings,
        cameras: tuple[MediaDevice, ...],
        microphones: tuple[MediaDevice, ...],
    ) -> MediaSettings:
        camera = _find_device(cameras, settings.camera_id)
        microphone = _find_device(microphones, settings.microphone_id)
        return replace(
            settings,
            camera_index=camera.index if camera is not None else settings.camera_index,
            microphone_index=microphone.index if microphone is not None else settings.microphone_index,
        )

    @staticmethod
    def _settings_from_values(values: dict[str, Any], inventory: MediaInventory) -> MediaSettings:
        camera_id = _optional_text(values.get("camera_id"))
        microphone_id = _optional_text(values.get("microphone_id"))
        camera = _find_device(inventory.cameras, camera_id)
        microphone = _find_device(inventory.microphones, microphone_id)
        if camera_id is not None and camera is None:
            raise ValueError("selected camera is not present in the current inventory")
        if microphone_id is not None and microphone is None:
            raise ValueError("selected microphone is not present in the current inventory")
        return MediaSettings(
            camera_id=camera.stable_id if camera is not None else None,
            camera_index=camera.index if camera is not None else None,
            microphone_id=microphone.stable_id if microphone is not None else None,
            microphone_index=microphone.index if microphone is not None else None,
        )


def enumerate_video_devices(*, max_indices: int = 10) -> list[MediaDevice]:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("摄像头枚举需要安装 vision 依赖") from exc
    devices: list[MediaDevice] = []
    for index in range(max_indices):
        try:
            capture = cv2.VideoCapture(index)
        except Exception:
            continue
        try:
            if not capture.isOpened():
                continue
            backend = str(capture.getBackendName() or "opencv")
            width = _positive_int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = _positive_int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = _positive_float(capture.get(cv2.CAP_PROP_FPS))
            devices.append(
                MediaDevice(
                    kind="camera",
                    stable_id=f"opencv:{_slug(backend)}:{index}",
                    name=f"OpenCV 摄像头 {index}",
                    index=index,
                    backend=backend,
                    frame_width=width,
                    frame_height=height,
                    frame_rate=fps,
                )
            )
        finally:
            capture.release()
    return devices


def enumerate_microphone_devices() -> list[MediaDevice]:
    try:
        import sounddevice as sd
    except ImportError as exc:
        raise RuntimeError("麦克风枚举需要安装 audio 依赖") from exc
    devices: list[MediaDevice] = []
    hostapis: list[dict[str, Any]] = []
    try:
        hostapis = list(sd.query_hostapis())
    except (AttributeError, RuntimeError):
        pass
    for index, device in enumerate(sd.query_devices()):
        max_input_channels = int(device.get("max_input_channels", 0))
        if max_input_channels <= 0:
            continue
        hostapi_index = int(device.get("hostapi", -1))
        hostapi_name = "unknown"
        if 0 <= hostapi_index < len(hostapis):
            hostapi_name = str(hostapis[hostapi_index].get("name", hostapi_name))
        name = str(device.get("name", "unknown"))
        devices.append(
            MediaDevice(
                kind="microphone",
                stable_id=f"portaudio:{_slug(hostapi_name)}:{_slug(name)}",
                name=name,
                index=index,
                backend=hostapi_name,
                max_input_channels=max_input_channels,
                default_sample_rate=_positive_float(device.get("default_samplerate", 0.0)),
            )
        )
    return devices


def _find_device(devices: tuple[MediaDevice, ...] | list[MediaDevice], stable_id: str | None) -> MediaDevice | None:
    if stable_id is None:
        return None
    return next((device for device in devices if device.stable_id == stable_id), None)


def _optional_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if not text or len(text) > 255:
        raise ValueError("media device identifier is invalid")
    return text


def _optional_index(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("media device index must be an integer")
    index = int(value)
    if index < 0:
        raise ValueError("media device index must not be negative")
    return index


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "unknown"


def _positive_int(value: Any) -> int | None:
    try:
        result = int(float(value))
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _positive_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None
