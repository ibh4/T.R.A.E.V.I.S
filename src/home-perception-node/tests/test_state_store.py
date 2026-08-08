from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tarevis_home_node.contracts import EventSource, create_event
from tarevis_home_node.runtime.state_store import EventStore, EventStoreError


class EventStoreTests(unittest.TestCase):
    def test_append_and_read_events(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = EventStore(Path(temp_dir) / "events.jsonl")
            event = create_event(
                device_id="pc-dev",
                source=EventSource.MOCK,
                event_type="motion_detected",
            )

            store.append(event)

            self.assertEqual(store.read_all(), [event])

    def test_reports_corrupt_line_number(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "events.jsonl"
            path.write_text("not-json\n", encoding="utf-8")
            store = EventStore(path)

            with self.assertRaisesRegex(EventStoreError, ":1:"):
                store.read_all()


if __name__ == "__main__":
    unittest.main()
