"""Diff reducer: keeps file/hunk headers and changed lines, collapses long
runs of unchanged context lines.

A unified diff spends most of its bytes on context lines that did not change.
This reducer keeps every header (``diff --git``, ``index``, ``---``, ``+++``,
``@@``), every added/removed line, and a small window of context immediately
around each change; longer context runs collapse to a
``... N unchanged lines ...`` marker.
"""

from __future__ import annotations

import re
from typing import Optional

from ..levels import LEVEL_CONSERVATIVE
from ..safety import SafetyPolicy, check_safety

__all__ = ["reduce"]

_HEADER_RE = re.compile(r"^(diff --git|index |--- |\+\+\+ |@@ |new file|deleted file|old mode|new mode|similarity index|rename (from|to))")
_CHANGE_RE = re.compile(r"^[+-](?![+-]{2})")

DEFAULT_CONTEXT = 3


def reduce(
    text: str,
    level: int = LEVEL_CONSERVATIVE,
    policy: Optional[SafetyPolicy] = None,
    context: int = DEFAULT_CONTEXT,
) -> Optional[str]:
    if level < LEVEL_CONSERVATIVE or not text:
        return None

    lines = text.split("\n")
    n = len(lines)
    keep = [False] * n
    for idx, line in enumerate(lines):
        if _HEADER_RE.match(line) or _CHANGE_RE.match(line):
            for j in range(max(0, idx - context), min(n, idx + context + 1)):
                keep[j] = True

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
        out.append("... %d unchanged lines ..." % (i - start))

    result = "\n".join(out)
    policy = policy or SafetyPolicy(max_drop_ratio=0.95)
    if check_safety(text, result, policy):
        return None
    return result