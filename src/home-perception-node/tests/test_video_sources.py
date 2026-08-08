from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np

from tarevis_home_node.vision.sources import (
    Picamera2VideoSource,
    create_video_source,
    parse_picamera2_source,
)


class FakePicamera2:
    def __init__(self, camera_number: int) -> None:
        self.camera_number = camera_number
        self.configuration: dict[str, object] | None = None
        self.configured: dict[str, object] | None = None
        self.started = False
        self.stop_calls = 0
        self.close_calls = 0
        self.frame = np.full((3, 4, 3), 17, dtype=np.uint8)

    def create_video_configuration(self, **values: object) -> dict[str, object]:
        self.configuration = values
        return values

    def configure(self, configuration: dict[str, object]) -> None:
        self.configured = configuration

    def start(self) -> None:
        self.started = True

    def capture_array(self, stream_name: str) -> np.ndarray:
        if stream_name != "main":
            raise AssertionError(f"unexpected stream: {stream_name}")
        return self.frame

    def stop(self) -> None:
        self.stop_calls += 1

    def close(self) -> None:
        self.close_calls += 1


class VideoSourceTests(unittest.TestCase):
    def test_picamera2_source_configures_and_releases_camera(self) -> None:
        cameras: list[FakePicamera2] = []

        def factory(camera_number: int) -> FakePicamera2:
            camera = FakePicamera2(camera_number)
            cameras.append(camera)
            return camera

        source = Picamera2VideoSource(1, width=640, height=480, camera_factory=factory)
        ok, frame = source.read()
        source.close()
        source.close()

        camera = cameras[0]
        self.assertEqual(source.source_name, "picamera2://1")
        self.assertTrue(source.is_live)
        self.assertTrue(ok)
        self.assertIs(frame, camera.frame)
        self.assertEqual(camera.camera_number, 1)
        self.assertEqual(
            camera.configuration,
            {"main": {"size": (640, 480), "format": "RGB888"}, "buffer_count": 4},
        )
        self.assertIs(camera.configured, camera.configuration)
        self.assertTrue(camera.started)
        self.assertEqual(camera.stop_calls, 1)
        self.assertEqual(camera.close_calls, 1)
        self.assertEqual(source.read(), (False, None))

    def test_picamera2_uri_parsing_is_explicit(self) -> None:
        self.assertEqual(parse_picamera2_source("picamera2"), 0)
        self.assertEqual(parse_picamera2_source("picamera2://0"), 0)
        self.assertEqual(parse_picamera2_source("PICAMERA2://2"), 2)
        self.assertIsNone(parse_picamera2_source(0))
        self.assertIsNone(parse_picamera2_source("rtsp://camera.local/stream"))

        for value in ("picamera2://", "picamera2://camera", "picamera2://0/main", "picamera2://0?x=1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_picamera2_source(value)

    def test_factory_selects_picamera2_for_its_uri(self) -> None:
        sentinel = object()
        with patch(
            "tarevis_home_node.vision.sources.Picamera2VideoSource",
            return_value=sentinel,
        ) as picamera_source:
            created = create_video_source("picamera2://3", width=320, height=240)

        self.assertIs(created, sentinel)
        picamera_source.assert_called_once_with(3, width=320, height=240)


if __name__ == "__main__":
    unittest.main()
