"""PCM WAV input, optional microphone recording, ASR, and keyword routing."""

from .keyword_router import KeywordIntent, KeywordMatch, KeywordRouter
from .pipeline import AudioEventPipeline, AudioPipelineConfig
from .sources import (
    AudioClip,
    AudioStats,
    MicrophoneRecorder,
    inspect_wav,
    list_input_devices,
    probe_input_device,
)
from .transcribers import FunAsrTranscriber, MockTranscriber, Transcriber, Transcription

__all__ = [
    "AudioClip",
    "AudioEventPipeline",
    "AudioPipelineConfig",
    "AudioStats",
    "FunAsrTranscriber",
    "KeywordIntent",
    "KeywordMatch",
    "KeywordRouter",
    "MicrophoneRecorder",
    "MockTranscriber",
    "Transcriber",
    "Transcription",
    "inspect_wav",
    "list_input_devices",
    "probe_input_device",
]
