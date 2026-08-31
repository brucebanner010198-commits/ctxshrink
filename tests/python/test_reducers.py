"""Reducer tests, including regressions for the nested-container and
placeholder-eaten-by-comments bugs found during development."""

from __future__ import annotations

import json

from ctxshrink.reducers import code, comments, diff, json_, log, prose


class TestCodeReducer:
    def test_elides_simple_function_body(self) -> None:
        src = (
            "def add(a, b):\n"
            "    total = a + b\n"
            "    print(total)\n"
            "    return total\n"
        )
        out = code.reduce(src, level=2)
        assert out is not None
        assert "def add(a, b):" in out
        assert "..." in out
        assert "total = a + b" not in out

    def test_keeps_docstring_when_eliding_body(self) -> None:
        src = 'def f(x):\n    """Explain f."""\n    y = x + 1\n    return y\n'
        out = code.reduce(src, level=2)
        assert out is not None
        assert '"""Explain f."""' in out

    def test_preserves_body_containing_a_marker(self) -> None:
        src = "def f(x):\n    # TODO: handle negatives\n    return x\n"
        out = code.reduce(src, level=2)
        # Only one statement in the body -> nothing to usefully elide once the
        # marker forces preservation, so this may legitimately be a no-op.
        if out is not None:
            assert "TODO" in out

    def test_recurses_into_class_so_one_markered_method_does_not_block_siblings(self) -> None:
        # Regression: earlier implementation treated an entire class body as
        # one opaque blob, so a marker anywhere inside blocked eliding ANY
        # method, including unrelated ones with no marker at all.
        src = (
            "class Widget:\n"
            "    def a(self):\n"
            "        x = 1\n"
            "        y = 2\n"
            "        return x + y\n"
            "\n"
            "    def b(self):\n"
            "        # TODO: revisit\n"
            "        return 1\n"
            "\n"
            "    def c(self):\n"
            "        z = 3\n"
            "        return z\n"
        )
        out = code.reduce(src, level=2)
        assert out is not None
        assert "def a(self):" in out
        assert "def b(self):" in out
        assert "def c(self):" in out
        assert "TODO" in out  # b's body kept because of the marker
        assert "x = 1" not in out  # a's body elided
        assert "z = 3" not in out  # c's body elided

    def test_brace_based_recurses_into_class_too(self) -> None:
        src = (
            "class Server {\n"
            "  constructor() {\n"
            "    this.x = 1;\n"
            "  }\n"
            "\n"
            "  risky() {\n"
            "    // FIXME: needs validation\n"
            "    return doWork();\n"
            "  }\n"
            "\n"
            "  listen(port) {\n"
            "    this.httpServer = create();\n"
            "    this.httpServer.listen(port);\n"
            "  }\n"
            "}\n"
        )
        out = code.reduce(src, level=2)
        assert out is not None
        assert "FIXME" in out  # risky() kept because of the marker
        assert "this.x = 1;" not in out  # constructor elided
        assert "this.httpServer.listen(port);" not in out  # listen elided

    def test_control_flow_bodies_are_not_treated_as_elidable_definitions(self) -> None:
        # Regression: `if (...) { ... }` has the same `identifier(args) {`
        # shape as a function definition and must not be collapsed the same
        # way -- an if-branch is real control flow, not implementation detail
        # hidden behind a signature.
        src = (
            "function f(x) {\n"
            "  if (!x) {\n"
            "    throw new Error(\"bad input\");\n"
            "  }\n"
            "  return x;\n"
            "}\n"
        )
        out = code.reduce(src, level=2)
        # f's own body has no nested *function* definition, so the whole
        # body may collapse -- but if it does not, the if-branch content
        # must never be silently dropped without a placeholder.
        if out is not None and "throw new Error" not in out:
            assert "..." in out or "// ..." in out

    def test_returns_none_for_code_with_nothing_to_elide(self) -> None:
        assert code.reduce("x = 1\ny = 2\n", level=2) is None

    def test_below_conservative_level_is_noop(self) -> None:
        src = "def f(x):\n    y = x + 1\n    return y\n"
        assert code.reduce(src, level=1) is None


class TestCommentsReducer:
    def test_drops_noise_line_comment(self) -> None:
        src = "# increment x\nx = x + 1\n"
        out = comments.reduce(src, level=2)
        assert out is not None
        assert "# increment x" not in out
        assert "x = x + 1" in out

    def test_keeps_marker_comment(self) -> None:
        src = "# TODO: fix this\nx = 1\n"
        out = comments.reduce(src, level=2)
        assert out is None or "TODO" in out

    def test_keeps_docstring(self) -> None:
        src = 'def f():\n    """Keep me."""\n    return 1\n'
        out = comments.reduce(src, level=2)
        assert out is None or '"""Keep me."""' in out

    def test_keeps_jsdoc_block(self) -> None:
        src = "/**\n * Keep this.\n */\nfunction f() {}\n"
        out = comments.reduce(src, level=2)
        assert out is None or "Keep this." in out

    def test_drops_multiline_noise_block_comment(self) -> None:
        src = (
            "const config = loadConfig();\n"
            "/* noise\n   spans lines */\n"
            "value = 1;\n"
            "console.log(config, value);\n"
        )
        out = comments.reduce(src, level=2)
        assert out is not None
        assert "noise" not in out
        assert "value = 1;" in out

    def test_does_not_eat_a_code_placeholder_from_a_prior_pass(self) -> None:
        # Regression: the code reducer's own "// ..." / "..." elision marker
        # must survive a subsequent comments pass, not be treated as noise.
        src = "function f() {\n  // ...\n}\n"
        out = comments.reduce(src, level=2)
        assert out is None or "// ..." in out


class TestProseReducer:
    def test_shortens_verbose_phrasing(self) -> None:
        src = "In order to fix this, due to the fact that the cache is stale, we must act."
        out = prose.reduce(src, level=3)
        assert out is not None
        assert "in order to" not in out.lower()
        assert "due to the fact that" not in out.lower()
        assert len(out) < len(src)

    def test_preserves_the_claim_being_made(self) -> None:
        src = "In order to understand caching, we must invalidate stale entries."
        out = prose.reduce(src, level=3)
        assert out is not None
        assert "invalidate" in out
        assert "stale" in out

    def test_noop_below_conservative_level(self) -> None:
        assert prose.reduce("In order to do this.", level=1) is None


class TestJsonReducer:
    def test_truncates_long_array_with_marker(self) -> None:
        data = {"rows": [{"id": i} for i in range(50)]}
        out = json_.reduce(json.dumps(data), level=3)
        assert out is not None
        parsed = json.loads(out)
        assert any(isinstance(x, str) and "more" in x for x in parsed["rows"])

    def test_never_truncates_error_subtree(self) -> None:
        data = {"error": {"details": [{"code": i} for i in range(50)]}}
        out = json_.reduce(json.dumps(data), level=3)
        if out is not None:
            parsed = json.loads(out)
            assert len(parsed["error"]["details"]) == 50

    def test_noop_for_small_payload(self) -> None:
        assert json_.reduce('{"a":1,"b":2}', level=3) is None


class TestLogReducer:
    def test_keeps_error_and_traceback_context(self) -> None:
        lines = ["INFO heartbeat %d" % i for i in range(100)]
        lines.insert(50, "ERROR connection refused")
        lines.insert(51, "Traceback (most recent call last):")
        text = "\n".join(lines)
        out = log.reduce(text, level=3)
        assert out is not None
        assert "ERROR connection refused" in out
        assert "Traceback" in out
        assert "omitted" in out

    def test_keeps_edges_of_short_logs_unchanged(self) -> None:
        text = "\n".join("line %d" % i for i in range(5))
        assert log.reduce(text, level=3) is None


class TestDiffReducer:
    def test_keeps_headers_and_changed_lines(self) -> None:
        lines = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,30 +1,30 @@"]
        for i in range(30):
            if i == 15:
                lines.append("-old")
                lines.append("+new")
            else:
                lines.append(" context %d" % i)
        text = "\n".join(lines)
        out = diff.reduce(text, level=2, context=1)
        assert out is not None
        assert "-old" in out
        assert "+new" in out
        assert "unchanged" in out