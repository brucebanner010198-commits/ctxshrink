"""JSON reducer: lossy array truncation for oversized, repetitive payloads.

Complements :mod:`ctxshrink.toon`, which is a lossless re-encoding. This
reducer is for the case TOON cannot help: a JSON array so large that even the
compact tabular form is still too big. It keeps object keys and structure,
never truncates a subtree reached through a key that looks like an error,
message, or status field, and truncates other long homogeneous arrays to a
head/tail sample with an explicit ``"...N more"`` marker so a reader knows
data was cut, not silently dropped.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from ..levels import LEVEL_AGGRESSIVE
from ..safety import SafetyPolicy, check_safety

__all__ = ["reduce"]

_INTERESTING_KEY_RE = re.compile(
    r"error|exception|message|status|code|fail|warn", re.IGNORECASE
)

DEFAULT_HEAD = 3
DEFAULT_TAIL = 2
DEFAULT_ARRAY_THRESHOLD = 12


def _walk(value: Any, head: int, tail: int, threshold: int, protected: bool, changed: list) -> Any:
    if isinstance(value, dict):
        return {
            k: _walk(
                v, head, tail, threshold, protected or bool(_INTERESTING_KEY_RE.search(k)), changed
            )
            for k, v in value.items()
        }
    if isinstance(value, list):
        walked = [_walk(e, head, tail, threshold, protected, changed) for e in value]
        if protected or len(walked) <= threshold:
            return walked
        kept_head = walked[:head]
        kept_tail = walked[-tail:] if tail else []
        marker = "...%d more" % (len(walked) - head - tail)
        changed.append(True)
        return kept_head + [marker] + kept_tail
    return value


def reduce(
    text: str,
    level: int = LEVEL_AGGRESSIVE,
    policy: Optional[SafetyPolicy] = None,
    head: int = DEFAULT_HEAD,
    tail: int = DEFAULT_TAIL,
    threshold: int = DEFAULT_ARRAY_THRESHOLD,
) -> Optional[str]:
    if level < LEVEL_AGGRESSIVE:
        return None
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return None

    changed: list = []
    result = _walk(value, head, tail, threshold, False, changed)
    if not changed:
        return None

    out = json.dumps(result, separators=(",", ":"), ensure_ascii=False)
    policy = policy or SafetyPolicy(max_drop_ratio=0.95, preserve_markers=False)
    if check_safety(text, out, policy):
        return None
    return out
