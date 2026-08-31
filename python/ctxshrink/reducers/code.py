"""Code reducer: elides function/method bodies, keeps everything a reader
needs to know the shape of the file (imports, signatures, decorators,
docstrings, and marker lines) while dropping implementation detail.

Two strategies, chosen by a light heuristic on the source:

* **Indent-based** (Python-like): a ``def``/``class`` header is kept, its
  immediate docstring is kept, and the rest of its indented body collapses to
  a single ``    ...`` line, unless the body contains a marker line.
* **Brace-based** (C-like): the signature line up to and including the
  opening ``{`` is kept, the balanced body collapses to ``{ ... }``.

Both strategies keep the file syntactically parseable (balanced braces /
consistent indentation) and never touch import/using/package lines or
top-level statements outside a function or method body.
"""

from __future__ import annotations

import re
from typing import Optional

from ..levels import LEVEL_CONSERVATIVE
from ..safety import CODE_MARKERS, SafetyPolicy, check_safety

__all__ = ["reduce"]

_PY_DEF_RE = re.compile(r"^(\s*)(async\s+def|def|class)\s", re.MULTILINE)
_CONTROL_FLOW_KEYWORDS = (
    "if", "else", "for", "while", "switch", "catch", "do", "with", "try", "finally"
)
_BRACE_DEF_HINT_RE = re.compile(
    r"^\s*(export\s+)?(default\s+)?(async\s+)?"
    r"(function\b|class\b|"
    r"(?!(?:" + "|".join(_CONTROL_FLOW_KEYWORDS) + r")\b)"
    r"[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{?\s*$|"
    r"(public|private|protected|static)\b.*\()"
)
_DOCSTRING_START_RE = re.compile(r'^\s*("""|\'\'\')')
_DECORATOR_RE = re.compile(r"^\s*@\w")


def _has_marker(line: str) -> bool:
    return any(m in line for m in CODE_MARKERS)


def _looks_indent_based(text: str) -> bool:
    return bool(_PY_DEF_RE.search(text)) and text.count("{") < text.count("def ") + text.count(
        "class "
    )


def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _reduce_indent_lines(lines: list) -> tuple:
    """Elide leaf function/method bodies; recurse into containers (a class,
    or a function nested inside another) so an unrelated marker deep inside
    one method never blocks eliding its siblings."""
    out: list = []
    i = 0
    changed = False
    n = len(lines)

    while i < n:
        line = lines[i]
        m = _PY_DEF_RE.match(line)
        if not m:
            out.append(line)
            i += 1
            continue

        header_indent = len(m.group(1))
        out.append(line)
        i += 1

        # Keep an immediately following docstring untouched.
        if i < n and _DOCSTRING_START_RE.match(lines[i]):
            quote = lines[i].strip()[:3]
            out.append(lines[i])
            single_line = lines[i].strip().count(quote) >= 2
            i += 1
            if not single_line:
                while i < n and quote not in lines[i]:
                    out.append(lines[i])
                    i += 1
                if i < n:
                    out.append(lines[i])
                    i += 1

        body_start = i
        while i < n and (lines[i].strip() == "" or _indent_of(lines[i]) > header_indent):
            i += 1
        body = lines[body_start:i]
        # Trim trailing blank lines from the captured body so we do not
        # collapse them away as if they were meaningful.
        while body and body[-1].strip() == "":
            body.pop()

        if not body:
            continue

        if any(_PY_DEF_RE.match(b) for b in body):
            # Container (class body, or a function holding nested defs):
            # recurse so each member is elided on its own merits.
            nested, nested_changed = _reduce_indent_lines(body)
            out.extend(nested)
            changed = changed or nested_changed
            continue

        if any(_has_marker(b) for b in body):
            out.extend(body)
            continue

        out.append(" " * (header_indent + 4) + "...")
        changed = True

    return out, changed


def _reduce_indent_based(text: str) -> Optional[str]:
    lines = text.split("\n")
    out, changed = _reduce_indent_lines(lines)
    if not changed:
        return None
    return "\n".join(out)


def _opens_block(line: str) -> bool:
    return (line.count("{") - line.count("}")) > 0 and bool(_BRACE_DEF_HINT_RE.match(line))


def _reduce_brace_lines(lines: list) -> tuple:
    """Elide leaf method/function bodies; recurse into containers (a class
    body, or a function holding nested functions) so a marker deep inside one
    method never blocks eliding its siblings."""
    out: list = []
    i = 0
    n = len(lines)
    changed = False

    while i < n:
        line = lines[i]
        # Carry decorators/annotations up to a signature line together.
        if _DECORATOR_RE.match(line):
            out.append(line)
            i += 1
            continue

        depth = line.count("{") - line.count("}")
        if depth <= 0 or not _BRACE_DEF_HINT_RE.match(line):
            out.append(line)
            i += 1
            continue

        header_indent = _indent_of(line)
        out.append(line)
        i += 1
        body_start = i
        while i < n and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            i += 1
        body_end = i - 1  # index of the closing-brace line
        if body_end < body_start:
            continue
        body = lines[body_start:body_end]

        if not body:
            out.append(lines[body_end])
            continue

        if any(_opens_block(b) for b in body):
            # Container: recurse so each member is elided on its own merits
            # instead of the whole container surviving or vanishing as one.
            nested, nested_changed = _reduce_brace_lines(body)
            out.extend(nested)
            out.append(lines[body_end])
            changed = changed or nested_changed
            continue

        if any(_has_marker(b) for b in body):
            out.extend(body)
            out.append(lines[body_end])
            continue

        out.append(" " * (header_indent + 2) + "// ...")
        changed = True
        out.append(lines[body_end])

    return out, changed


def _reduce_brace_based(text: str) -> Optional[str]:
    lines = text.split("\n")
    out, changed = _reduce_brace_lines(lines)
    if not changed:
        return None
    return "\n".join(out)


def reduce(
    text: str,
    level: int = LEVEL_CONSERVATIVE,
    policy: Optional[SafetyPolicy] = None,
) -> Optional[str]:
    if level < LEVEL_CONSERVATIVE or not text.strip():
        return None

    if _looks_indent_based(text):
        result = _reduce_indent_based(text)
    else:
        result = _reduce_brace_based(text)

    if result is None or result == text:
        return None

    policy = policy or SafetyPolicy(max_drop_ratio=0.85, markers=CODE_MARKERS)
    if check_safety(text, result, policy):
        return None
    return result