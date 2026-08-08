from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from audio_test_utils import write_silence_wav, write_tone_wav
from tarevis_home_node.audio.sources import inspect_wav, probe_input_device


class AudioSourceTests(unittest.TestCase):
    def test_inspect_wav_reports_duration_and_rms(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "tone.wav"
            write_tone_wav(path, duration_seconds=0.5)

            clip = inspect_wav(path)

        self.assertAlmostEqual(clip.stats.duration_seconds, 0.5, places=2)
        self.assertEqual(clip.stats.sample_rate, 16000)
        self.assertGreater(clip.stats.rms, 0.1)

    def test_silence_has_zero_rms(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "silence.wav"
            write_silence_wav(path)

            clip = inspect_wav(path)

        self.assertEqual(clip.stats.rms, 0.0)

    def test_microphone_probe_reports_in_memory_signal_level(self) -> None:
        class FakeSoundDevice:
            def __init__(self) -> None:
                self.checked: dict[str, object] | None = None

            def check_input_settings(self, **values: object) -> None:
                self.checked = values

            def rec(self, frames: int, **_values: object) -> np.ndarray:
                samples = np.zeros((frames, 1), dtype=np.int16)
                samples[::2] = 8192
                return samples

            def wait(self) -> None:
                pass

        fake = FakeSoundDevice()
        with patch("tarevis_home_node.audio.sources._load_sounddevice", return_value=fake):
            report = probe_input_device(duration_seconds=0.2, device_index=4)

        self.assertEqual(report["device_index"], 4)
        self.assertTrue(report["has_signal"])
        self.assertGreater(report["rms"], 0.1)
        self.assertEqual(fake.checked["samplerate"], 16000)  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
