from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from tarevis_home_node.media_devices import (
    MediaDevice,
    MediaDeviceManager,
    MediaSettings,
    MediaSettingsStore,
)
from tarevis_home_node.ui.runtime import UiRuntime
from tarevis_home_node.ui.service import create_app


def camera(stable_id: str = "opencv:msmf:0", index: int = 0) -> MediaDevice:
    return MediaDevice(
        kind="camera",
        stable_id=stable_id,
        name="Front camera",
        index=index,
        backend="MSMF",
        frame_width=640,
        frame_height=480,
        frame_rate=30.0,
    )


def microphone(stable_id: str = "portaudio:wasapi:mic", index: int = 3) -> MediaDevice:
    return MediaDevice(
        kind="microphone",
        stable_id=stable_id,
        name="Desk microphone",
        index=index,
        backend="WASAPI",
        max_input_channels=2,
        default_sample_rate=48000.0,
    )


class MediaDeviceTests(unittest.TestCase):
    def test_settings_store_round_trips_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "data" / "media-settings.json"
            store = MediaSettingsStore(path)
            saved = store.save(MediaSettings(camera_id="opencv:msmf:0", camera_index=0))
            restored = store.load()

        self.assertIsNotNone(saved.updated_at)
        self.assertEqual(restored.camera_id, "opencv:msmf:0")
        self.assertEqual(restored.camera_index, 0)
        self.assertNotIn(".tmp", json.dumps(restored.to_dict()))

    def test_inventory_reconciles_index_from_stable_id(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = MediaDeviceManager(Path(temp_dir) / "media-settings.json")
            manager.store.save(
                MediaSettings(
                    camera_id="opencv:msmf:0",
                    camera_index=0,
                    microphone_id="portaudio:wasapi:mic",
                    microphone_index=3,
                )
            )
            with patch(
                "tarevis_home_node.media_devices.enumerate_video_devices",
                return_value=[camera(index=2)],
            ), patch(
                "tarevis_home_node.media_devices.enumerate_microphone_devices",
                return_value=[microphone(index=5)],
            ):
                inventory = manager.inventory(refresh=True)

        self.assertEqual(inventory.settings.camera_id, "opencv:msmf:0")
        self.assertEqual(inventory.settings.camera_index, 2)
        self.assertEqual(inventory.settings.microphone_index, 5)

    def test_save_rejects_missing_stable_device(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = MediaDeviceManager(Path(temp_dir) / "media-settings.json")
            with patch(
                "tarevis_home_node.media_devices.enumerate_video_devices",
                return_value=[camera()],
            ), patch(
                "tarevis_home_node.media_devices.enumerate_microphone_devices",
                return_value=[microphone()],
            ):
                with self.assertRaisesRegex(ValueError, "selected camera"):
                    manager.save({"camera_id": "missing-camera"})

    def test_media_api_exposes_inventory_and_persists_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = MediaDeviceManager(Path(temp_dir) / "media-settings.json")
            with patch(
                "tarevis_home_node.media_devices.enumerate_video_devices",
                return_value=[camera()],
            ), patch(
                "tarevis_home_node.media_devices.enumerate_microphone_devices",
                return_value=[microphone()],
            ):
                client = TestClient(create_app(UiRuntime("pc-dev"), media_manager=manager))
                inventory = client.get("/api/local-devices/media")
                self.assertEqual(inventory.status_code, 200)
                self.assertEqual(inventory.json()["cameras"][0]["stable_id"], "opencv:msmf:0")

                saved = client.post(
                    "/api/settings/media",
                    json={
                        "camera_id": "opencv:msmf:0",
                        "microphone_id": "portaudio:wasapi:mic",
                    },
                )
                self.assertEqual(saved.status_code, 200)
                self.assertEqual(saved.json()["settings"]["camera_index"], 0)
                self.assertEqual(saved.json()["settings"]["microphone_index"], 3)

    def test_microphone_test_reports_sampled_input_level(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = MediaDeviceManager(Path(temp_dir) / "media-settings.json")
            with patch(
                "tarevis_home_node.media_devices.enumerate_video_devices",
                return_value=[],
            ), patch(
                "tarevis_home_node.media_devices.enumerate_microphone_devices",
                return_value=[microphone()],
            ), patch(
                "tarevis_home_node.audio.probe_input_device",
                return_value={"rms": 0.12, "peak": 0.4, "has_signal": True},
            ):
                result = manager.test_microphone("portaudio:wasapi:mic")

        self.assertTrue(result.ok)
        self.assertIn("12%", result.message)
        self.assertEqual(result.details["peak"], 0.4)


if __name__ == "__main__":
    unittest.main()
