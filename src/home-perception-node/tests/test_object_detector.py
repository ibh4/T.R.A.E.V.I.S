from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from tarevis_home_node.vision.object_detector import (
    LetterboxTransform,
    decode_yolov8_output,
    load_labels,
)


class ObjectDetectorTests(unittest.TestCase):
    def test_decodes_yolov8_channel_first_output(self) -> None:
        output = np.zeros((1, 6, 2), dtype=np.float32)
        output[0, :, 0] = [50, 50, 20, 30, 0.9, 0.1]
        output[0, :, 1] = [52, 52, 20, 30, 0.8, 0.2]

        detections = decode_yolov8_output(
            output,
            labels=("person", "cat"),
            transform=LetterboxTransform(
                scale=1.0,
                pad_x=0,
                pad_y=0,
                original_width=100,
                original_height=100,
            ),
            confidence_threshold=0.25,
            nms_threshold=0.45,
        )

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].label, "person")
        self.assertAlmostEqual(detections[0].confidence, 0.9, places=5)
        self.assertEqual(detections[0].bbox, (40, 35, 20, 30))

    def test_rejects_output_with_wrong_label_count(self) -> None:
        output = np.zeros((1, 84, 10), dtype=np.float32)

        with self.assertRaisesRegex(ValueError, "labels"):
            decode_yolov8_output(
                output,
                labels=("person",),
                transform=LetterboxTransform(1.0, 0, 0, 100, 100),
                confidence_threshold=0.25,
                nms_threshold=0.45,
            )

    def test_load_labels_ignores_blank_lines_and_comments(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "labels.txt"
            path.write_text("person\n\n# comment\ncat\n", encoding="utf-8")

            labels = load_labels(path)

        self.assertEqual(labels, ("person", "cat"))


if __name__ == "__main__":
    unittest.main()
