"""Log reducer: keeps errors, stack traces, and the first/last lines; drops
repetitive INFO/DEBUG/progress noise in between.

Rules:

* Every line matching an error/warn/fatal/traceback signal is kept, plus a
  small window of lines immediately around it (context for the error).
* The first and last ``edge`` lines of the whole log are always kept
  (startup/shutdown context).
* Runs of dropped lines collapse to a single ``... N lines omitted ...``
  marker so length changes are visible, never silent.
"""

from __future__ import annotations

import re
from typing import Optional

from ..levels import LEVEL_AGGRESSIVE
from ..safety import SafetyPolicy, check_safety

__all__ = ["reduce"]

_ERROR_RE = re.compile(
    r"\b(ERROR|FATAL|CRITICAL|PANIC|Traceback|Exception|"
    r"WARN(?:ING)?)\b"
)
_STACK_FRAME_RE = re.compile(r"^\s*(at |File \"|  File \"|\s+in |\s+#\d+ )")

DEFAULT_EDGE = 8
DEFAULT_CONTEXT = 2


def reduce(
    text: str,
    level: int = LEVEL_AGGRESSIVE,
    policy: Optional[SafetyPolicy] = None,
    edge: int = DEFAULT_EDGE,
    context: int = DEFAULT_CONTEXT,
) -> Optional[str]:
    if level < LEVEL_AGGRESSIVE or not text:
        return None

    lines = text.split("\n")
    n = len(lines)
    if n <= edge * 2:
        return None

    keep = [False] * n
    for idx, line in enumerate(lines):
        if _ERROR_RE.search(line) or _STACK_FRAME_RE.match(line):
            for j in range(max(0, idx - context), min(n, idx + context + 1)):
                keep[j] = True
    for idx in range(min(edge, n)):
        keep[idx] = True
    for idx in range(max(0, n - edge), n):
        keep[idx] = True

    if all(keep):
        return None

    out: list = []
    i = 0
    while i < n:
        if keep[i]:
            out.append(lines[i])
            i += 1
            continue
        start = i
        while i < n and not keep[i]:
            i += 1
        omitted = i - start
        out.append("... %d lines omitted ..." % omitted)

    result = "\n".join(out)
    policy = policy or SafetyPolicy(max_drop_ratio=0.97)
    if check_safety(text, result, policy):
        return None
    return result