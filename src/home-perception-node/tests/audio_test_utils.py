from __future__ import annotations

import math
import struct
import wave
from pathlib import Path


def write_tone_wav(
    path: Path,
    *,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    frequency: float = 440.0,
    amplitude: float = 0.4,
) -> None:
    frame_count = int(duration_seconds * sample_rate)
    samples = bytearray()
    for index in range(frame_count):
        value = int(32767 * amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
        samples.extend(struct.pack("<h", value))
    _write_pcm16(path, bytes(samples), sample_rate)


def write_silence_wav(
    path: Path,
    *,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
) -> None:
    frame_count = int(duration_seconds * sample_rate)
    _write_pcm16(path, b"\x00\x00" * frame_count, sample_rate)


def _write_pcm16(path: Path, raw: bytes, sample_rate: int) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(raw)
