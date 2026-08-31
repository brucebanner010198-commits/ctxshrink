"""Benchmark runner: applies compress() to a fixture corpus and reports
token savings per file, per content type, and overall.

Fixtures ship inside the installed package (``ctxshrink/_fixtures``, bundled
from ``benchmarks/fixtures/`` at build time) so ``ctxshrink benchmark`` works
for a plain ``pip install ctxshrink`` and not only from a checkout of this
repository. ``CTXSHRINK_FIXTURES_DIR`` overrides the location; an explicit
``fixtures_dir`` argument to :func:`run_benchmark` overrides both. Each file
is treated as one sample; its content type is autodetected unless the
extension hints at one (``.json``, ``.diff``, ``.log``, and so on).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .compress import compress
from .tokens import estimate_tokens

__all__ = ["run_benchmark", "BenchmarkReport", "BenchmarkRow", "default_fixtures_dir"]

_EXTENSION_HINTS = {
    ".json": "json",
    ".diff": "diff",
    ".patch": "diff",
    ".log": "log",
    ".py": "code",
    ".js": "code",
    ".ts": "code",
    ".go": "code",
    ".txt": "text",
    ".md": "text",
}


def default_fixtures_dir() -> Path:
    env_override = os.environ.get("CTXSHRINK_FIXTURES_DIR")
    if env_override:
        return Path(env_override)
    packaged = Path(__file__).resolve().parent / "_fixtures"
    if packaged.is_dir():
        return packaged
    # Running from a source checkout (editable install / repo dev): the
    # wheel's force-include is not materialized, fall back to the repo path.
    return Path(__file__).resolve().parents[2] / "benchmarks" / "fixtures"


@dataclass
class BenchmarkRow:
    name: str
    content_type: str
    level: int
    method: str
    original_tokens: int
    result_tokens: int
    original_chars: int
    result_chars: int
    savings_ratio: float

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "content_type": self.content_type,
            "level": self.level,
            "method": self.method,
            "original_tokens": self.original_tokens,
            "result_tokens": self.result_tokens,
            "original_chars": self.original_chars,
            "result_chars": self.result_chars,
            "savings_ratio": round(self.savings_ratio, 4),
        }


@dataclass
class BenchmarkReport:
    rows: list = field(default_factory=list)
    generated_at: float = field(default_factory=time.time)
    fixtures_dir: str = ""

    def as_dict(self) -> dict:
        return {
            "generated_at": self.generated_at,
            "fixtures_dir": self.fixtures_dir,
            "rows": [r.as_dict() for r in self.rows],
            "summary": self.summary(),
        }

    def summary(self) -> dict:
        by_type: dict = {}
        for row in self.rows:
            bucket = by_type.setdefault(
                row.content_type, {"original_tokens": 0, "result_tokens": 0, "count": 0}
            )
            bucket["original_tokens"] += row.original_tokens
            bucket["result_tokens"] += row.result_tokens
            bucket["count"] += 1
        for bucket in by_type.values():
            ot = bucket["original_tokens"]
            bucket["savings_ratio"] = round(
                1.0 - (bucket["result_tokens"] / ot), 4
            ) if ot else 0.0

        total_original = sum(r.original_tokens for r in self.rows)
        total_result = sum(r.result_tokens for r in self.rows)
        overall = (
            round(1.0 - (total_result / total_original), 4) if total_original else 0.0
        )
        return {
            "by_content_type": by_type,
            "total_original_tokens": total_original,
            "total_result_tokens": total_result,
            "overall_savings_ratio": overall,
            "file_count": len(self.rows),
        }

    def render_table(self) -> str:
        lines = []
        header = "%-28s %-8s %-5s %-14s %10s %10s %8s" % (
            "file", "type", "lvl", "method", "orig_tok", "new_tok", "saved"
        )
        lines.append(header)
        lines.append("-" * len(header))
        for row in self.rows:
            lines.append(
                "%-28s %-8s %-5d %-14s %10d %10d %7.1f%%"
                % (
                    row.name[:28],
                    row.content_type,
                    row.level,
                    row.method,
                    row.original_tokens,
                    row.result_tokens,
                    row.savings_ratio * 100,
                )
            )
        summary = self.summary()
        lines.append("-" * len(header))
        lines.append(
            "TOTAL  %d files, %d -> %d tokens, %.1f%% saved"
            % (
                summary["file_count"],
                summary["total_original_tokens"],
                summary["total_result_tokens"],
                summary["overall_savings_ratio"] * 100,
            )
        )
        lines.append("")
        lines.append("By content type:")
        for ctype, bucket in sorted(summary["by_content_type"].items()):
            lines.append(
                "  %-8s %2d files  %6d -> %6d tokens  %6.1f%% saved"
                % (
                    ctype,
                    bucket["count"],
                    bucket["original_tokens"],
                    bucket["result_tokens"],
                    bucket["savings_ratio"] * 100,
                )
            )
        return "\n".join(lines)


def _guess_type(path: Path) -> Optional[str]:
    return _EXTENSION_HINTS.get(path.suffix.lower())


def run_benchmark(
    fixtures_dir: Optional[str] = None,
    levels: Optional[list] = None,
    save_to: Optional[str] = None,
) -> BenchmarkReport:
    directory = Path(fixtures_dir) if fixtures_dir else default_fixtures_dir()
    levels = levels or [1, 2, 3]

    rows: list = []
    if directory.exists():
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            if "__pycache__" in path.parts or path.name.startswith("."):
                continue
            if path.suffix.lower() not in _EXTENSION_HINTS:
                # Skip stray files with no recognized fixture extension
                # (compiled bytecode, editor swap files, and similar); a
                # pip install by default byte-compiles every installed .py
                # file, including fixtures, leaving __pycache__ behind.
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if not text.strip():
                continue
            hint = _guess_type(path)
            for level in levels:
                result = compress(text, level=level, content_type=hint)
                rows.append(
                    BenchmarkRow(
                        name=str(path.relative_to(directory)),
                        content_type=result.content_type,
                        level=level,
                        method=result.method,
                        original_tokens=estimate_tokens(text),
                        result_tokens=estimate_tokens(result.text),
                        original_chars=len(text),
                        result_chars=len(result.text),
                        savings_ratio=result.savings_ratio,
                    )
                )

    report = BenchmarkReport(rows=rows, fixtures_dir=str(directory))
    if save_to:
        Path(save_to).write_text(json.dumps(report.as_dict(), indent=2), encoding="utf-8")
    return report
