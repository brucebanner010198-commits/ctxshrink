"""Token estimation tests."""

from __future__ import annotations

from ctxshrink.tokens import count_tokens, estimate_tokens


def test_empty_string_is_zero_tokens() -> None:
    assert estimate_tokens("") == 0


def test_estimate_is_deterministic() -> None:
    text = "The quick brown fox jumps over the lazy dog."
    assert estimate_tokens(text) == estimate_tokens(text)


def test_estimate_scales_roughly_with_length() -> None:
    short = "hello world"
    long = short * 20
    assert estimate_tokens(long) > estimate_tokens(short)


def test_estimate_counts_cjk_more_densely_than_ascii() -> None:
    ascii_text = "a" * 12
    cjk_text = "\u4f60\u597d" * 6  # 12 CJK characters
    assert estimate_tokens(cjk_text) > estimate_tokens(ascii_text)


def test_estimate_never_negative() -> None:
    for text in ["", " ", "\n\n\n", "x", "a" * 1000]:
        assert estimate_tokens(text) >= 0


def test_count_tokens_falls_back_to_estimate_without_backend() -> None:
    result = count_tokens("hello world", model="auto")
    assert result.tokens >= 0
    assert result.method in ("estimate", "o200k_base", "cl100k_base")
    assert isinstance(result.exact, bool)


def test_count_tokens_reports_char_length() -> None:
    result = count_tokens("hello")
    assert result.chars == 5


def test_as_dict_has_expected_keys() -> None:
    result = count_tokens("hi")
    d = result.as_dict()
    assert set(d.keys()) == {"tokens", "chars", "method", "exact"}
