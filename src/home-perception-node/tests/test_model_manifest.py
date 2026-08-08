from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tarevis_home_node.cli import run
from tarevis_home_node.vision import (
    Detection,
    MockObjectDetector,
    ObjectModelManifest,
    benchmark_detector,
)
from tarevis_home_node.vision.object_detector import sha256_file


class ObjectModelManifestTests(unittest.TestCase):
    def test_manifest_verifies_hashes_and_label_count(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = self._write_manifest(Path(temp_dir))

            manifest = ObjectModelManifest.load(manifest_path)
            report = manifest.verify(manifest_path)

        self.assertTrue(report["ready"])
        self.assertEqual(report["model_id"], "test-yolo")
        self.assertTrue(all(check["ok"] for check in report["checks"]))

    def test_cli_returns_failure_when_model_hash_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = self._write_manifest(root)
            (root / "model.onnx").write_bytes(b"changed")
            output = io.StringIO()

            result = run(["model-verify", "--manifest", str(manifest_path)], stdout=output)
            report = json.loads(output.getvalue())

        self.assertEqual(result, 1)
        self.assertFalse(report["ready"])

    def test_benchmark_reports_p95_throughput_and_detections(self) -> None:
        detector = MockObjectDetector(
            [Detection(class_id=0, label="person", confidence=0.9, bbox=(1, 2, 3, 4))]
        )

        report = benchmark_detector(
            detector,
            iterations=5,
            warmup_iterations=2,
            frame=np.zeros((32, 48, 3), dtype=np.uint8),
        )

        self.assertEqual(report["warmup_iterations"], 2)
        self.assertEqual(report["frame_size"], {"width": 48, "height": 32})
        self.assertGreaterEqual(report["p95_ms"], report["median_ms"])
        self.assertIsNotNone(report["throughput_fps"])
        self.assertEqual(report["detections"][0]["label"], "person")

    def _write_manifest(self, root: Path) -> Path:
        model = root / "model.onnx"
        labels = root / "labels.txt"
        manifest = root / "manifest.json"
        model.write_bytes(b"model-data")
        labels.write_text("person\ncat\n", encoding="utf-8")
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "model_id": "test-yolo",
                    "version": "1",
                    "source_url": "https://example.test/model",
                    "license": "test-only",
                    "model_file": model.name,
                    "model_sha256": sha256_file(model),
                    "labels_file": labels.name,
                    "labels_sha256": sha256_file(labels),
                    "input_width": 640,
                    "input_height": 640,
                    "class_count": 2,
                }
            ),
            encoding="utf-8",
        )
        return manifest


if __name__ == "__main__":
    unittest.main()
