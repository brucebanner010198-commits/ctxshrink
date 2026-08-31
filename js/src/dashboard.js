/**
 * A tiny local dashboard for ctxshrink metrics.
 *
 * No framework, no external dependency: node:http serves a static
 * single-page app plus a JSON metrics endpoint. Point `metricsFile` at a
 * benchmark report (`ctxshrink benchmark --save report.json`) to view it, or
 * leave it unset to run a fresh benchmark against the bundled fixtures on
 * first load. Shares the same static assets (dashboard/index.html,
 * style.css, app.js) as the Python dashboard.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./benchmark.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(HERE, "..", "..", "dashboard");

function loadMetrics(metricsFile) {
  if (metricsFile && existsSync(metricsFile)) {
    return JSON.parse(readFileSync(metricsFile, "utf8"));
  }
  const report = runBenchmark();
  const { renderTable: _renderTable, ...plain } = report;
  void _renderTable;
  return plain;
}

function buildAppHtml() {
  const htmlPath = join(DASHBOARD_DIR, "index.html");
  if (existsSync(htmlPath)) return readFileSync(htmlPath, "utf8");
  return FALLBACK_HTML;
}

function serve({ host = "127.0.0.1", port = 8877, metricsFile = null, openBrowser = true } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      const body = Buffer.from(buildAppHtml(), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (path === "/api/metrics") {
      const body = Buffer.from(JSON.stringify(loadMetrics(metricsFile), null, 2), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    const staticPath = resolve(DASHBOARD_DIR, "." + path);
    if (
      existsSync(staticPath) &&
      staticPath.startsWith(resolve(DASHBOARD_DIR)) &&
      !staticPath.endsWith("/")
    ) {
      const ext = extname(staticPath);
      const contentType = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "text/plain";
      const body = readFileSync(staticPath);
      res.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    console.log(`ctxshrink dashboard: ${url} (Ctrl+C to stop)`);
    if (openBrowser) {
      const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      import("node:child_process").then(({ spawn }) => {
        try {
          spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
        } catch {
          // best effort only
        }
      });
    }
  });

  return server;
}

const FALLBACK_HTML = `<!doctype html>
<html><head><title>ctxshrink dashboard</title></head>
<body><p>dashboard/index.html not found; showing raw metrics at
<a href="/api/metrics">/api/metrics</a></p></body></html>`;

export { serve, buildAppHtml };