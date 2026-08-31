"""Content-type detection and text analysis.

``detect_content_type`` sniffs the shape of a blob of text so the compressor
can route it to a matching reducer. Detection is heuristic and cheap: no
external parsers, just structural signals that are reliable in practice.

``analyze`` returns a stats snapshot (length, tokens, lines, detected type,
signal counts) used by the CLI, the dashboard, and the benchmark reporter.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from .tokens import estimate_tokens

__all__ = ["detect_content_type", "analyze", "Analysis", "CONTENT_TYPES"]

CONTENT_TYPES = ("json", "diff", "log", "code", "toon", "text")

_DIFF_HEADER_RE = re.compile(r"^(diff --git|index [0-9a-f]|--- |\+\+\+ |@@ )")
_LOG_LEVEL_RE = re.compile(r"\b(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|TRACE)\b")
_TIMESTAMP_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\[\d{2}:\d{2}:\d{2}\]"
)
_CODE_SIGNAL_RE = re.compile(
    r"^\s*(import |from |package |func |def |class |function |const |let |var |"
    r"public |private |protected |#include|use strict|export )"
)
_CODE_PUNCT_RE = re.compile(r"[{};()=<>]")
_TOON_ROW_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*\[\d+\](\{[^}]*\})?:")


@dataclass
class Analysis:
    content_type: str
    chars: int
    lines: int
    words: int
    tokens_estimate: int
    blank_lines: int
    marker_lines: int
    detected_language: Optional[str] = None
    signals: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "content_type": self.content_type,
            "chars": self.chars,
            "lines": self.lines,
            "words": self.words,
            "tokens_estimate": self.tokens_estimate,
            "blank_lines": self.blank_lines,
            "marker_lines": self.marker_lines,
            "detected_language": self.detected_language,
            "signals": self.signals,
        }


def detect_content_type(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return "text"

    if (stripped[0] in "{[") and _looks_like_json(stripped):
        return "json"

    lines = stripped.split("\n")
    sample = lines[:60]

    if any(_DIFF_HEADER_RE.match(line) for line in sample):
        return "diff"

    toon_rows = sum(1 for line in sample if _TOON_ROW_RE.match(line.lstrip()))
    if toon_rows and toon_rows / max(1, len(sample)) > 0.15:
        return "toon"

    log_hits = sum(
        1 for line in sample if _LOG_LEVEL_RE.search(line) or _TIMESTAMP_RE.search(line)
    )
    if log_hits / max(1, len(sample)) > 0.25:
        return "log"

    code_hits = sum(1 for line in sample if _CODE_SIGNAL_RE.match(line))
    punct_hits = sum(len(_CODE_PUNCT_RE.findall(line)) for line in sample)
    if code_hits >= 1 or punct_hits / max(1, len(sample)) > 3:
        return "code"

    return "text"


def _looks_like_json(stripped: str) -> bool:
    import json

    try:
        json.loads(stripped)
        return True
    except (ValueError, TypeError):
        return False


def analyze(text: str, content_type: Optional[str] = None) -> Analysis:
    from .safety import MARKERS

    ctype = content_type or detect_content_type(text)
    lines = text.split("\n") if text else []
    words = re.findall(r"\S+", text)
    blank = sum(1 for line in lines if line.strip() == "")
    markers = sum(1 for line in lines if any(m in line for m in MARKERS))

    signals = {
        "avg_line_length": (sum(len(line) for line in lines) / len(lines)) if lines else 0.0,
        "max_line_length": max((len(line) for line in lines), default=0),
    }

    return Analysis(
        content_type=ctype,
        chars=len(text),
        lines=len(lines),
        words=len(words),
        tokens_estimate=estimate_tokens(text),
        blank_lines=blank,
        marker_lines=markers,
        detected_language=_guess_language(text) if ctype == "code" else None,
        signals=signals,
    )


_LANGUAGE_HINTS = (
    (re.compile(r"^\s*def \w+\(.*\):"), "python"),
    (re.compile(r"^\s*(import|from) \w"), "python"),
    (re.compile(r"^\s*func \w+\("), "go"),
    (re.compile(r"^\s*package \w+"), "go"),
    (re.compile(r"^\s*fn \w+\("), "rust"),
    (re.compile(r"^\s*(pub |impl |use )"), "rust"),
    (re.compile(r"^\s*(export )?(function|const|let|var)\b"), "javascript"),
    (re.compile(r"^\s*(public|private|protected)\s+(class|static|void)"), "java"),
    (re.compile(r"^\s*#include"), "c"),
)


def _guess_language(text: str) -> Optional[str]:
    for line in text.split("\n")[:80]:
        for pattern, lang in _LANGUAGE_HINTS:
            if pattern.match(line):
                return lang
    return None