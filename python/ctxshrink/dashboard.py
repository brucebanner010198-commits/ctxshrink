"""A tiny local dashboard for ctxshrink metrics.

No framework, no external dependency: :mod:`http.server` serves a static
single-page app plus a JSON metrics endpoint. Point ``--metrics-file`` at a
benchmark report (``ctxshrink benchmark --save report.json``) to view it, or
leave it unset to run a fresh benchmark against the bundled fixtures on
first load.
"""

from __future__ import annotations

import json
import os
import socketserver
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

__all__ = ["serve", "build_app_html"]


def _dashboard_dir() -> Path:
    env_override = os.environ.get("CTXSHRINK_DASHBOARD_DIR")
    if env_override:
        return Path(env_override)
    packaged = Path(__file__).resolve().parent / "_dashboard"
    if packaged.is_dir():
        return packaged
    # Running from a source checkout (editable install / repo dev): the
    # wheel's force-include is not materialized, fall back to the repo path.
    return Path(__file__).resolve().parents[2] / "dashboard"


_DASHBOARD_DIR = _dashboard_dir()


class _FastBindHTTPServer(ThreadingHTTPServer):
    """``HTTPServer.server_bind`` calls ``socket.getfqdn(host)`` to compute
    ``server_name``, which does a reverse DNS lookup. That lookup can hang for
    a long time in sandboxed or offline environments with no DNS resolver
    reachable. The server name is never used by this dashboard, so skip it
    and bind immediately."""  # noqa: D205

    def server_bind(self) -> None:
        # Deliberately bypasses HTTPServer.server_bind (not calling super())
        # to skip its socket.getfqdn() call; TCPServer.server_bind() still
        # performs the actual bind.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


def _load_metrics(metrics_file: Optional[str]) -> dict:
    if metrics_file and Path(metrics_file).exists():
        return json.loads(Path(metrics_file).read_text(encoding="utf-8"))
    from .benchmark import run_benchmark

    report = run_benchmark()
    return report.as_dict()


def build_app_html() -> str:
    html_path = _DASHBOARD_DIR / "index.html"
    if html_path.exists():
        return html_path.read_text(encoding="utf-8")
    return _FALLBACK_HTML


def _make_handler(metrics_file: Optional[str]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ctxshrink-dashboard/0.1"

        def log_message(self, format, *args):  # noqa: A002 - matches base signature
            return  # keep stdout quiet; the CLI already prints a startup line

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - stdlib method name
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                self._send(200, build_app_html().encode("utf-8"), "text/html; charset=utf-8")
                return
            if path == "/api/metrics":
                metrics = _load_metrics(metrics_file)
                self._send(
                    200,
                    json.dumps(metrics, indent=2).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return
            static = _DASHBOARD_DIR / path.lstrip("/")
            if static.exists() and static.is_file() and static.resolve().is_relative_to(
                _DASHBOARD_DIR.resolve()
            ):
                content_type = "text/css" if static.suffix == ".css" else "application/javascript"
                self._send(200, static.read_bytes(), content_type)
                return
            self._send(404, b"not found", "text/plain")

    return Handler


def serve(
    host: str = "127.0.0.1",
    port: int = 8877,
    metrics_file: Optional[str] = None,
    open_browser: bool = True,
) -> None:
    handler = _make_handler(metrics_file)
    httpd = _FastBindHTTPServer((host, port), handler)
    url = "http://%s:%d/" % (host, port)
    print("ctxshrink dashboard: %s (Ctrl+C to stop)" % url)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


_FALLBACK_HTML = """<!doctype html>
<html><head><title>ctxshrink dashboard</title></head>
<body><p>dashboard/index.html not found; showing raw metrics at
<a href="/api/metrics">/api/metrics</a></p></body></html>"""
