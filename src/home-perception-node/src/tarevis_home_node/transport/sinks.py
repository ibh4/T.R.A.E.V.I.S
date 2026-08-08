from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, TextIO

from ..contracts import SensingEvent
from ..runtime.state_store import EventStore


class EventSink(Protocol):
    def emit(self, event: SensingEvent) -> None: ...


@dataclass(slots=True)
class StdoutEventSink:
    stream: TextIO = sys.stdout
    pretty: bool = False

    def emit(self, event: SensingEvent) -> None:
        print(event.to_json(pretty=self.pretty), file=self.stream)


@dataclass(slots=True)
class JsonlEventSink:
    events_file: Path
    _store: EventStore = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._store = EventStore(self.events_file)

    def emit(self, event: SensingEvent) -> None:
        self._store.append(event)


@dataclass(slots=True)
class CompositeEventSink:
    sinks: list[EventSink]

    def emit(self, event: SensingEvent) -> None:
        for sink in self.sinks:
            sink.emit(event)
