from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class Transcription:
    text: str
    model: str
    confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class Transcriber(Protocol):
    def transcribe(self, audio_path: Path) -> Transcription: ...


@dataclass(slots=True)
class MockTranscriber:
    text: str
    model: str = "mock-transcriber"

    def transcribe(self, audio_path: Path) -> Transcription:
        return Transcription(
            text=self.text.strip(),
            model=self.model,
            metadata={"mock": True, "audio_file": audio_path.name},
        )


class FunAsrTranscriber:
    def __init__(
        self,
        *,
        model_name: str = "iic/SenseVoiceSmall",
        vad_model: str = "fsmn-vad",
        language: str = "auto",
        device: str = "cpu",
    ) -> None:
        self.model_name = model_name
        self.vad_model = vad_model
        self.language = language
        self.device = device
        self._model: Any | None = None

    def transcribe(self, audio_path: Path) -> Transcription:
        model = self._load_model()
        result = model.generate(
            input=str(audio_path),
            batch_size_s=300,
            language=self.language,
            use_itn=True,
        )
        text = postprocess_text(extract_text(result), self.model_name)
        return Transcription(
            text=text,
            model=self.model_name,
            metadata={"vad_model": self.vad_model, "device": self.device},
        )

    def _load_model(self):
        if self._model is not None:
            return self._model
        try:
            from funasr import AutoModel
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "FunASR support requires the optional 'asr' dependencies"
            ) from exc
        self._model = AutoModel(
            model=self.model_name,
            vad_model=self.vad_model or None,
            device=self.device,
            disable_update=True,
        )
        return self._model


def extract_text(result: Any) -> str:
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            text = first.get("text")
            return str(text).strip() if text else json.dumps(first, ensure_ascii=False)
        return str(first).strip()
    if isinstance(result, dict):
        text = result.get("text")
        return str(text).strip() if text else json.dumps(result, ensure_ascii=False)
    return str(result).strip()


def postprocess_text(text: str, model_name: str) -> str:
    if not text or "sensevoice" not in model_name.lower():
        return text
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
    except (ImportError, ModuleNotFoundError):
        return text
    return str(rich_transcription_postprocess(text)).strip()
