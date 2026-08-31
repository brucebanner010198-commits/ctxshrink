"""ctxshrink: shrink prompts and code context for AI coding assistants.

Public API
----------

``count_tokens(text)`` / ``estimate_tokens(text)``
    Token counting, with an optional exact backend.
``analyze(text)``
    Content-type detection and text statistics.
``compress(text, level=...)``
    Detect, reduce, and safety-check in one call; returns a
    :class:`CompressResult`.
``toon_encode(json_text)`` / ``toon_decode(toon_text)``
    The lossless TOON re-encoding, standalone.
``benchmark(...)``
    Run the bundled fixture corpus and report savings.

Everything here is deterministic and local: no network calls, no model
inference. Reductions are conservative by default and fail closed to the
original text whenever a safety check does not pass.
"""

from __future__ import annotations

from .analyze import Analysis, analyze, detect_content_type
from .compress import CompressResult, compress, decompress
from .levels import (
    LEVEL_AGGRESSIVE,
    LEVEL_CONSERVATIVE,
    LEVEL_LOSSLESS,
    LEVEL_NONE,
    S1,
    S2,
    S3,
    S4,
    level_name,
    safety_name,
)
from .safety import MARKERS, SafetyFailure, SafetyPolicy, check_safety, is_safe
from .tokens import TokenCount, count_tokens, estimate_tokens
from .toon import toon_decode, toon_encode

__version__ = "0.1.0"

__all__ = [
    "__version__",
    # tokens
    "count_tokens",
    "estimate_tokens",
    "TokenCount",
    # analyze
    "analyze",
    "detect_content_type",
    "Analysis",
    # compress
    "compress",
    "decompress",
    "CompressResult",
    # toon
    "toon_encode",
    "toon_decode",
    # levels
    "LEVEL_NONE",
    "LEVEL_LOSSLESS",
    "LEVEL_CONSERVATIVE",
    "LEVEL_AGGRESSIVE",
    "level_name",
    "S1",
    "S2",
    "S3",
    "S4",
    "safety_name",
    # safety
    "SafetyPolicy",
    "SafetyFailure",
    "check_safety",
    "is_safe",
    "MARKERS",
]