"""Command-line interface for ctxshrink.

Subcommands
-----------

``count``      count tokens for stdin or a file
``analyze``    content-type detection and text statistics
``compress``   detect + reduce + safety-check, print the result
``toon encode|decode``   the TOON re-encoder, standalone
``benchmark``  run the bundled fixture corpus, print a savings table
``dashboard``  serve the local metrics dashboard
``levels``     print the optimization level / safety class reference
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from . import __version__
from .analyze import analyze
from .compress import compress
from .levels import LEVEL_NAMES, SAFETY_NAMES
from .tokens import count_tokens, estimate_tokens
from .toon import toon_decode, toon_encode


def _read_input(path: Optional[str]) -> str:
    if path and path != "-":
        return Path(path).read_text(encoding="utf-8")
    return sys.stdin.read()


def _print_json(obj) -> None:
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def _cmd_count(args: argparse.Namespace) -> int:
    text = _read_input(args.file)
    if args.exact:
        result = count_tokens(text, model=args.model)
        _print_json(result.as_dict())
    else:
        tokens = estimate_tokens(text)
        if args.json:
            _print_json({"tokens": tokens, "chars": len(text), "method": "estimate"})
        else:
            print(tokens)
    return 0


def _cmd_analyze(args: argparse.Namespace) -> int:
    text = _read_input(args.file)
    result = analyze(text, content_type=args.type)
    _print_json(result.as_dict())
    return 0


def _cmd_compress(args: argparse.Namespace) -> int:
    text = _read_input(args.file)
    result = compress(text, level=args.level, content_type=args.type)

    if args.stats_only:
        _print_json(result.as_dict())
        return 0

    if args.json:
        payload = result.as_dict()
        payload["text"] = result.text
        _print_json(payload)
        return 0

    sys.stdout.write(result.text)
    if not result.text.endswith("\n"):
        sys.stdout.write("\n")
    if args.stats:
        stats = result.as_dict()
        print(
            "--- %s: %d -> %d tokens (%.1f%% saved), method=%s"
            % (
                stats["content_type"],
                stats["original_tokens"],
                stats["result_tokens"],
                stats["savings_ratio"] * 100,
                stats["method"],
            ),
            file=sys.stderr,
        )
    return 0


def _cmd_toon_encode(args: argparse.Namespace) -> int:
    text = _read_input(args.file)
    out = toon_encode(text, delimiter=args.delimiter)
    if out is None:
        print("error: input is not TOON-encodable JSON", file=sys.stderr)
        return 1
    sys.stdout.write(out)
    return 0


def _cmd_toon_decode(args: argparse.Namespace) -> int:
    text = _read_input(args.file)
    out = toon_decode(text)
    if out is None:
        print("error: input is not valid TOON", file=sys.stderr)
        return 1
    print(out)
    return 0


def _cmd_levels(_args: argparse.Namespace) -> int:
    print("Optimization levels:")
    for value, name in sorted(LEVEL_NAMES.items()):
        print("  %d  %-14s" % (value, name))
    print()
    print("Safety classes:")
    for code, name in SAFETY_NAMES.items():
        print("  %-3s %s" % (code, name))
    return 0


def _cmd_benchmark(args: argparse.Namespace) -> int:
    from .benchmark import run_benchmark

    report = run_benchmark(
        fixtures_dir=args.fixtures,
        levels=args.levels,
        save_to=args.save,
    )
    if args.json:
        _print_json(report.as_dict())
    else:
        print(report.render_table())
    return 0


def _cmd_dashboard(args: argparse.Namespace) -> int:
    from .dashboard import serve

    serve(host=args.host, port=args.port, metrics_file=args.metrics_file, open_browser=not args.no_browser)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ctxshrink",
        description="Shrink prompts and code context for AI coding assistants.",
    )
    parser.add_argument("--version", action="version", version="ctxshrink %s" % __version__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_count = sub.add_parser("count", help="count tokens")
    p_count.add_argument("file", nargs="?", help="file to read (default: stdin)")
    p_count.add_argument("--exact", action="store_true", help="use an exact BPE counter if available")
    p_count.add_argument("--model", default="auto", help="model/encoding name for --exact")
    p_count.add_argument("--json", action="store_true", help="print a JSON object instead of a bare number")
    p_count.set_defaults(func=_cmd_count)

    p_analyze = sub.add_parser("analyze", help="detect content type and print text statistics")
    p_analyze.add_argument("file", nargs="?", help="file to read (default: stdin)")
    p_analyze.add_argument("--type", help="override content-type detection")
    p_analyze.set_defaults(func=_cmd_analyze)

    p_compress = sub.add_parser("compress", help="detect, reduce, and safety-check text")
    p_compress.add_argument("file", nargs="?", help="file to read (default: stdin)")
    p_compress.add_argument(
        "--level",
        type=int,
        default=2,
        choices=[0, 1, 2, 3],
        help="0 none, 1 lossless, 2 conservative (default), 3 aggressive",
    )
    p_compress.add_argument("--type", help="override content-type detection")
    p_compress.add_argument("--stats", action="store_true", help="print a one-line stats summary to stderr")
    p_compress.add_argument("--stats-only", action="store_true", help="print only the JSON stats, not the text")
    p_compress.add_argument("--json", action="store_true", help="print text + stats as one JSON object")
    p_compress.set_defaults(func=_cmd_compress)

    p_toon = sub.add_parser("toon", help="the TOON re-encoder")
    toon_sub = p_toon.add_subparsers(dest="toon_command", required=True)

    p_toon_encode = toon_sub.add_parser("encode", help="JSON -> TOON")
    p_toon_encode.add_argument("file", nargs="?", help="file to read (default: stdin)")
    p_toon_encode.add_argument("--delimiter", default=",", help="cell delimiter (default ,)")
    p_toon_encode.set_defaults(func=_cmd_toon_encode)

    p_toon_decode = toon_sub.add_parser("decode", help="TOON -> JSON")
    p_toon_decode.add_argument("file", nargs="?", help="file to read (default: stdin)")
    p_toon_decode.set_defaults(func=_cmd_toon_decode)

    p_levels = sub.add_parser("levels", help="print the optimization level / safety class reference")
    p_levels.set_defaults(func=_cmd_levels)

    p_bench = sub.add_parser("benchmark", help="run the bundled fixture corpus and report savings")
    p_bench.add_argument("--fixtures", help="path to a fixtures directory (default: bundled)")
    p_bench.add_argument(
        "--levels", type=int, nargs="+", default=[1, 2, 3], help="levels to benchmark (default 1 2 3)"
    )
    p_bench.add_argument("--json", action="store_true", help="print the report as JSON")
    p_bench.add_argument("--save", help="write the JSON report to this path (also used by the dashboard)")
    p_bench.set_defaults(func=_cmd_benchmark)

    p_dash = sub.add_parser("dashboard", help="serve the local metrics dashboard")
    p_dash.add_argument("--host", default="127.0.0.1")
    p_dash.add_argument("--port", type=int, default=8877)
    p_dash.add_argument("--metrics-file", help="path to a benchmark JSON report to display")
    p_dash.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    p_dash.set_defaults(func=_cmd_dashboard)

    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())