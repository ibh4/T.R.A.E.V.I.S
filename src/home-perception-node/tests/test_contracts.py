from __future__ import annotations

import unittest

from tarevis_home_node.contracts import EventLevel, EventSource, SensingEvent, create_event


class SensingEventTests(unittest.TestCase):
    def test_round_trip_preserves_event(self) -> None:
        event = create_event(
            device_id="pc-dev",
            source=EventSource.VISION,
            event_type="motion_detected",
            zone="living_room",
            payload={"motion_score": 0.08, "frame_index": 42},
        )

        restored = SensingEvent.from_json(event.to_json())

        self.assertEqual(restored, event)

    def test_rejects_confidence_outside_probability_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "confidence"):
            create_event(
                device_id="pc-dev",
                source=EventSource.VISION,
                event_type="person_detected",
                confidence=1.1,
            )

    def test_rejects_timestamp_without_timezone(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone"):
            SensingEvent(
                event_id="evt_test",
                device_id="pc-dev",
                source=EventSource.SYSTEM,
                type="heartbeat_detected",
                level=EventLevel.INFO,
                occurred_at="2026-07-21T12:00:00",
            )

    def test_rejects_non_json_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON-compatible"):
            create_event(
                device_id="pc-dev",
                source=EventSource.SYSTEM,
                event_type="invalid_payload_detected",
                payload={"value": object()},  # type: ignore[dict-item]
            )


if __name__ == "__main__":
    unittest.main()
