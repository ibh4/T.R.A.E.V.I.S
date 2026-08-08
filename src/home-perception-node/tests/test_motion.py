from __future__ import annotations

import unittest

import numpy as np

from tarevis_home_node.vision.motion import MotionDetector, MotionDetectorConfig, parse_roi
from vision_test_utils import make_motion_frames


class MotionDetectorTests(unittest.TestCase):
    def test_static_frames_do_not_trigger_after_warmup(self) -> None:
        detector = MotionDetector(
            MotionDetectorConfig(
                warmup_frames=4,
                min_area=30,
                min_score=0.002,
                min_consecutive_frames=2,
                cooldown_seconds=0,
            )
        )
        frame = np.zeros((72, 96, 3), dtype=np.uint8)

        observations = [detector.process(frame, now=float(index)) for index in range(10)]

        self.assertFalse(any(item.triggered for item in observations))

    def test_moving_shape_triggers_motion_event(self) -> None:
        detector = MotionDetector(
            MotionDetectorConfig(
                warmup_frames=5,
                min_area=30,
                min_score=0.002,
                min_consecutive_frames=2,
                cooldown_seconds=0,
            )
        )

        observations = [
            detector.process(frame, now=float(index))
            for index, frame in enumerate(make_motion_frames())
        ]

        triggered = [item for item in observations if item.triggered]
        self.assertTrue(triggered)
        self.assertGreater(triggered[0].motion_score, 0)
        self.assertGreater(triggered[0].bbox[2], 0)

    def test_parse_roi_rejects_out_of_bounds_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "ROI"):
            parse_roi("0.8,0,0.4,1")


if __name__ == "__main__":
    unittest.main()
