import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from voice_monitor import ConfigurationError, MonitorConfig, iter_detected_keywords


class FakeStream:
    def accept_waveform(self, sample_rate, samples):
        self.sample_rate = sample_rate
        self.samples = samples
        self.ready = True


class FakeSpotter:
    def __init__(self, results):
        self.results = iter(results)
        self.current = ""
        self.resets = 0

    def create_stream(self):
        return FakeStream()

    def is_ready(self, stream):
        return stream.ready

    def decode_stream(self, stream):
        self.current = next(self.results, "")
        stream.ready = False

    def get_result(self, stream):
        return self.current

    def reset_stream(self, stream):
        self.resets += 1


class MonitorConfigTest(unittest.TestCase):
    def test_relative_paths_are_resolved_from_config_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "model_dir": "models/kws",
                        "keywords_raw": "raw.txt",
                        "keywords_file": "keywords.txt",
                    }
                ),
                encoding="utf-8",
            )

            config = MonitorConfig.load(config_path)

            self.assertEqual(config.model_dir, Path(directory) / "models" / "kws")
            self.assertEqual(config.sample_rate, 16000)

    def test_invalid_threshold_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "model_dir": "model",
                        "keywords_raw": "raw.txt",
                        "keywords_file": "keywords.txt",
                        "kws": {"keywords_threshold": 1.1},
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ConfigurationError):
                MonitorConfig.load(config_path)


class DetectionTest(unittest.TestCase):
    def test_detection_resets_stream_and_applies_cooldown(self):
        spotter = FakeSpotter(["你好搭子", "你好搭子", "你好搭子"])
        blocks = iter([np.zeros(1600, dtype=np.float32) for _ in range(3)])
        times = iter([1.0, 1.2, 3.0])

        detected = list(
            iter_detected_keywords(
                spotter,
                blocks,
                sample_rate=16000,
                cooldown_seconds=1.5,
                clock=lambda: next(times),
            )
        )

        self.assertEqual(detected, ["你好搭子", "你好搭子"])
        self.assertEqual(spotter.resets, 3)


if __name__ == "__main__":
    unittest.main()
