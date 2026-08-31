"""Content-type detection tests."""

from __future__ import annotations

from ctxshrink.analyze import analyze, detect_content_type


def test_detects_json() -> None:
    assert detect_content_type('{"a": 1, "b": [1, 2, 3]}') == "json"


def test_detects_diff() -> None:
    text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n"
    assert detect_content_type(text) == "diff"


def test_detects_log() -> None:
    text = "2024-01-01T10:00:00 INFO starting\n2024-01-01T10:00:01 ERROR failed\n"
    assert detect_content_type(text) == "log"


def test_detects_python_code() -> None:
    text = "def foo(x, y):\n    return x + y\n\nclass Bar:\n    pass\n"
    assert detect_content_type(text) == "code"


def test_detects_plain_text() -> None:
    text = "This is a plain English paragraph with no code or structured data at all."
    assert detect_content_type(text) == "text"


def test_empty_text_defaults_to_text() -> None:
    assert detect_content_type("") == "text"
    assert detect_content_type("   \n  ") == "text"


def test_analyze_reports_marker_and_line_counts() -> None:
    result = analyze("def foo(x):\n    # TODO fix this\n    return x\n")
    assert result.content_type == "code"
    assert result.lines == 4
    assert result.marker_lines == 1
    assert result.tokens_estimate > 0


def test_analyze_guesses_python_language() -> None:
    result = analyze("import os\n\ndef f():\n    pass\n")
    assert result.detected_language == "python"


def test_analyze_as_dict_has_expected_keys() -> None:
    d = analyze("hello").as_dict()
    expected = {
        "content_type", "chars", "lines", "words", "tokens_estimate",
        "blank_lines", "marker_lines", "detected_language", "signals",
    }
    assert expected == set(d.keys())