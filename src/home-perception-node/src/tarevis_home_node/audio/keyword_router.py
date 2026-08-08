from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from ..contracts import EventLevel

_NORMALIZE_PATTERN = re.compile(r"[\s，。！？、,.!?；;：:~～]+")


class KeywordIntent(StrEnum):
    HELP = "help"
    ACKNOWLEDGE = "acknowledge"


@dataclass(frozen=True, slots=True)
class KeywordMatch:
    intent: KeywordIntent
    event_type: str
    level: EventLevel
    matched_phrase: str


class KeywordRouter:
    def __init__(
        self,
        *,
        help_phrases: tuple[str, ...] | None = None,
        acknowledgement_phrases: tuple[str, ...] | None = None,
    ) -> None:
        self.help_phrases = _longest_first(
            help_phrases
            or (
                "喘不过气",
                "我摔倒了",
                "快来帮我",
                "快来人",
                "帮帮我",
                "救命",
                "危险",
                "好疼",
                "很疼",
                "疼死了",
                "不舒服",
            )
        )
        self.acknowledgement_phrases = _longest_first(
            acknowledgement_phrases
            or (
                "已经处理",
                "取消提醒",
                "我没事",
                "不用了",
                "知道了",
                "收到",
            )
        )

    def match(self, text: str) -> KeywordMatch | None:
        normalized = normalize_text(text)
        if not normalized:
            return None
        acknowledgement = _find_phrase(normalized, self.acknowledgement_phrases)
        if acknowledgement is not None:
            return KeywordMatch(
                intent=KeywordIntent.ACKNOWLEDGE,
                event_type="user_acknowledged",
                level=EventLevel.INFO,
                matched_phrase=acknowledgement,
            )
        help_phrase = _find_phrase(normalized, self.help_phrases)
        if help_phrase is not None:
            return KeywordMatch(
                intent=KeywordIntent.HELP,
                event_type="help_keyword_detected",
                level=EventLevel.HIGH,
                matched_phrase=help_phrase,
            )
        return None


def normalize_text(text: str) -> str:
    return _NORMALIZE_PATTERN.sub("", text).lower()


def _find_phrase(text: str, phrases: tuple[str, ...]) -> str | None:
    return next((phrase for phrase in phrases if normalize_text(phrase) in text), None)


def _longest_first(phrases: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted({normalize_text(phrase) for phrase in phrases if phrase}, key=len, reverse=True))
