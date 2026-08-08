from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tarevis_home_node.config import load_config


class ConfigTests(unittest.TestCase):
    def test_loads_toml_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "node.toml"
            path.write_text(
                """
[node]
device_id = "pi-test"
default_zone = "door"

[storage]
events_file = "runtime/events.jsonl"
media_settings_file = "runtime/media-settings.json"
""".strip(),
                encoding="utf-8",
            )

            config = load_config(path)

        self.assertEqual(config.device_id, "pi-test")
        self.assertEqual(config.default_zone, "door")
        self.assertEqual(config.events_file, Path("runtime/events.jsonl"))
        self.assertEqual(config.media_settings_file, Path("runtime/media-settings.json"))


if __name__ == "__main__":
    unittest.main()
