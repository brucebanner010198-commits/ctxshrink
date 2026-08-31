"""Comment reducer: drops noise comments, keeps meaning-carrying ones.

Kept unconditionally: docstrings (Python triple-quoted, JSDoc ``/** */``
blocks), shebang lines, license/copyright headers, and any comment containing
a marker keyword (TODO, FIXME, SECURITY, and friends from
:mod:`ctxshrink.safety`). Everything else that is a standalone comment line is
dropped; comments trailing on a code line are left alone because they usually
disambiguate the line they sit on.
"""

from __future__ import annotations

import re
from typing import Optional

from ..levels import LEVEL_CONSERVATIVE
from ..safety import MARKERS, SafetyPolicy, check_safety

__all__ = ["reduce"]

_LINE_COMMENT_RE = re.compile(r"^\s*(#|//)(?!!)(?!/)\s?(.*)$")
_SHEBANG_RE = re.compile(r"^#!")
_LICENSE_HINT_RE = re.compile(
    r"copyright|license|spdx|all rights reserved", re.IGNORECASE
)
_DOC_COMMENT_START_RE = re.compile(r"^\s*/\*\*")
_BLOCK_COMMENT_START_RE = re.compile(r"^\s*/\*")
_BLOCK_COMMENT_END_RE = re.compile(r"\*/\s*$")
_TRIPLE_QUOTE_RE = re.compile(r'^\s*("""|\'\'\')')


def _has_marker(line: str) -> bool:
    return any(m in line for m in MARKERS)


def _is_noise_line_comment(line: str) -> bool:
    m = _LINE_COMMENT_RE.match(line)
    if not m:
        return False
    if _SHEBANG_RE.match(line):
        return False
    body = m.group(2)
    if body.strip() == "...":
        # The code reducer's own elision placeholder. A caller may run
        # comments after code (this module makes no assumption about pipeline
        # order), so this must never be mistaken for a noise comment.
        return False
    if _has_marker(line) or _LICENSE_HINT_RE.search(body):
        return False
    return True


def reduce(
    text: str,
    level: int = LEVEL_CONSERVATIVE,
    policy: Optional[SafetyPolicy] = None,
) -> Optional[str]:
    if level < LEVEL_CONSERVATIVE or not text:
        return None

    lines = text.split("\n")
    out: list = []
    in_jsdoc_block = False
    in_dropped_block = False
    in_triple_quote = False
    changed = False

    for line in lines:
        if in_triple_quote:
            out.append(line)
            if _TRIPLE_QUOTE_RE.search(line):
                in_triple_quote = False
            continue
        if _TRIPLE_QUOTE_RE.match(line):
            out.append(line)
            # Toggle unless the same line both opens and closes the string.
            stripped = line.strip()
            quote = stripped[:3]
            if stripped.count(quote) < 2:
                in_triple_quote = True
            continue
        if in_jsdoc_block:
            out.append(line)
            if _BLOCK_COMMENT_END_RE.search(line):
                in_jsdoc_block = False
            continue
        if in_dropped_block:
            changed = True
            if _BLOCK_COMMENT_END_RE.search(line):
                in_dropped_block = False
            continue
        if _DOC_COMMENT_START_RE.match(line):
            out.append(line)
            if not _BLOCK_COMMENT_END_RE.search(line):
                in_jsdoc_block = True
            continue
        if _BLOCK_COMMENT_START_RE.match(line) and not _has_marker(line):
            # Non-doc block comment: drop unless it carries a marker; if it
            # spans multiple lines, drop the whole span.
            changed = True
            if not _BLOCK_COMMENT_END_RE.search(line):
                in_dropped_block = True
            continue
        if _is_noise_line_comment(line):
            out.append(None)
            changed = True
            continue
        out.append(line)

    if not changed:
        return None

    kept = [line for line in out if line is not None]
    result = "\n".join(kept)

    policy = policy or SafetyPolicy(max_drop_ratio=0.6)
    if check_safety(text, result, policy):
        return None
    return result