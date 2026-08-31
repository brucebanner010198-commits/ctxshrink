"""Orchestrator: detect, reduce, verify, and report.

``compress()`` is the single entry point most callers need. It detects
content type (or takes an explicit hint), routes to the TOON re-encoder
and/or the matching reducer chain for the chosen optimization level, checks
every candidate against the safety policy, and returns whichever safe
candidate saves the most estimated tokens. If nothing beats the original, the
original text comes back unchanged with ``method="none"``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .analyze import detect_content_type
from .levels import LEVEL_AGGRESSIVE, LEVEL_CONSERVATIVE, LEVEL_LOSSLESS, LEVEL_NONE, level_name
from .reducers import code as code_reducer
from .reducers import comments as comments_reducer
from .reducers import diff as diff_reducer
from .reducers import json_ as json_reducer
from .reducers import log as log_reducer
from .reducers import prose as prose_reducer
from .safety import CODE_MARKERS, SafetyPolicy, check_safety
from .tokens import estimate_tokens
from .toon import toon_decode, toon_encode

__all__ = ["compress", "CompressResult", "decompress"]


@dataclass
class CompressResult:
    text: str
    original: str
    content_type: str
    level: int
    method: str
    lossless: bool
    applied: list = field(default_factory=list)
    notes: list = field(default_factory=list)

    @property
    def original_tokens(self) -> int:
        return estimate_tokens(self.original)

    @property
    def result_tokens(self) -> int:
        return estimate_tokens(self.text)

    @property
    def original_chars(self) -> int:
        return len(self.original)

    @property
    def result_chars(self) -> int:
        return len(self.text)

    @property
    def savings_ratio(self) -> float:
        ot = self.original_tokens
        if ot == 0:
            return 0.0
        return max(0.0, 1.0 - (self.result_tokens / ot))

    @property
    def changed(self) -> bool:
        return self.text != self.original

    def as_dict(self) -> dict:
        return {
            "content_type": self.content_type,
            "level": self.level,
            "level_name": level_name(self.level),
            "method": self.method,
            "lossless": self.lossless,
            "applied": list(self.applied),
            "notes": list(self.notes),
            "changed": self.changed,
            "original_tokens": self.original_tokens,
            "result_tokens": self.result_tokens,
            "original_chars": self.original_chars,
            "result_chars": self.result_chars,
            "savings_ratio": round(self.savings_ratio, 4),
        }


def _passthrough(text: str, content_type: str, level: int, note: str = "") -> CompressResult:
    notes = [note] if note else []
    return CompressResult(
        text=text,
        original=text,
        content_type=content_type,
        level=level,
        method="none",
        lossless=True,
        applied=[],
        notes=notes,
    )


def _candidate_ok(original: str, candidate: str, policy: Optional[SafetyPolicy]) -> bool:
    if candidate is None or candidate == original:
        return False
    return not check_safety(original, candidate, policy)


def _best(candidates: list) -> Optional[tuple]:
    """``candidates`` is a list of (method, text, lossless, applied). Returns
    the entry with the fewest estimated tokens, or None if empty."""
    if not candidates:
        return None
    return min(candidates, key=lambda c: estimate_tokens(c[1]))


def _compress_json(text: str, level: int, policy: Optional[SafetyPolicy]) -> list:
    candidates = []
    if level >= LEVEL_LOSSLESS:
        toon_out = toon_encode(text)
        if toon_out and _candidate_ok(text, toon_out, policy):
            candidates.append(("toon", toon_out, True, ["toon"]))
    if level >= LEVEL_AGGRESSIVE:
        truncated = json_reducer.reduce(text, level=level)
        if truncated and _candidate_ok(text, truncated, policy):
            candidates.append(("json-truncate", truncated, False, ["json_"]))
            toon_after = toon_encode(truncated)
            if toon_after and _candidate_ok(text, toon_after, policy):
                candidates.append(
                    ("json-truncate+toon", toon_after, False, ["json_", "toon"])
                )
    return candidates


def _compress_code(text: str, level: int, policy: Optional[SafetyPolicy]) -> list:
    if level < LEVEL_CONSERVATIVE:
        return []
    effective_policy = policy or SafetyPolicy(max_drop_ratio=0.85, markers=CODE_MARKERS)
    candidates = []
    # Comments run first: code elision inserts its own "// ..." / "..."
    # placeholder, which a comments pass run afterward would mistake for a
    # noise comment and strip.
    step1 = comments_reducer.reduce(text, level=level)
    applied = ["comments"] if step1 else []
    working = step1 or text
    step2 = code_reducer.reduce(working, level=level)
    if step2:
        working = step2
        applied = applied + ["code"]
    if applied and _candidate_ok(text, working, effective_policy):
        candidates.append(("code", working, False, applied))
    elif step1 and _candidate_ok(text, step1, effective_policy):
        candidates.append(("code", step1, False, ["comments"]))
    return candidates


def _compress_simple(reducer_module, method: str, text: str, level: int, policy) -> list:
    out = reducer_module.reduce(text, level=level)
    if out and _candidate_ok(text, out, policy):
        return [(method, out, False, [method])]
    return []


def compress(
    text: str,
    level: int = LEVEL_CONSERVATIVE,
    content_type: Optional[str] = None,
    policy: Optional[SafetyPolicy] = None,
) -> CompressResult:
    """Reduce ``text`` at the requested optimization level.

    ``level`` follows :mod:`ctxshrink.levels` (0 none .. 3 aggressive).
    ``content_type`` overrides autodetection when the caller already knows
    the shape (``json``, ``code``, ``diff``, ``log``, ``text``, ``toon``).
    """
    ctype = content_type or detect_content_type(text)

    if level <= LEVEL_NONE or not text:
        return _passthrough(text, ctype, level)

    if ctype == "json":
        candidates = _compress_json(text, level, policy)
    elif ctype == "code":
        candidates = _compress_code(text, level, policy)
    elif ctype == "diff":
        candidates = _compress_simple(diff_reducer, "diff", text, level, policy)
    elif ctype == "log":
        candidates = _compress_simple(log_reducer, "log", text, level, policy)
    elif ctype == "text":
        candidates = _compress_simple(prose_reducer, "prose", text, level, policy)
    else:
        candidates = []

    winner = _best(candidates)
    if winner is None:
        return _passthrough(text, ctype, level, note="no safe reduction found")

    method, out_text, lossless, applied = winner
    return CompressResult(
        text=out_text,
        original=text,
        content_type=ctype,
        level=level,
        method=method,
        lossless=lossless,
        applied=applied,
        notes=[],
    )


def decompress(text: str, method: str) -> Optional[str]:
    """Reverse a lossless transform. Only ``toon`` is currently reversible;
    lossy methods have no inverse and return None."""
    if method == "toon":
        return toon_decode(text)
    return None
