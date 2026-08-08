from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, TypeAlias
from uuid import uuid4

CURRENT_SCHEMA_VERSION = "1.0"

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]

_IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,127}$")
_EVENT_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,127}$")


class EventSource(StrEnum):
    VISION = "vision"
    SPEECH = "speech"
    AUDIO = "audio"
    MOCK = "mock"
    SYSTEM = "system"


class EventLevel(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True, slots=True)
class SensingEvent:
    event_id: str
    device_id: str
    source: EventSource
    type: str
    level: EventLevel
    occurred_at: str
    zone: str = "unknown"
    confidence: float | None = None
    payload: JsonObject = field(default_factory=dict)
    schema_version: str = CURRENT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != CURRENT_SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version: {self.schema_version}")
        _validate_identifier("event_id", self.event_id)
        _validate_identifier("device_id", self.device_id)
        _validate_identifier("zone", self.zone)
        if not _EVENT_TYPE_PATTERN.fullmatch(self.type):
            raise ValueError(f"invalid event type: {self.type}")
        _parse_aware_datetime(self.occurred_at)
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be between 0.0 and 1.0")
        try:
            json.dumps(self.payload, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("payload must contain JSON-compatible values") from exc
        object.__setattr__(self, "payload", dict(self.payload))

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source"] = self.source.value
        data["level"] = self.level.value
        return data

    def to_json(self, *, pretty: bool = False) -> str:
        if pretty:
            return json.dumps(self.to_dict(), ensure_ascii=False, indent=2, allow_nan=False)
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SensingEvent":
        required = {
            "schema_version",
            "event_id",
            "device_id",
            "source",
            "type",
            "level",
            "occurred_at",
        }
        missing = required.difference(data)
        if missing:
            raise ValueError(f"missing event fields: {', '.join(sorted(missing))}")
        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        return cls(
            schema_version=str(data["schema_version"]),
            event_id=str(data["event_id"]),
            device_id=str(data["device_id"]),
            source=EventSource(str(data["source"])),
            type=str(data["type"]),
            level=EventLevel(str(data["level"])),
            occurred_at=str(data["occurred_at"]),
            zone=str(data.get("zone", "unknown")),
            confidence=_optional_float(data.get("confidence")),
            payload=payload,
        )

    @classmethod
    def from_json(cls, text: str) -> "SensingEvent":
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("event JSON must be an object")
        return cls.from_dict(data)


def create_event(
    *,
    device_id: str,
    source: EventSource,
    event_type: str,
    level: EventLevel = EventLevel.INFO,
    zone: str = "unknown",
    confidence: float | None = None,
    payload: JsonObject | None = None,
    occurred_at: str | None = None,
) -> SensingEvent:
    return SensingEvent(
        event_id=f"evt_{uuid4().hex}",
        device_id=device_id,
        source=source,
        type=event_type,
        level=level,
        occurred_at=occurred_at or datetime.now().astimezone().isoformat(timespec="milliseconds"),
        zone=zone,
        confidence=confidence,
        payload=payload or {},
    )


def _validate_identifier(field_name: str, value: str) -> None:
    if not _IDENTIFIER_PATTERN.fullmatch(value):
        raise ValueError(f"invalid {field_name}: {value}")


def _parse_aware_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid occurred_at: {value}") from exc
    if parsed.utcoffset() is None:
        raise ValueError("occurred_at must include a timezone offset")
    return parsed


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("confidence must be numeric")
    return float(value)
