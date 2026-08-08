from __future__ import annotations

import threading
from pathlib import Path
from typing import Iterator

from ..contracts import SensingEvent


class EventStoreError(RuntimeError):
    pass


class EventStore:
    def __init__(self, events_file: Path) -> None:
        self.events_file = events_file
        self._lock = threading.Lock()

    def append(self, event: SensingEvent) -> None:
        self.events_file.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self.events_file.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(event.to_json())
            handle.write("\n")

    def iter_events(self) -> Iterator[SensingEvent]:
        if not self.events_file.exists():
            return
        with self.events_file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                try:
                    yield SensingEvent.from_json(text)
                except (ValueError, TypeError) as exc:
                    raise EventStoreError(
                        f"invalid event at {self.events_file}:{line_number}: {exc}"
                    ) from exc

    def read_all(self) -> list[SensingEvent]:
        return list(self.iter_events())
