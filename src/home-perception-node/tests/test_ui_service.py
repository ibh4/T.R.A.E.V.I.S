from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from tarevis_home_node.ui.runtime import UiRuntime
from tarevis_home_node.ui.service import create_app


class UiServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = UiRuntime("rpi-home-01")
        self.client = TestClient(create_app(self.runtime))

    def test_state_mock_and_acknowledgement_endpoints(self) -> None:
        initial = self.client.get("/api/state")
        self.assertEqual(initial.status_code, 200)
        self.assertTrue(initial.json()["connected"])

        created = self.client.post("/api/mock/help")
        self.assertEqual(created.status_code, 200)
        event_id = created.json()["event"]["event_id"]
        self.assertEqual(created.json()["event"]["type"], "help_keyword_detected")

        acknowledged = self.client.post(f"/api/events/{event_id}/ack")
        self.assertEqual(acknowledged.status_code, 200)
        target = next(
            event
            for event in acknowledged.json()["snapshot"]["events"]
            if event["event_id"] == event_id
        )
        self.assertTrue(target["resolved"])

    def test_websocket_receives_initial_snapshot_and_new_event(self) -> None:
        with self.client.websocket_connect("/ws") as websocket:
            initial = websocket.receive_json()
            self.assertEqual(initial["kind"], "snapshot")
            self.client.post("/api/mock/motion")
            message = websocket.receive_json()
            self.assertEqual(message["kind"], "event")
            self.assertEqual(message["event"]["type"], "motion_detected")

    def test_built_ui_can_be_served_from_same_process(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ui_dir = Path(temp_dir)
            (ui_dir / "index.html").write_text("<h1>TAREVIS UI</h1>", encoding="utf-8")
            client = TestClient(create_app(UiRuntime("rpi-home-01"), ui_dist_dir=ui_dir))
            response = client.get("/")
            self.assertEqual(response.status_code, 200)
            self.assertIn("TAREVIS UI", response.text)


if __name__ == "__main__":
    unittest.main()
