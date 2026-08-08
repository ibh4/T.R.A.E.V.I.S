from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class AudioStats:
    sample_rate: int
    channels: int
    sample_width: int
    frame_count: int
    duration_seconds: float
    rms: float

    def to_dict(self) -> dict[str, int | float]:
        return {
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "sample_width": self.sample_width,
            "frame_count": self.frame_count,
            "duration_seconds": round(self.duration_seconds, 6),
            "rms": round(self.rms, 8),
        }


@dataclass(frozen=True, slots=True)
class AudioClip:
    path: Path
    stats: AudioStats


def inspect_wav(path: Path) -> AudioClip:
    if not path.exists():
        raise FileNotFoundError(f"audio file does not exist: {path}")
    try:
        with wave.open(str(path), "rb") as wav_file:
            if wav_file.getcomptype() != "NONE":
                raise ValueError("audio file must use uncompressed PCM WAV")
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            raw = wav_file.readframes(frame_count)
    except wave.Error as exc:
        raise ValueError(f"invalid WAV file: {path}") from exc

    if channels < 1 or sample_rate < 1 or sample_width not in {1, 2, 3, 4}:
        raise ValueError("unsupported PCM WAV format")
    duration_seconds = frame_count / float(sample_rate)
    rms = calculate_normalized_pcm_rms(raw, sample_width)
    return AudioClip(
        path=path.resolve(),
        stats=AudioStats(
            sample_rate=sample_rate,
            channels=channels,
            sample_width=sample_width,
            frame_count=frame_count,
            duration_seconds=duration_seconds,
            rms=rms,
        ),
    )


def calculate_normalized_pcm_rms(raw: bytes, sample_width: int) -> float:
    if not raw:
        return 0.0
    samples = _decode_pcm_samples(raw, sample_width)
    if not samples:
        return 0.0
    mean_square = sum(sample * sample for sample in samples) / len(samples)
    max_value = float(1 << (sample_width * 8 - 1))
    return min(1.0, math.sqrt(mean_square) / max_value)


def list_input_devices() -> list[dict[str, Any]]:
    from ..media_devices import enumerate_microphone_devices

    return [device.to_dict() for device in enumerate_microphone_devices()]


def probe_input_device(
    *,
    duration_seconds: float = 0.6,
    sample_rate: int = 16000,
    channels: int = 1,
    device_index: int | None = None,
) -> dict[str, int | float | bool | None]:
    if not 0.2 <= duration_seconds <= 3.0:
        raise ValueError("duration_seconds must be between 0.2 and 3.0")
    if sample_rate < 1 or channels < 1:
        raise ValueError("sample_rate and channels must be positive")
    import numpy as np

    sd = _load_sounddevice()
    sd.check_input_settings(
        device=device_index,
        channels=channels,
        samplerate=sample_rate,
        dtype="int16",
    )
    frame_count = max(1, int(round(duration_seconds * sample_rate)))
    audio = sd.rec(
        frame_count,
        samplerate=sample_rate,
        channels=channels,
        dtype="int16",
        device=device_index,
    )
    sd.wait()
    normalized = np.asarray(audio, dtype=np.float64) / 32768.0
    rms = float(np.sqrt(np.mean(np.square(normalized)))) if normalized.size else 0.0
    peak = float(np.max(np.abs(normalized))) if normalized.size else 0.0
    return {
        "device_index": device_index,
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_seconds": round(frame_count / sample_rate, 6),
        "frame_count": frame_count,
        "rms": round(min(max(rms, 0.0), 1.0), 8),
        "peak": round(min(max(peak, 0.0), 1.0), 8),
        "has_signal": peak >= 0.003,
    }


class MicrophoneRecorder:
    def __init__(
        self,
        *,
        sample_rate: int = 16000,
        channels: int = 1,
        device_index: int | None = None,
    ) -> None:
        if sample_rate < 1 or channels < 1:
            raise ValueError("sample_rate and channels must be positive")
        self.sample_rate = sample_rate
        self.channels = channels
        self.device_index = device_index

    def record_fixed(self, duration_seconds: float, output_path: Path) -> AudioClip:
        if duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")
        sd = _load_sounddevice()
        frames = int(duration_seconds * self.sample_rate)
        audio = sd.rec(
            frames,
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="int16",
            device=self.device_index,
        )
        sd.wait()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(output_path), "wb") as wav_file:
            wav_file.setnchannels(self.channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(audio.tobytes())
        return inspect_wav(output_path)


def _load_sounddevice():
    try:
        import sounddevice as sd
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "microphone support requires the optional 'audio' dependencies"
        ) from exc
    return sd


def _decode_pcm_samples(raw: bytes, sample_width: int) -> list[int]:
    if sample_width == 1:
        return [value - 128 for value in raw]
    if sample_width == 2:
        usable = len(raw) - (len(raw) % 2)
        return [value[0] for value in struct.iter_unpack("<h", raw[:usable])]
    if sample_width == 4:
        usable = len(raw) - (len(raw) % 4)
        return [value[0] for value in struct.iter_unpack("<i", raw[:usable])]

    samples: list[int] = []
    usable = len(raw) - (len(raw) % 3)
    for index in range(0, usable, 3):
        value = int.from_bytes(raw[index : index + 3], "little", signed=False)
        if value & 0x800000:
            value -= 1 << 24
        samples.append(value)
    return samples
