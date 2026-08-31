#!/usr/bin/env python3
"""Cross-language parity check.

ctxshrink ships independently written Python and JavaScript
implementations that must agree on token counts and reduction outcomes for
the same input. This script runs ``ctxshrink benchmark`` through both CLIs
against the shared fixture corpus (``benchmarks/fixtures/``) and fails if
the results diverge on anything that matters: per-file token counts,
content-type detection, or the reduction method chosen. Field names differ
by convention (Python reports ``total_original_tokens``, JavaScript reports
``totalOriginalTokens``); this script maps between them rather than treating
the difference as a mismatch.

Usage: ``python3 scripts/check_parity.py``

Prefers the installed ``ctxshrink`` console script; falls back to
``python3 -m ctxshrink.cli`` against the ``python/`` source tree if it is
not on PATH, so this also works in a plain checkout without a pip install.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SUMMARY_FIELDS = [
    ("total_original_tokens", "totalOriginalTokens"),
    ("total_result_tokens", "totalResultTokens"),
    ("overall_savings_ratio", "overallSavingsRatio"),
    ("file_count", "fileCount"),
]

ROW_FIELDS = [
    ("content_type", "contentType"),
    ("method", "method"),
    ("original_tokens", "originalTokens"),
    ("result_tokens", "resultTokens"),
]


def python_cli_command() -> tuple[list[str], dict]:
    """Returns (argv prefix, extra env) to invoke the Python CLI."""
    ctxshrink_bin = shutil.which("ctxshrink")
    if ctxshrink_bin:
        return [ctxshrink_bin], {}
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    python_src = str(ROOT / "python")
    env["PYTHONPATH"] = python_src if not existing else python_src + os.pathsep + existing
    return [sys.executable, "-m", "ctxshrink.cli"], env


def run(cmd: list[str], extra_env: dict) -> None:
    env = dict(os.environ)
    env.update(extra_env)
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print("command failed: %s" % " ".join(cmd), file=sys.stderr)
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    py_prefix, py_env = python_cli_command()
    node_bin = shutil.which("node")
    if node_bin is None:
        print("error: `node` not found on PATH", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        py_path = Path(tmp) / "py-report.json"
        js_path = Path(tmp) / "js-report.json"

        run(py_prefix + ["benchmark", "--save", str(py_path)], py_env)
        run([node_bin, str(ROOT / "js" / "bin" / "ctxshrink.mjs"), "benchmark", "--save", str(js_path)], {})

        py_report = load(py_path)
        js_report = load(js_path)

    failures: list[str] = []

    py_summary = py_report["summary"]
    js_summary = js_report["summary"]
    for py_key, js_key in SUMMARY_FIELDS:
        py_val = py_summary[py_key]
        js_val = js_summary[js_key]
        if py_val != js_val:
            failures.append("summary.%s: python=%r js=%r" % (py_key, py_val, js_val))

    py_rows = {(r["name"], r["level"]): r for r in py_report["rows"]}
    js_rows = {(r["name"], r["level"]): r for r in js_report["rows"]}

    if set(py_rows) != set(js_rows):
        only_py = sorted(set(py_rows) - set(js_rows))
        only_js = sorted(set(js_rows) - set(py_rows))
        if only_py:
            failures.append("rows only in python report: %s" % only_py)
        if only_js:
            failures.append("rows only in js report: %s" % only_js)

    for key in sorted(set(py_rows) & set(js_rows)):
        py_row = py_rows[key]
        js_row = js_rows[key]
        for py_field, js_field in ROW_FIELDS:
            py_val = py_row[py_field]
            js_val = js_row[js_field]
            if py_val != js_val:
                failures.append("row %s.%s: python=%r js=%r" % (key, py_field, py_val, js_val))

    if failures:
        print(
            "PARITY CHECK FAILED (%d mismatch%s):"
            % (len(failures), "" if len(failures) == 1 else "es")
        )
        for f in failures:
            print("  - %s" % f)
        return 1

    print(
        "Parity OK: %d files, %d -> %d tokens (%.1f%% saved), identical in both languages"
        % (
            py_summary["file_count"],
            py_summary["total_original_tokens"],
            py_summary["total_result_tokens"],
            py_summary["overall_savings_ratio"] * 100,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())