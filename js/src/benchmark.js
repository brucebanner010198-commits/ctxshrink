/**
 * Benchmark runner: applies compress() to a fixture corpus and reports
 * token savings per file, per content type, and overall.
 *
 * Fixtures live under benchmarks/fixtures/ at the repository root, resolved
 * relative to this module so it works from any working directory within a
 * checkout of this repository. Set CTXSHRINK_FIXTURES_DIR to point elsewhere
 * (a standalone `npm install ctxshrink` outside this repository has no
 * bundled fixtures and needs this, or an explicit `fixturesDir` argument to
 * runBenchmark). Each file is treated as one sample; its content type is
 * autodetected unless the filename encodes one via extension.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compress } from "./compress.js";
import { estimateTokens } from "./tokens.js";

const EXTENSION_HINTS = {
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
};

function defaultFixturesDir() {
  if (process.env.CTXSHRINK_FIXTURES_DIR) return process.env.CTXSHRINK_FIXTURES_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "benchmarks", "fixtures");
}

function guessType(path) {
  return EXTENSION_HINTS[extname(path).toLowerCase()];
}

function walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  let files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function summary(rows) {
  const byType = {};
  for (const row of rows) {
    const bucket = (byType[row.contentType] ??= {
      originalTokens: 0,
      resultTokens: 0,
      count: 0,
    });
    bucket.originalTokens += row.originalTokens;
    bucket.resultTokens += row.resultTokens;
    bucket.count += 1;
  }
  for (const bucket of Object.values(byType)) {
    bucket.savingsRatio = bucket.originalTokens
      ? Math.round((1.0 - bucket.resultTokens / bucket.originalTokens) * 10000) / 10000
      : 0.0;
  }

  const totalOriginal = rows.reduce((s, r) => s + r.originalTokens, 0);
  const totalResult = rows.reduce((s, r) => s + r.resultTokens, 0);
  const overall = totalOriginal
    ? Math.round((1.0 - totalResult / totalOriginal) * 10000) / 10000
    : 0.0;

  return {
    byContentType: byType,
    totalOriginalTokens: totalOriginal,
    totalResultTokens: totalResult,
    overallSavingsRatio: overall,
    fileCount: rows.length,
  };
}

function renderTable(report) {
  const lines = [];
  const header = [
    "file".padEnd(28), "type".padEnd(8), "lvl".padEnd(5), "method".padEnd(14),
    "orig_tok".padStart(10), "new_tok".padStart(10), "saved".padStart(8),
  ].join(" ");
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const row of report.rows) {
    lines.push(
      [
        row.name.slice(0, 28).padEnd(28),
        row.contentType.padEnd(8),
        String(row.level).padEnd(5),
        row.method.padEnd(14),
        String(row.originalTokens).padStart(10),
        String(row.resultTokens).padStart(10),
        (row.savingsRatio * 100).toFixed(1).padStart(7) + "%",
      ].join(" ")
    );
  }
  const s = report.summary;
  lines.push("-".repeat(header.length));
  lines.push(
    `TOTAL  ${s.fileCount} files, ${s.totalOriginalTokens} -> ${s.totalResultTokens} tokens, ` +
      `${(s.overallSavingsRatio * 100).toFixed(1)}% saved`
  );
  lines.push("");
  lines.push("By content type:");
  const entries = Object.entries(s.byContentType).sort(([a], [b]) => a.localeCompare(b));
  for (const [ctype, bucket] of entries) {
    lines.push(
      `  ${ctype.padEnd(8)} ${String(bucket.count).padStart(2)} files  ` +
        `${String(bucket.originalTokens).padStart(6)} -> ${String(bucket.resultTokens).padStart(6)} tokens  ` +
        `${(bucket.savingsRatio * 100).toFixed(1).padStart(6)}% saved`
    );
  }
  return lines.join("\n");
}

function runBenchmark({ fixturesDir = null, levels = [1, 2, 3], saveTo = null } = {}) {
  const directory = fixturesDir || defaultFixturesDir();
  const rows = [];

  for (const path of walkFiles(directory)) {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!text.trim()) continue;
    const hint = guessType(path);
    for (const level of levels) {
      const result = compress(text, level, hint);
      rows.push({
        name: relative(directory, path),
        contentType: result.contentType,
        level,
        method: result.method,
        originalTokens: estimateTokens(text),
        resultTokens: estimateTokens(result.text),
        originalChars: text.length,
        resultChars: result.text.length,
        savingsRatio: result.savingsRatio,
      });
    }
  }

  const report = {
    generatedAt: Date.now() / 1000,
    fixturesDir: directory,
    rows,
    summary: summary(rows),
  };

  if (saveTo) {
    writeFileSync(saveTo, JSON.stringify(report, null, 2));
  }
  return { ...report, renderTable: () => renderTable(report) };
}

export { runBenchmark, defaultFixturesDir };