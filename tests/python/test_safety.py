"""Safety-policy tests: the gate every reducer output must pass."""

from __future__ import annotations

from ctxshrink.safety import CODE_MARKERS, MARKERS, SafetyPolicy, check_safety, is_safe


def test_smaller_output_with_no_markers_is_safe() -> None:
    assert is_safe("a" * 100, "a" * 50)


def test_not_smaller_is_unsafe() -> None:
    failures = check_safety("short", "short but longer now")
    assert any(f.rule == "size" for f in failures)


def test_dropping_a_marker_line_is_unsafe() -> None:
    original = "normal line\nTODO: fix this\nother line"
    transformed = "normal line\nother"
    failures = check_safety(original, transformed)
    assert any(f.rule == "marker" for f in failures)


def test_keeping_the_marker_line_is_safe() -> None:
    original = "aaaaaaaaaa\nTODO: fix this\nbbbbbbbbbb"
    transformed = "TODO: fix this"
    assert is_safe(original, transformed)


def test_max_drop_ratio_rejects_over_aggressive_collapse() -> None:
    original = "x" * 1000
    transformed = "x"
    policy = SafetyPolicy(max_drop_ratio=0.5)
    failures = check_safety(original, transformed, policy)
    assert any(f.rule == "drop_ratio" for f in failures)


def test_preserve_markers_false_allows_dropping_markers() -> None:
    original = "TODO: fix this\nbbbbbbbbbb"
    transformed = "bbbbbbbbbb"
    policy = SafetyPolicy(preserve_markers=False)
    assert is_safe(original, transformed, policy)


def test_code_markers_excludes_common_code_vocabulary() -> None:
    # "error"/"token"/"exception" must not be code markers: they are ordinary
    # vocabulary in real code (`throw new Error(...)`, `catch (error)`).
    for word in ("error", "Error", "exception", "token", "secret", "password"):
        assert word not in CODE_MARKERS
    # But the full MARKERS set (used for text/log) does include them.
    assert "error" in MARKERS or "Error" in MARKERS


def test_code_markers_still_includes_shouty_tags() -> None:
    for tag in ("TODO", "FIXME", "SECURITY"):
        assert tag in CODE_MARKERS


def test_custom_markers_override_default_set() -> None:
    original = "line one\nCUSTOM_TAG here\nline two"
    transformed = "line one\nline two"
    default_policy_failures = check_safety(original, transformed)
    assert not default_policy_failures  # "CUSTOM_TAG" is not in MARKERS

    custom_policy = SafetyPolicy(markers=("CUSTOM_TAG",))
    custom_failures = check_safety(original, transformed, custom_policy)
    assert any(f.rule == "marker" for f in custom_failures)
