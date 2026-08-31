"""Orchestrator tests: detection routing, level gating, and the
never-worse-than-original safety guarantee."""

from __future__ import annotations

import json

from ctxshrink.compress import compress, decompress
from ctxshrink.levels import LEVEL_AGGRESSIVE, LEVEL_CONSERVATIVE, LEVEL_LOSSLESS, LEVEL_NONE


def test_level_none_is_always_a_passthrough() -> None:
    text = "def f(x):\n    return x + 1\n"
    result = compress(text, level=LEVEL_NONE)
    assert result.text == text
    assert result.method == "none"
    assert result.changed is False


def test_json_uses_toon_at_lossless_level() -> None:
    data = json.dumps({"rows": [{"id": i, "name": "n%d" % i} for i in range(10)]})
    result = compress(data, level=LEVEL_LOSSLESS)
    assert result.method == "toon"
    assert result.lossless is True
    assert result.result_tokens < result.original_tokens


def test_toon_roundtrips_through_decompress() -> None:
    data = json.dumps({"a": 1, "b": [1, 2, 3], "c": {"d": "e"}})
    result = compress(data, level=LEVEL_LOSSLESS)
    if result.method == "toon":
        back = decompress(result.text, result.method)
        assert back is not None
        assert json.loads(back) == json.loads(data)


def test_code_reduction_at_conservative_level() -> None:
    src = (
        "import os\n\n\n"
        "def compute(x, y):\n"
        "    total = x + y\n"
        "    scaled = total * 2\n"
        "    return scaled\n"
    )
    result = compress(src, level=LEVEL_CONSERVATIVE, content_type="code")
    assert result.content_type == "code"
    assert result.result_tokens <= result.original_tokens


def test_never_returns_something_larger_than_the_original() -> None:
    samples = [
        "def f(x):\n    return x\n",
        json.dumps({"a": [1, 2, 3]}),
        "plain english sentence with nothing to compress",
        "diff --git a/x b/x\n--- a/x\n+++ b/x\n",
    ]
    for text in samples:
        for level in (LEVEL_LOSSLESS, LEVEL_CONSERVATIVE, LEVEL_AGGRESSIVE):
            result = compress(text, level=level)
            assert result.result_tokens <= result.original_tokens
            assert len(result.text) <= len(text) or result.text == text


def test_unsafe_reduction_falls_back_to_original() -> None:
    # A single short line with a marker: nothing can be safely reduced.
    text = "TODO: fix this"
    result = compress(text, level=LEVEL_AGGRESSIVE, content_type="text")
    assert result.text == text


def test_as_dict_contains_expected_fields() -> None:
    result = compress("hello world", level=LEVEL_CONSERVATIVE, content_type="text")
    d = result.as_dict()
    for key in (
        "content_type", "level", "level_name", "method", "lossless", "applied",
        "changed", "original_tokens", "result_tokens", "savings_ratio",
    ):
        assert key in d


def test_content_type_override_is_respected() -> None:
    text = "some_var = 1"
    result = compress(text, level=LEVEL_CONSERVATIVE, content_type="text")
    assert result.content_type == "text"


def test_empty_text_is_a_clean_noop() -> None:
    result = compress("", level=LEVEL_AGGRESSIVE)
    assert result.text == ""
    assert result.method == "none"


def test_decompress_returns_none_for_lossy_methods() -> None:
    assert decompress("anything", "prose") is None
    assert decompress("anything", "code") is None