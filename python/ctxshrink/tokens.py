"""Token counting with a deterministic estimator and optional exact backends.

``estimate_tokens`` is a fast, dependency-free heuristic calibrated so the same
input yields the identical integer in Python and JavaScript. It counts CJK
codepoints as one token each and every four remaining characters as one token,
rounded half up. Numbers labeled ``estimated`` are not a provider invoice.

``count_tokens`` uses a real BPE counter when the optional backend is importable
(``tiktoken`` in Python, ``js-tiktoken`` in JS) and falls back to the estimator
otherwise, reporting which path it took.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

__all__ = ["estimate_tokens", "count_tokens", "TokenCount", "CJK_RANGES"]

CJK_RANGES = (
    (0x1100, 0x11FF),  # Hangul Jamo
    (0x2E80, 0x2EFF),  # CJK radicals
    (0x3000, 0x303F),  # CJK punctuation
    (0x3040, 0x309F),  # Hiragana
    (0x30A0, 0x30FF),  # Katakana
    (0x3130, 0x318F),  # Hangul compatibility
    (0x31F0, 0x31FF),  # Katakana phonetic extensions
    (0x3400, 0x4DBF),  # CJK ext A
    (0x4E00, 0x9FFF),  # CJK unified
    (0xA960, 0xA97F),  # Hangul Jamo ext
    (0xAC00, 0xD7AF),  # Hangul syllables
    (0xF900, 0xFAFF),  # CJK compatibility
    (0xFE30, 0xFE4F),  # CJK compatibility forms
    (0xFF00, 0xFFEF),  # halfwidth/fullwidth forms
    (0x20000, 0x2FA1F),  # CJK ext B+
)

_MODEL_ENCODINGS = {
    "o200k_base": "o200k_base",
    "cl100k_base": "cl100k_base",
    "gpt-4": "cl100k_base",
    "gpt-4o": "o200k_base",
    "gpt-4.1": "o200k_base",
    "auto": None,
}


@dataclass
class TokenCount:
    tokens: int
    chars: int
    method: str  # "estimate" | a BPE encoding name
    exact: bool

    def as_dict(self) -> dict:
        return {
            "tokens": self.tokens,
            "chars": self.chars,
            "method": self.method,
            "exact": self.exact,
        }


def _is_cjk(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in CJK_RANGES)


def estimate_tokens(text: str) -> int:
    """Deterministic, backend-free token estimate (cross-language identical)."""
    if not text:
        return 0
    cjk = 0
    for ch in text:
        if _is_cjk(ord(ch)):
            cjk += 1
    rest = len(text) - cjk
    return cjk + (rest + 2) // 4


def _tiktoken_counter(model: str) -> Optional[Callable[[str], int]]:
    encoding = _MODEL_ENCODINGS.get(model) or "o200k_base"
    try:  # pragma: no cover - optional dependency
        import tiktoken  # type: ignore

        enc = tiktoken.get_encoding(encoding)
        return lambda s: len(enc.encode(s))
    except Exception:
        return None


def count_tokens(text: str, model: str = "auto") -> TokenCount:
    """Count tokens with an exact BPE backend when available, else estimate."""
    exact_counter = _tiktoken_counter(model)
    if exact_counter is not None:
        return TokenCount(
            tokens=exact_counter(text),
            chars=len(text),
            method=_MODEL_ENCODINGS.get(model) or "o200k_base",
            exact=True,
        )
    return TokenCount(
        tokens=estimate_tokens(text),
        chars=len(text),
        method="estimate",
        exact=False,
    )