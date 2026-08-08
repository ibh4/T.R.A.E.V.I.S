from __future__ import annotations

import re
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

_DEVICE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,127}$")


@dataclass(frozen=True, slots=True)
class NodeConfig:
    device_id: str = "pc-dev"
    default_zone: str = "unknown"
    events_file: Path = Path("data/events.jsonl")
    media_settings_file: Path = Path("data/media-settings.json")

    def __post_init__(self) -> None:
        if not _DEVICE_ID_PATTERN.fullmatch(self.device_id):
            raise ValueError(f"invalid device_id: {self.device_id}")
        if not _DEVICE_ID_PATTERN.fullmatch(self.default_zone):
            raise ValueError(f"invalid default_zone: {self.default_zone}")
        if not self.events_file.name:
            raise ValueError("events_file must point to a file")
        if not self.media_settings_file.name:
            raise ValueError("media_settings_file must point to a file")

    def to_dict(self) -> dict[str, str]:
        data = asdict(self)
        data["events_file"] = str(self.events_file)
        data["media_settings_file"] = str(self.media_settings_file)
        return data


def load_config(path: Path | None = None) -> NodeConfig:
    if path is None:
        return NodeConfig()
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    return config_from_dict(data)


def config_from_dict(data: dict[str, Any]) -> NodeConfig:
    node = data.get("node", {})
    storage = data.get("storage", {})
    if not isinstance(node, dict) or not isinstance(storage, dict):
        raise ValueError("config sections node and storage must be tables")
    return NodeConfig(
        device_id=str(node.get("device_id", "pc-dev")),
        default_zone=str(node.get("default_zone", "unknown")),
        events_file=Path(str(storage.get("events_file", "data/events.jsonl"))),
        media_settings_file=Path(
            str(storage.get("media_settings_file", "data/media-settings.json"))
        ),
    )
