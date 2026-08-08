from __future__ import annotations

import asyncio
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..contracts import EventLevel, EventSource, SensingEvent, create_event


@dataclass(slots=True)
class StoredUiEvent:
    event: SensingEvent
    resolved: bool = False

    def to_dict(self) -> dict[str, Any]:
        data = self.event.to_dict()
        data["resolved"] = self.resolved
        snapshot_path = self.event.payload.get("snapshot_path")
        if isinstance(snapshot_path, str) and snapshot_path and Path(snapshot_path).is_file():
            data["snapshot_url"] = f"/media/snapshots/{snapshot_path.rsplit('/', 1)[-1]}"
        return data


class UiRuntime:
    _STATUS_FIELDS = {
        "camera",
        "microphone",
        "vision_fps",
        "inference_ms",
        "motion_score",
        "audio_level",
        "keyword_confidence",
        "cpu_temp",
        "preview_url",
        "last_transcript",
        "last_error",
    }

    def __init__(self, device_id: str, *, max_events: int = 50) -> None:
        self.device_id = device_id
        self.max_events = max_events
        self._started_at = time.monotonic()
        self._events: deque[StoredUiEvent] = deque(maxlen=max_events)
        self._lock = threading.RLock()
        self._subscribers: dict[asyncio.Queue[dict[str, Any]], asyncio.AbstractEventLoop] = {}
        self._status: dict[str, Any] = {
            "camera": "standby",
            "microphone": "standby",
            "vision_fps": 0.0,
            "inference_ms": None,
            "motion_score": 0.0,
            "audio_level": 0.0,
            "keyword_confidence": None,
            "cpu_temp": None,
            "preview_url": None,
            "last_transcript": None,
            "last_error": None,
        }

    def emit(self, event: SensingEvent, *, resolved: bool = False) -> None:
        with self._lock:
            stored = StoredUiEvent(event=event, resolved=resolved)
            self._events.appendleft(stored)
            self._apply_event_evidence(event)
            snapshot = self._snapshot_unlocked()
            message = {"kind": "event", "event": stored.to_dict(), "snapshot": snapshot}
        self._broadcast(message)

    def update_status(self, **changes: Any) -> None:
        unknown = set(changes).difference(self._STATUS_FIELDS)
        if unknown:
            raise ValueError(f"unsupported UI status fields: {', '.join(sorted(unknown))}")
        with self._lock:
            self._status.update(changes)
            snapshot = self._snapshot_unlocked()
        self._broadcast({"kind": "snapshot", "snapshot": snapshot})

    def reset_normal(self) -> None:
        self.update_status(
            camera="ready",
            microphone="ready",
            motion_score=0.0,
            audio_level=0.0,
            keyword_confidence=None,
            last_transcript=None,
            last_error=None,
        )

    def acknowledge(self, event_id: str) -> SensingEvent:
        with self._lock:
            target = next((stored for stored in self._events if stored.event.event_id == event_id), None)
            if target is None:
                raise KeyError(event_id)
            target.resolved = True
            zone = target.event.zone
        acknowledgement = create_event(
            device_id=self.device_id,
            source=EventSource.SYSTEM,
            event_type="user_acknowledged",
            level=EventLevel.INFO,
            zone=zone,
            payload={
                "target_event_id": event_id,
                "summary": "用户通过本地触摸界面确认事件已处理",
            },
        )
        self.emit(acknowledgement, resolved=True)
        return acknowledgement

    def latest_unresolved_event_id(self) -> str | None:
        with self._lock:
            return next((stored.event.event_id for stored in self._events if not stored.resolved), None)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self._snapshot_unlocked()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=32)
        with self._lock:
            self._subscribers[queue] = loop
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        with self._lock:
            self._subscribers.pop(queue, None)

    def _snapshot_unlocked(self) -> dict[str, Any]:
        return {
            "connected": True,
            "device_id": self.device_id,
            **self._status,
            "uptime_seconds": int(time.monotonic() - self._started_at),
            "events": [stored.to_dict() for stored in self._events],
        }

    def _apply_event_evidence(self, event: SensingEvent) -> None:
        payload = event.payload
        if event.source is EventSource.VISION:
            self._status["camera"] = "active"
        if event.source in {EventSource.SPEECH, EventSource.AUDIO}:
            self._status["microphone"] = "active"
        motion_score = payload.get("motion_score")
        if isinstance(motion_score, (int, float)) and not isinstance(motion_score, bool):
            self._status["motion_score"] = float(motion_score)
        inference_ms = payload.get("inference_ms")
        if isinstance(inference_ms, (int, float)) and not isinstance(inference_ms, bool):
            self._status["inference_ms"] = int(inference_ms)
        text = payload.get("text")
        if isinstance(text, str) and text:
            self._status["last_transcript"] = text
        audio = payload.get("audio")
        if isinstance(audio, dict):
            rms = audio.get("rms")
            if isinstance(rms, (int, float)) and not isinstance(rms, bool):
                self._status["audio_level"] = max(0.0, min(float(rms), 1.0))
        if event.source is EventSource.SPEECH and event.confidence is not None:
            self._status["keyword_confidence"] = event.confidence

    def _broadcast(self, message: dict[str, Any]) -> None:
        with self._lock:
            subscribers = list(self._subscribers.items())
        for queue, loop in subscribers:
            if loop.is_closed():
                self.unsubscribe(queue)
                continue
            try:
                loop.call_soon_threadsafe(self._enqueue_latest, queue, message)
            except RuntimeError:
                self.unsubscribe(queue)

    @staticmethod
    def _enqueue_latest(
        queue: asyncio.Queue[dict[str, Any]],
        message: dict[str, Any],
    ) -> None:
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        queue.put_nowait(message)


@dataclass(slots=True)
class RuntimeEventSink:
    runtime: UiRuntime

    def emit(self, event: SensingEvent) -> None:
        self.runtime.emit(event)
