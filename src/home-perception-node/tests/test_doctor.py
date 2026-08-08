from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tarevis_home_node.doctor import CheckResult, run_doctor


class DoctorTests(unittest.TestCase):
    def test_core_profile_is_ready_on_supported_python(self) -> None:
        report = run_doctor(profile="core")

        self.assertEqual(report["profile"], "core")
        self.assertEqual(report["ready"], sys.version_info >= (3, 11))

    def test_missing_required_package_marks_profile_not_ready(self) -> None:
        real_find_spec = importlib.util.find_spec

        def fake_find_spec(name: str):
            if name == "sounddevice":
                return None
            return real_find_spec(name)

        with patch("tarevis_home_node.doctor.importlib.util.find_spec", side_effect=fake_find_spec):
            report = run_doctor(profile="audio")

        self.assertFalse(report["ready"])
        failed_names = {check["name"] for check in report["checks"] if not check["ok"]}
        self.assertIn("python_package:sounddevice", failed_names)
        self.assertIn("audio_input", failed_names)

    def test_model_and_labels_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            model = Path(temp_dir) / "model.onnx"
            labels = Path(temp_dir) / "labels.txt"
            model.write_bytes(b"model-data")
            labels.write_text("person\ncat\n", encoding="utf-8")

            report = run_doctor(
                profile="core",
                model_path=model,
                labels_path=labels,
            )

        details = {check["name"]: check for check in report["checks"]}
        self.assertTrue(details["object_model"]["ok"])
        self.assertIn("labels=2", details["object_labels"]["detail"])

    def test_raspberry_pi_camera_profile_excludes_audio_and_asr(self) -> None:
        hardware = CheckResult("raspberry_pi_hardware", True, True, "Raspberry Pi 4 Model B")
        camera = CheckResult("camera_device", True, True, "/dev/video0")
        with (
            patch("tarevis_home_node.doctor.importlib.util.find_spec", return_value=object()),
            patch("tarevis_home_node.doctor._raspberry_pi_check", return_value=hardware),
            patch("tarevis_home_node.doctor._camera_device_check", return_value=camera),
        ):
            report = run_doctor(profile="raspberry-pi-camera")

        names = {check["name"] for check in report["checks"]}
        self.assertTrue(report["ready"])
        self.assertIn("python_package:picamera2", names)
        self.assertIn("camera_device", names)
        self.assertNotIn("python_package:sounddevice", names)
        self.assertNotIn("python_package:funasr", names)
        self.assertNotIn("audio_input", names)


if __name__ == "__main__":
    unittest.main()
