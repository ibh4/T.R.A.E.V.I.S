from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import os
import platform
import shutil
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class CheckResult:
    name: str
    ok: bool
    required: bool
    detail: str


_PROFILE_PACKAGES: dict[str, tuple[tuple[str, str], ...]] = {
    "core": (),
    "vision": (("cv2", "opencv-python-headless"), ("numpy", "numpy")),
    "audio": (("sounddevice", "sounddevice"),),
    "asr": (("funasr", "funasr"), ("torch", "torch"), ("torchaudio", "torchaudio")),
    "raspberry-pi-camera": (
        ("cv2", "opencv-python-headless"),
        ("numpy", "numpy"),
        ("picamera2", "picamera2"),
    ),
    "raspberry-pi": (
        ("cv2", "opencv-python-headless"),
        ("numpy", "numpy"),
        ("picamera2", "picamera2"),
        ("sounddevice", "sounddevice"),
        ("funasr", "funasr"),
        ("torch", "torch"),
        ("torchaudio", "torchaudio"),
    ),
}


def run_doctor(
    *,
    profile: str,
    model_path: Path | None = None,
    labels_path: Path | None = None,
) -> dict[str, Any]:
    if profile not in _PROFILE_PACKAGES:
        raise ValueError(f"unknown doctor profile: {profile}")

    checks = [_python_check(), *_package_checks(profile)]
    if profile in {"audio", "asr", "raspberry-pi"}:
        checks.append(_executable_check("ffmpeg", required=profile in {"asr", "raspberry-pi"}))
    if profile in {"audio", "raspberry-pi"}:
        checks.append(_audio_device_check(required=True))
    if profile in {"raspberry-pi-camera", "raspberry-pi"}:
        checks.extend([_raspberry_pi_check(), _camera_device_check()])
    if model_path is not None:
        checks.append(_model_check(model_path))
    if labels_path is not None:
        checks.append(_labels_check(labels_path))

    ready = all(check.ok for check in checks if check.required)
    return {
        "profile": profile,
        "ready": ready,
        "system": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "executable": sys.executable,
            "processor_count": os.cpu_count(),
        },
        "checks": [asdict(check) for check in checks],
    }


def _python_check() -> CheckResult:
    supported = sys.version_info >= (3, 11)
    return CheckResult(
        name="python",
        ok=supported,
        required=True,
        detail=f"{platform.python_version()} (requires >= 3.11)",
    )


def _package_checks(profile: str) -> list[CheckResult]:
    return [
        _package_check(module_name, distribution_name)
        for module_name, distribution_name in _PROFILE_PACKAGES[profile]
    ]


def _package_check(module_name: str, distribution_name: str) -> CheckResult:
    available = importlib.util.find_spec(module_name) is not None
    version = "not installed"
    if available:
        try:
            version = importlib.metadata.version(distribution_name)
        except importlib.metadata.PackageNotFoundError:
            version = "installed; version metadata unavailable"
    return CheckResult(
        name=f"python_package:{module_name}",
        ok=available,
        required=True,
        detail=version,
    )


def _executable_check(name: str, *, required: bool) -> CheckResult:
    path = shutil.which(name)
    return CheckResult(
        name=f"executable:{name}",
        ok=path is not None,
        required=required,
        detail=path or "not found on PATH",
    )


def _audio_device_check(*, required: bool) -> CheckResult:
    if importlib.util.find_spec("sounddevice") is None:
        return CheckResult(
            name="audio_input",
            ok=False,
            required=required,
            detail="sounddevice is not installed",
        )
    try:
        from .audio.sources import list_input_devices

        devices = list_input_devices()
    except Exception as exc:
        return CheckResult(
            name="audio_input",
            ok=False,
            required=required,
            detail=f"unable to query input devices: {exc}",
        )
    return CheckResult(
        name="audio_input",
        ok=bool(devices),
        required=required,
        detail=f"{len(devices)} input device(s)",
    )


def _raspberry_pi_check() -> CheckResult:
    model_path = Path("/proc/device-tree/model")
    model = ""
    if model_path.exists():
        model = model_path.read_text(encoding="utf-8", errors="replace").rstrip("\x00\n")
    is_pi = "raspberry pi" in model.lower()
    return CheckResult(
        name="raspberry_pi_hardware",
        ok=is_pi,
        required=True,
        detail=model or "Raspberry Pi model information not found",
    )


def _camera_device_check() -> CheckResult:
    devices = sorted(Path("/dev").glob("video*")) if Path("/dev").exists() else []
    return CheckResult(
        name="camera_device",
        ok=bool(devices),
        required=True,
        detail=", ".join(str(path) for path in devices) or "no /dev/video* device found",
    )


def _model_check(path: Path) -> CheckResult:
    if not path.exists():
        return CheckResult("object_model", False, True, f"not found: {path}")
    try:
        digest = _sha256_file(path)
    except Exception as exc:
        return CheckResult("object_model", False, True, f"unable to hash model: {exc}")
    return CheckResult(
        name="object_model",
        ok=True,
        required=True,
        detail=f"{path} bytes={path.stat().st_size} sha256={digest}",
    )


def _labels_check(path: Path) -> CheckResult:
    try:
        labels = tuple(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
        if not labels:
            raise ValueError(f"label file is empty: {path}")
    except Exception as exc:
        return CheckResult("object_labels", False, True, str(exc))
    return CheckResult(
        name="object_labels",
        ok=True,
        required=True,
        detail=f"{path} labels={len(labels)}",
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()
