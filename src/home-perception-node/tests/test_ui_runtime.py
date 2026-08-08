from __future__ import annotations

import asyncio
import unittest

from tarevis_home_node.contracts import EventLevel, EventSource, create_event
from tarevis_home_node.ui.runtime import UiRuntime


class UiRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = UiRuntime("rpi-home-01")

    def test_event_updates_snapshot_and_acknowledgement(self) -> None:
        event = create_event(
            device_id="rpi-home-01",
            source=EventSource.SPEECH,
            event_type="help_keyword_detected",
            level=EventLevel.HIGH,
            zone="living_room",
            confidence=0.92,
            payload={"text": "请帮帮我"},
        )

        self.runtime.emit(event)
        snapshot = self.runtime.snapshot()
        self.assertEqual(snapshot["microphone"], "active")
        self.assertEqual(snapshot["last_transcript"], "请帮帮我")
        self.assertEqual(snapshot["events"][0]["event_id"], event.event_id)
        self.assertFalse(snapshot["events"][0]["resolved"])

        acknowledgement = self.runtime.acknowledge(event.event_id)
        resolved = self.runtime.snapshot()
        target = next(item for item in resolved["events"] if item["event_id"] == event.event_id)
        self.assertTrue(target["resolved"])
        self.assertEqual(acknowledgement.type, "user_acknowledged")
        self.assertTrue(resolved["events"][0]["resolved"])

    def test_subscriber_receives_thread_safe_event_message(self) -> None:
        async def exercise() -> dict[str, object]:
            queue = self.runtime.subscribe()
            event = create_event(
                device_id="rpi-home-01",
                source=EventSource.VISION,
                event_type="motion_detected",
                zone="living_room",
                payload={"motion_score": 0.08},
            )
            self.runtime.emit(event)
            try:
                return await asyncio.wait_for(queue.get(), timeout=1.0)
            finally:
                self.runtime.unsubscribe(queue)

        message = asyncio.run(exercise())
        self.assertEqual(message["kind"], "event")
        self.assertEqual(message["event"]["type"], "motion_detected")
        self.assertEqual(message["snapshot"]["motion_score"], 0.08)


if __name__ == "__main__":
    unittest.main()
