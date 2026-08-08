from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_test_utils import write_tone_wav
from tarevis_home_node.audio import inspect_wav
from tarevis_home_node.ui.runtime import UiRuntime
from tarevis_home_node.ui.workers import (
    AudioSampleWorker,
    AudioWorkerConfig,
    PreviewBuffer,
    VisionWorker,
    VisionWorkerConfig,
)
from vision_test_utils import make_motion_frames, write_video


class UiWorkerTests(unittest.TestCase):
    def test_video_worker_updates_preview_emits_motion_and_returns_to_standby(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_path = root / "motion.avi"
            snapshots_dir = root / "snapshots"
            write_video(video_path, make_motion_frames())
            runtime = UiRuntime("rpi-home-01")
            preview = PreviewBuffer()
            worker = VisionWorker(
                runtime,
                preview,
                VisionWorkerConfig(
                    source=str(video_path),
                    device_id="rpi-home-01",
                    zone="living_room",
                    width=96,
                    height=72,
                    target_fps=None,
                    snapshots_dir=snapshots_dir,
                    warmup_frames=2,
                    min_area=10,
                    min_score=0.001,
                    min_consecutive_frames=1,
                    cooldown_seconds=0.0,
                ),
            )

            self.assertTrue(worker.start())
            self._wait_until_stopped(worker)

            snapshot = runtime.snapshot()
            motion_events = [event for event in snapshot["events"] if event["type"] == "motion_detected"]
            self.assertEqual(snapshot["camera"], "standby")
            self.assertEqual(snapshot["vision_fps"], 0.0)
            self.assertIsNotNone(preview.get_jpeg())
            self.assertGreaterEqual(len(motion_events), 1)
            self.assertTrue(motion_events[0]["snapshot_url"].startswith("/media/snapshots/"))
            self.assertTrue(any(snapshots_dir.glob("*.jpg")))

    def test_audio_worker_routes_real_wav_pipeline_into_ui_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "help.wav"
            write_tone_wav(audio_path)
            clip = inspect_wav(audio_path)
            runtime = UiRuntime("rpi-home-01")

            class FakeRecorder:
                def __init__(self, **_kwargs: object) -> None:
                    pass

                def record_fixed(self, _seconds: float, _output_path: Path):
                    return clip

            worker = AudioSampleWorker(
                runtime,
                AudioWorkerConfig(
                    device_id="rpi-home-01",
                    zone="living_room",
                    mock_text="请帮帮我",
                ),
            )
            with patch("tarevis_home_node.audio.MicrophoneRecorder", FakeRecorder):
                self.assertTrue(worker.start())
                self._wait_until_stopped(worker)

            snapshot = runtime.snapshot()
            event_types = {event["type"] for event in snapshot["events"]}
            self.assertEqual(snapshot["microphone"], "ready")
            self.assertEqual(snapshot["last_transcript"], "请帮帮我")
            self.assertIn("speech_transcribed", event_types)
            self.assertIn("help_keyword_detected", event_types)

    def _wait_until_stopped(self, worker: VisionWorker | AudioSampleWorker) -> None:
        deadline = time.monotonic() + 5.0
        while worker.running and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(worker.running, "worker did not finish before timeout")


if __name__ == "__main__":
    unittest.main()
