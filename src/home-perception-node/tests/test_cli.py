from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tarevis_home_node.cli import run
from tarevis_home_node.contracts import SensingEvent
from tarevis_home_node.runtime.state_store import EventStore


class CliTests(unittest.TestCase):
    def test_mock_event_writes_stdout_and_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            events_file = Path(temp_dir) / "events.jsonl"
            output = io.StringIO()

            result = run(
                [
                    "mock-event",
                    "--scenario",
                    "fall",
                    "--sink",
                    "both",
                    "--events-file",
                    str(events_file),
                ],
                stdout=output,
            )

            stdout_event = SensingEvent.from_json(output.getvalue())
            stored_events = EventStore(events_file).read_all()

        self.assertEqual(result, 0)
        self.assertEqual(stdout_event.type, "fall_suspected")
        self.assertEqual(stored_events, [stdout_event])

    def test_list_scenarios_is_machine_readable(self) -> None:
        output = io.StringIO()

        result = run(["list-scenarios"], stdout=output)
        scenarios = json.loads(output.getvalue())

        self.assertEqual(result, 0)
        self.assertIn("delivery", {item["name"] for item in scenarios})
        self.assertIn("fall", {item["name"] for item in scenarios})

    def test_audio_probe_is_machine_readable(self) -> None:
        output = io.StringIO()
        with patch(
            "tarevis_home_node.audio.probe_input_device",
            return_value={"rms": 0.08, "peak": 0.2, "has_signal": True},
        ):
            result = run(["audio-probe", "--device-index", "2"], stdout=output)

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["peak"], 0.2)


if __name__ == "__main__":
    unittest.main()
