/**
 * Content-type detection and text analysis.
 *
 * `detectContentType` sniffs the shape of a blob of text so the compressor
 * can route it to a matching reducer. Detection is heuristic and cheap: no
 * external parsers, just structural signals that are reliable in practice.
 *
 * `analyze` returns a stats snapshot (length, tokens, lines, detected type,
 * signal counts) used by the CLI, the dashboard, and the benchmark
 * reporter.
 */

import { estimateTokens } from "./tokens.js";
import { MARKERS } from "./safety.js";

const CONTENT_TYPES = ["json", "diff", "log", "code", "toon", "text"];

const DIFF_HEADER_RE = /^(diff --git|index [0-9a-f]|--- |\+\+\+ |@@ )/;
const LOG_LEVEL_RE = /\b(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|TRACE)\b/;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\[\d{2}:\d{2}:\d{2}\]/;
const CODE_SIGNAL_RE =
  /^\s*(import |from |package |func |def |class |function |const |let |var |public |private |protected |#include|use strict|export )/;
const CODE_PUNCT_RE = /[{};()=<>]/g;
const TOON_ROW_RE = /^[A-Za-z_][A-Za-z0-9_.-]*\[\d+\](\{[^}]*\})?:/;

function looksLikeJSON(stripped) {
  try {
    JSON.parse(stripped);
    return true;
  } catch {
    return false;
  }
}

function detectContentType(text) {
  const stripped = text.trim();
  if (!stripped) return "text";

  if ((stripped[0] === "{" || stripped[0] === "[") && looksLikeJSON(stripped)) {
    return "json";
  }

  const lines = stripped.split("\n");
  const sample = lines.slice(0, 60);

  if (sample.some((line) => DIFF_HEADER_RE.test(line))) return "diff";

  const toonRows = sample.filter((line) => TOON_ROW_RE.test(line.replace(/^\s+/, ""))).length;
  if (toonRows && toonRows / Math.max(1, sample.length) > 0.15) return "toon";

  const logHits = sample.filter(
    (line) => LOG_LEVEL_RE.test(line) || TIMESTAMP_RE.test(line)
  ).length;
  if (logHits / Math.max(1, sample.length) > 0.25) return "log";

  const codeHits = sample.filter((line) => CODE_SIGNAL_RE.test(line)).length;
  const punctHits = sample.reduce(
    (sum, line) => sum + (line.match(CODE_PUNCT_RE) || []).length,
    0
  );
  if (codeHits >= 1 || punctHits / Math.max(1, sample.length) > 3) return "code";

  return "text";
}

const LANGUAGE_HINTS = [
  [/^\s*def \w+\(.*\):/, "python"],
  [/^\s*(import|from) \w/, "python"],
  [/^\s*func \w+\(/, "go"],
  [/^\s*package \w+/, "go"],
  [/^\s*fn \w+\(/, "rust"],
  [/^\s*(pub |impl |use )/, "rust"],
  [/^\s*(export )?(function|const|let|var)\b/, "javascript"],
  [/^\s*(public|private|protected)\s+(class|static|void)/, "java"],
  [/^\s*#include/, "c"],
];

function guessLanguage(text) {
  for (const line of text.split("\n").slice(0, 80)) {
    for (const [pattern, lang] of LANGUAGE_HINTS) {
      if (pattern.test(line)) return lang;
    }
  }
  return null;
}

function analyze(text, contentType = null) {
  const ctype = contentType || detectContentType(text);
  const lines = text ? text.split("\n") : [];
  const words = text.match(/\S+/g) || [];
  const blank = lines.filter((line) => line.trim() === "").length;
  const markers = lines.filter((line) => MARKERS.some((m) => line.includes(m))).length;

  const signals = {
    avgLineLength: lines.length
      ? lines.reduce((sum, line) => sum + line.length, 0) / lines.length
      : 0.0,
    maxLineLength: lines.length ? Math.max(...lines.map((line) => line.length)) : 0,
  };

  return {
    contentType: ctype,
    chars: Array.from(text).length,
    lines: lines.length,
    words: words.length,
    tokensEstimate: estimateTokens(text),
    blankLines: blank,
    markerLines: markers,
    detectedLanguage: ctype === "code" ? guessLanguage(text) : null,
    signals,
  };
}

export { detectContentType, analyze, CONTENT_TYPES };