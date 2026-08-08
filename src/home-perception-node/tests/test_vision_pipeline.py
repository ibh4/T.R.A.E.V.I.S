from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

from tarevis_home_node.cli import run
from tarevis_home_node.contracts import SensingEvent
from tarevis_home_node.vision import (
    MotionDetectorConfig,
    OpenCvVideoSource,
    SnapshotStore,
    VisionMotionMonitor,
    VisionMonitorConfig,
)
from tarevis_home_node.vision.motion import MotionDetector
from tarevis_home_node.vision.object_detector import Detection, MockObjectDetector
from tarevis_home_node.vision.preview import PreviewState
from vision_test_utils import make_motion_frames, write_video


class VisionPipelineTests(unittest.TestCase):
    def test_monitor_can_stop_before_reading_frames(self) -> None:
        class NeverReadSource:
            source_name = "never-read"
            is_live = False

            def __init__(self) -> None:
                self.closed = False

            def read(self, timeout_seconds: float = 2.0):
                raise AssertionError(f"source should not be read (timeout={timeout_seconds})")

            def close(self) -> None:
                self.closed = True

        source = NeverReadSource()
        monitor = VisionMotionMonitor(
            source=source,
            monitor_config=VisionMonitorConfig(
                device_id="rpi-home-01",
                width=96,
                height=72,
                target_fps=None,
                snapshots_enabled=False,
            ),
            detector_config=MotionDetectorConfig(warmup_frames=0, min_area=10),
        )

        batches = list(monitor.iter_event_batches(should_stop=lambda: True))

        self.assertEqual(batches, [])
        self.assertTrue(source.closed)

    def test_video_file_produces_motion_event_without_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = Path(temp_dir) / "motion.avi"
            write_video(video_path, make_motion_frames())
            source = OpenCvVideoSource(video_path, width=96, height=72)
            monitor = VisionMotionMonitor(
                source,
                VisionMonitorConfig(
                    device_id="pc-test",
                    width=96,
                    height=72,
                    target_fps=None,
                    snapshots_enabled=False,
                ),
                MotionDetectorConfig(
                    warmup_frames=5,
                    min_area=30,
                    min_score=0.002,
                    min_consecutive_frames=2,
                    cooldown_seconds=0,
                ),
            )

            events = list(monitor.iter_events())

        self.assertTrue(events)
        self.assertEqual(events[0].type, "motion_detected")
        self.assertIsNone(events[0].confidence)
        self.assertIn("motion_score", events[0].payload)

    def test_cli_emits_machine_readable_motion_event(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = Path(temp_dir) / "motion.avi"
            write_video(video_path, make_motion_frames())
            output = io.StringIO()

            result = run(
                [
                    "vision-motion",
                    "--source",
                    str(video_path),
                    "--width",
                    "96",
                    "--height",
                    "72",
                    "--target-fps",
                    "0",
                    "--warmup-frames",
                    "5",
                    "--min-area",
                    "30",
                    "--min-score",
                    "0.002",
                    "--min-consecutive-frames",
                    "2",
                    "--cooldown-seconds",
                    "0",
                    "--max-events",
                    "1",
                    "--no-snapshots",
                ],
                stdout=output,
            )

            event = SensingEvent.from_json(output.getvalue())

        self.assertEqual(result, 0)
        self.assertEqual(event.source.value, "vision")
        self.assertEqual(event.type, "motion_detected")

    def test_snapshot_store_prunes_old_files(self) -> None:
        frames = make_motion_frames()
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir) / "snapshots"
            store = SnapshotStore(directory, max_files=2)

            for index, frame in enumerate(frames[:3]):
                store.save(frame, camera_id="cam_test", frame_index=index)

            snapshots = list(directory.glob("*.jpg"))

        self.assertEqual(len(snapshots), 2)

    def test_preview_state_encodes_overlay(self) -> None:
        frames = make_motion_frames()
        detector = MotionDetector(
            MotionDetectorConfig(
                warmup_frames=0,
                min_area=30,
                min_score=0.002,
                min_consecutive_frames=1,
                cooldown_seconds=0,
            )
        )
        observation = detector.process(frames[-1], now=1.0)
        state = PreviewState()

        state.update(frames[-1], observation)

        self.assertTrue(state.get_jpeg())
        self.assertEqual(state.get_meta()["status"], "running")

    def test_object_detector_runs_only_after_motion_trigger(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = Path(temp_dir) / "motion.avi"
            write_video(video_path, make_motion_frames())
            object_detector = MockObjectDetector(
                [Detection(class_id=0, label="person", confidence=0.87, bbox=(10, 12, 20, 30))]
            )
            source = OpenCvVideoSource(video_path, width=96, height=72)
            monitor = VisionMotionMonitor(
                source,
                VisionMonitorConfig(
                    device_id="pc-test",
                    width=96,
                    height=72,
                    target_fps=None,
                    snapshots_enabled=False,
                ),
                MotionDetectorConfig(
                    warmup_frames=5,
                    min_area=30,
                    min_score=0.002,
                    min_consecutive_frames=2,
                    cooldown_seconds=100,
                ),
                object_detector=object_detector,
            )

            events = list(monitor.iter_events())

        self.assertEqual(object_detector.call_count, 1)
        self.assertEqual([event.type for event in events], ["motion_detected", "person_detected"])
        self.assertIsNone(events[0].confidence)
        self.assertAlmostEqual(events[1].confidence or 0, 0.87)
        self.assertEqual(events[1].payload["parent_event_id"], events[0].event_id)


if __name__ == "__main__":
    unittest.main()
