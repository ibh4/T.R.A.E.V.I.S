from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..contracts import EventLevel, EventSource, SensingEvent, create_event
from .keyword_router import KeywordRouter
from .sources import AudioClip, inspect_wav
from .transcribers import Transcriber


@dataclass(frozen=True, slots=True)
class AudioPipelineConfig:
    device_id: str
    zone: str = "unknown"
    min_duration_seconds: float = 0.35
    min_rms: float = 0.003

    def __post_init__(self) -> None:
        if self.min_duration_seconds < 0:
            raise ValueError("min_duration_seconds must be non-negative")
        if not 0.0 <= self.min_rms <= 1.0:
            raise ValueError("min_rms must be between 0.0 and 1.0")


class AudioEventPipeline:
    def __init__(
        self,
        transcriber: Transcriber,
        config: AudioPipelineConfig,
        keyword_router: KeywordRouter | None = None,
    ) -> None:
        self.transcriber = transcriber
        self.config = config
        self.keyword_router = keyword_router or KeywordRouter()

    def process_wav(self, path: Path) -> list[SensingEvent]:
        clip = inspect_wav(path)
        filtered_reason = self._filtered_reason(clip)
        if filtered_reason is not None:
            return [self._build_filtered_event(clip, filtered_reason)]

        transcription = self.transcriber.transcribe(clip.path)
        transcript_event = create_event(
            device_id=self.config.device_id,
            source=EventSource.SPEECH,
            event_type="speech_transcribed",
            level=EventLevel.INFO,
            zone=self.config.zone,
            confidence=transcription.confidence,
            payload={
                "text": transcription.text,
                "model": transcription.model,
                "audio_path": clip.path.as_posix(),
                "audio": clip.stats.to_dict(),
                "metadata": transcription.metadata,
            },
        )
        events = [transcript_event]
        keyword_match = self.keyword_router.match(transcription.text)
        if keyword_match is not None:
            events.append(
                create_event(
                    device_id=self.config.device_id,
                    source=EventSource.SPEECH,
                    event_type=keyword_match.event_type,
                    level=keyword_match.level,
                    zone=self.config.zone,
                    payload={
                        "text": transcription.text,
                        "matched_phrase": keyword_match.matched_phrase,
                        "intent": keyword_match.intent.value,
                        "parent_event_id": transcript_event.event_id,
                    },
                )
            )
        return events

    def _filtered_reason(self, clip: AudioClip) -> str | None:
        if clip.stats.duration_seconds < self.config.min_duration_seconds:
            return "too_short"
        if clip.stats.rms < self.config.min_rms:
            return "too_quiet"
        return None

    def _build_filtered_event(self, clip: AudioClip, reason: str) -> SensingEvent:
        return create_event(
            device_id=self.config.device_id,
            source=EventSource.AUDIO,
            event_type="audio_filtered",
            level=EventLevel.INFO,
            zone=self.config.zone,
            payload={
                "reason": reason,
                "audio_path": clip.path.as_posix(),
                "audio": clip.stats.to_dict(),
            },
        )
