"""TOON: a lossless, line-oriented re-encoding of JSON.

TOON (the "TOON" compact text format) turns standard JSON into a smaller
key: value / table layout that a model reads with fewer tokens, and that can
be decoded back to the exact same JSON data. It is lossless: the decode of an
encode equals the encode of the decode for any JSON in the supported subset.

The format is deliberately minimal.

* Object keys sort lexicographically.
* Scalars: ``key: value``.
* Empty object: ``key: {}``, empty array: ``key[0]: []``.
* Scalar array: ``key[N]: a,b,c``.
* Tabular array (array of objects with identical scalar keys):
  ``key[N]{field1,field2}:`` followed by N comma-joined rows at indent + 1.
* Root scalar / array / object start at indent 0.

Strings that could be confused with a number, boolean, null, a delimiter, or
leading/trailing whitespace are JSON-quoted; all other strings are bare.

Encode returns None for input that falls outside the supported,
proven-round-trip subset. Callers must pass the original bytes through
unchanged in that case (fail closed, never emit a transform that loses data).
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

__all__ = ["toon_encode", "toon_decode", "is_toon_safe_key"]

_SAFE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*$")
_JSON_NUMBER_RE = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$")


class _Num(str):
    """A JSON number whose lexical form is preserved (no float coercion)."""


def is_toon_safe_key(key: str) -> bool:
    return bool(_SAFE_KEY_RE.match(key))


def _indent(level: int) -> str:
    return "  " * level


def toon_encode(text: str, delimiter: str = ",") -> Optional[str]:
    """Encode JSON text as TOON, or return None if unsupported / malformed."""
    try:
        value = json.loads(
            text,
            parse_int=_Num,
            parse_float=_Num,
            parse_constant=_reject_constant,
            object_pairs_hook=_pairs_no_duplicates,
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if isinstance(value, _Num) and not _valid_json_number(str(value)):
        # A bare JSON number must still round trip; reject lexical forms the
        # decoder cannot reproduce (e.g. NaN, Infinity).
        return None
    out: list[str] = []
    ok = _write_value(out, value, "", 0, delimiter)
    if not ok:
        return None
    return "".join(out)


def _reject_constant(value: str) -> Any:
    raise ValueError("unsupported JSON constant: %s" % value)


def _pairs_no_duplicates(pairs: list) -> dict:
    out: dict = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate object key: %r" % key)
        out[key] = value
    return out


def _sort_keys(obj: dict) -> list:
    return sorted(obj.keys())


def _write_value(out: list, value: Any, name: str, indent: int, delimiter: str) -> bool:
    if isinstance(value, dict):
        if name == "":
            if not value:
                out.append("{}\n")
                return True
            return _write_object(out, value, indent, delimiter)
        if not is_toon_safe_key(name):
            return False
        if not value:
            out.append(_indent(indent) + "%s: {}\n" % name)
            return True
        out.append(_indent(indent) + "%s:\n" % name)
        return _write_object(out, value, indent + 1, delimiter)
    if isinstance(value, list):
        return _write_array(out, value, name, indent, delimiter)
    encoded = _encode_scalar(value, delimiter)
    if encoded is None:
        return False
    out.append(_indent(indent))
    if name == "":
        out.append(encoded + "\n")
    else:
        if not is_toon_safe_key(name):
            return False
        out.append("%s: %s\n" % (name, encoded))
    return True


def _write_object(out: list, obj: dict, indent: int, delimiter: str) -> bool:
    for key in _sort_keys(obj):
        if not is_toon_safe_key(key):
            return False
        if not _write_value(out, obj[key], key, indent, delimiter):
            return False
    return True


def _write_array(out: list, arr: list, name: str, indent: int, delimiter: str) -> bool:
    if name != "" and not is_toon_safe_key(name):
        return False
    if not arr:
        out.append(_indent(indent))
        out.append("[]\n" if name == "" else "%s[0]: []\n" % name)
        return True
    if _scalar_array(arr):
        cells = []
        for elem in arr:
            cell = _encode_scalar(elem, delimiter)
            if cell is None:
                return False
            cells.append(cell)
        out.append(_indent(indent))
        if name == "":
            out.append("[%d]: %s\n" % (len(arr), delimiter.join(cells)))
        else:
            out.append("%s[%d]: %s\n" % (name, len(arr), delimiter.join(cells)))
        return True
    fields, rows = _tabular_rows(arr, delimiter)
    if fields is None:
        return False
    for field in fields:
        if not is_toon_safe_key(field):
            return False
    out.append(_indent(indent))
    if name == "":
        out.append("[%d]{%s}:\n" % (len(rows), ",".join(fields)))
    else:
        out.append("%s[%d]{%s}:\n" % (name, len(rows), ",".join(fields)))
    for row in rows:
        out.append(_indent(indent + 1) + delimiter.join(row) + "\n")
    return True


def _scalar_array(arr: list) -> bool:
    return all(_is_scalar(e) for e in arr)


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, bool) or isinstance(v, _Num) or isinstance(v, str)


def _tabular_rows(arr: list, delimiter: str) -> tuple:
    if not arr or not isinstance(arr[0], dict) or not arr[0]:
        return None, None
    fields = _sort_keys(arr[0])
    if any(not _is_scalar(arr[0][f]) for f in fields):
        return None, None
    rows = []
    for item in arr:
        if not isinstance(item, dict) or _sort_keys(item) != fields:
            return None, None
        row = []
        for field in fields:
            cell = _encode_scalar(item[field], delimiter)
            if cell is None:
                return None, None
            row.append(cell)
        rows.append(row)
    return fields, rows


def _encode_scalar(v: Any, delimiter: str) -> Optional[str]:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, _Num):
        s = str(v)
        return s if _valid_json_number(s) else None
    if isinstance(v, str):
        if _needs_quote(v, delimiter):
            try:
                return json.dumps(v, ensure_ascii=True)
            except (ValueError, TypeError):
                return None
        return v
    return None


def _needs_quote(s: str, delimiter: str) -> bool:
    if s == "" or s.strip() != s:
        return True
    if any(ch in s for ch in "\n\r\t"):
        return True
    if any(ch in s for ch in '"' + ":" + delimiter):
        return True
    if s[0] in "[{\"-":
        return True
    if "0" <= s[0] <= "9":
        return True
    if s in ("true", "false", "null"):
        return True
    return _valid_json_number(s)


def _valid_json_number(s: str) -> bool:
    return bool(_JSON_NUMBER_RE.match(s))


# --------------------------------------------------------------------------- #
# Decode: TOON text back to JSON text.
# --------------------------------------------------------------------------- #

_TABULAR_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_.-]*)?\[(\d+)\]\{([^}]*)\}:$")
_ARRAY_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_.-]*)?\[(\d+)\]:(?: (.*))?$")
_KEY_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_.-]*):(?: (.*))?$")


def toon_decode(text: str) -> Optional[str]:
    """Decode TOON text back to canonical JSON text, or None if malformed."""
    lines, ok = _scan_lines(text)
    if not ok or not lines:
        return None
    if lines[0][0] != 0:  # indent of first line must be zero
        return None
    value, next_i, ok = _parse_root(lines, 0)
    if not ok or next_i != len(lines):
        return None
    return _to_json_text(value)


def _scan_lines(text: str) -> tuple:
    stripped = text.rstrip("\n")
    if stripped.strip() == "":
        return None, False
    lines = []
    for raw in stripped.split("\n"):
        if raw.strip() == "":
            return None, False
        spaces = len(raw) - len(raw.lstrip(" "))
        if spaces % 2 != 0:
            return None, False
        lines.append((spaces // 2, raw[spaces:]))
    return lines, True


def _parse_root(lines, i):
    text = lines[i][1]
    if text == "{}":
        return {}, i + 1, True
    if text == "[]":
        return [], i + 1, True
    if text.startswith('"'):
        v, ok = _parse_scalar(text)
        return v, i + 1, ok
    if text.startswith("["):
        return _parse_array(lines, i, 0)
    if ":" not in text:
        v, ok = _parse_scalar(text)
        return v, i + 1, ok
    return _parse_object(lines, i, 0)


def _parse_object(lines, i, indent):
    out = {}
    while i < len(lines):
        if lines[i][0] < indent:
            break
        if lines[i][0] > indent:
            return None, i, False
        text = lines[i][1]
        m = _TABULAR_LINE_RE.match(text)
        if m and (m.group(1) or ""):
            key = m.group(1)
            if key in out:
                return None, i, False
            v, nxt, ok = _parse_array(lines, i, indent)
            if not ok:
                return None, i, False
            out[key] = v
            i = nxt
            continue
        m = _ARRAY_LINE_RE.match(text)
        if m and (m.group(1) or ""):
            key = m.group(1)
            if key in out:
                return None, i, False
            v, nxt, ok = _parse_array(lines, i, indent)
            if not ok:
                return None, i, False
            out[key] = v
            i = nxt
            continue
        m = _KEY_LINE_RE.match(text)
        if not m or m.group(1) == "":
            return None, i, False
        key = m.group(1)
        rest = m.group(2) or ""
        if key in out:
            return None, i, False
        if rest == "{}":
            out[key] = {}
            i += 1
            continue
        if rest == "":
            if i + 1 >= len(lines) or lines[i + 1][0] != indent + 1:
                return None, i, False
            child, nxt, ok = _parse_object(lines, i + 1, indent + 1)
            if not ok:
                return None, i, False
            out[key] = child
            i = nxt
            continue
        val, ok = _parse_scalar(rest)
        if not ok:
            return None, i, False
        out[key] = val
        i += 1
    return out, i, True


def _parse_array(lines, i, indent):
    text = lines[i][1]
    m = _TABULAR_LINE_RE.match(text)
    if m:
        n = int(m.group(2))
        fields = _split_fields(m.group(3))
        if not fields:
            return None, i, False
        if n > len(lines) - i - 1:
            return None, i, False
        out = []
        i += 1
        for _ in range(n):
            if i >= len(lines) or lines[i][0] != indent + 1:
                return None, i, False
            cells, ok = _split_cells(lines[i][1], ",")
            if not ok or len(cells) != len(fields):
                return None, i, False
            obj = {}
            for c, field in enumerate(fields):
                val, ok = _parse_scalar(cells[c])
                if not ok:
                    return None, i, False
                obj[field] = val
            out.append(obj)
            i += 1
        return out, i, True
    m = _ARRAY_LINE_RE.match(text)
    if not m:
        return None, i, False
    n = int(m.group(2))
    rest = m.group(3) or ""
    if n == 0:
        if rest != "[]":
            return None, i, False
        return [], i + 1, True
    cells, ok = _split_cells(rest, ",")
    if not ok or len(cells) != n:
        return None, i, False
    out = []
    for cell in cells:
        val, ok = _parse_scalar(cell)
        if not ok:
            return None, i, False
        out.append(val)
    return out, i + 1, True


def _split_fields(s: str):
    if s == "":
        return None
    parts = s.split(",")
    seen = set()
    for p in parts:
        if not is_toon_safe_key(p):
            return None
        if p in seen:
            return None
        seen.add(p)
    return parts


def _split_cells(s: str, delimiter: str) -> tuple:
    out = []
    buf = []
    in_quote = False
    escaped = False
    for ch in s:
        if escaped:
            buf.append(ch)
            escaped = False
            continue
        if in_quote and ch == "\\":
            buf.append(ch)
            escaped = True
            continue
        if ch == '"':
            buf.append(ch)
            in_quote = not in_quote
            continue
        if not in_quote and ch == delimiter:
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if in_quote or escaped:
        return None, False
    out.append("".join(buf))
    return out, True


def _parse_scalar(s: str) -> tuple:
    if s == "":
        return None, False
    if s.startswith('"'):
        try:
            v = json.loads(s)
        except (ValueError, TypeError, json.JSONDecodeError):
            return None, False
        if not isinstance(v, str):
            return None, False
        return v, True
    if s == "true":
        return True, True
    if s == "false":
        return False, True
    if s == "null":
        return None, True
    if _valid_json_number(s):
        return _Num(s), True
    if any(ch in s for ch in "\n\r\t"):
        return None, False
    if s.strip() != s:
        return None, False
    return s, True


def _to_json_text(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, _Num):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, list):
        return "[" + ",".join(_to_json_text(e) for e in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=True) + ":" + _to_json_text(value[k]) for k in keys
        ) + "}"
    raise TypeError("unsupported value in TOON decode: %r" % (value,))
