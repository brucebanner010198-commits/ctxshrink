/**
 * Code reducer: elides function/method bodies, keeps everything a reader
 * needs to know the shape of the file -- imports, signatures, decorators,
 * docstrings, and marker lines -- while dropping implementation detail.
 *
 * Two strategies, chosen by a light heuristic on the source:
 *
 * - **Indent-based** (Python-like): a `def`/`class` header is kept, its
 *   immediate docstring is kept, and the rest of its indented body collapses
 *   to a single `    ...` line, unless the body contains a marker line.
 * - **Brace-based** (C-like): the signature line up to and including the
 *   opening `{` is kept, the balanced body collapses to `{ ... }`.
 *
 * Both strategies recurse into containers (a class body, or a function
 * holding nested functions) instead of treating the whole body as one
 * opaque blob, so a marker deep inside one method never blocks eliding its
 * unrelated siblings. Control-flow bodies (`if`/`for`/`while`/...) are never
 * treated as elidable definitions -- that is real behavior, not
 * implementation detail hidden behind a signature.
 */

import { LEVEL_CONSERVATIVE } from "../levels.js";
import { CODE_MARKERS, SafetyPolicy, checkSafety } from "../safety.js";

const PY_DEF_RE = /^(\s*)(async\s+def|def|class)\s/;
const CONTROL_FLOW_KEYWORDS = [
  "if", "else", "for", "while", "switch", "catch", "do", "with", "try", "finally",
];
const BRACE_DEF_HINT_RE = new RegExp(
  "^\\s*(export\\s+)?(default\\s+)?(async\\s+)?" +
    "(function\\b|class\\b|" +
    "(?!(?:" + CONTROL_FLOW_KEYWORDS.join("|") + ")\\b)" +
    "[A-Za-z_$][\\w$]*\\s*\\([^)]*\\)\\s*\\{?\\s*$|" +
    "(public|private|protected|static)\\b.*\\()"
);
const DOCSTRING_START_RE = /^\s*("""|''')/;
const DECORATOR_RE = /^\s*@\w/;

function hasMarker(line) {
  return CODE_MARKERS.some((m) => line.includes(m));
}

function countOccurrences(text, sub) {
  return text.split(sub).length - 1;
}

function looksIndentBased(text) {
  const defLine = new RegExp(PY_DEF_RE.source, "m");
  const defCount = countOccurrences(text, "def ") + countOccurrences(text, "class ");
  const braceCount = countOccurrences(text, "{");
  return defLine.test(text) && braceCount < defCount;
}

function indentOf(line) {
  return line.length - line.replace(/^ +/, "").length;
}

// -- indent-based (Python-like) ---------------------------------------------

function reduceIndentLines(lines) {
  const out = [];
  let i = 0;
  let changed = false;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    const m = PY_DEF_RE.exec(line);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }

    const headerIndent = m[1].length;
    out.push(line);
    i += 1;

    // Keep an immediately following docstring untouched.
    if (i < n && DOCSTRING_START_RE.test(lines[i])) {
      const quote = lines[i].trim().slice(0, 3);
      out.push(lines[i]);
      const singleLine = (lines[i].trim().split(quote).length - 1) >= 2;
      i += 1;
      if (!singleLine) {
        while (i < n && !lines[i].includes(quote)) {
          out.push(lines[i]);
          i += 1;
        }
        if (i < n) {
          out.push(lines[i]);
          i += 1;
        }
      }
    }

    const bodyStart = i;
    while (i < n && (lines[i].trim() === "" || indentOf(lines[i]) > headerIndent)) {
      i += 1;
    }
    const body = lines.slice(bodyStart, i);
    while (body.length && body[body.length - 1].trim() === "") body.pop();

    if (!body.length) continue;

    if (body.some((b) => PY_DEF_RE.test(b))) {
      // Container (class body, or a function holding nested defs): recurse
      // so each member is elided on its own merits.
      const nested = reduceIndentLines(body);
      out.push(...nested.lines);
      changed = changed || nested.changed;
      continue;
    }

    if (body.some(hasMarker)) {
      out.push(...body);
      continue;
    }

    out.push(" ".repeat(headerIndent + 4) + "...");
    changed = true;
  }

  return { lines: out, changed };
}

function reduceIndentBased(text) {
  const { lines: out, changed } = reduceIndentLines(text.split("\n"));
  if (!changed) return null;
  return out.join("\n");
}

// -- brace-based (C-like) -----------------------------------------------

function opensBlock(line) {
  return (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length > 0 &&
    BRACE_DEF_HINT_RE.test(line);
}

function reduceBraceLines(lines) {
  const out = [];
  let i = 0;
  const n = lines.length;
  let changed = false;

  while (i < n) {
    const line = lines[i];
    if (DECORATOR_RE.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth <= 0 || !BRACE_DEF_HINT_RE.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const headerIndent = indentOf(line);
    out.push(line);
    i += 1;
    const bodyStart = i;
    while (i < n && depth > 0) {
      depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      i += 1;
    }
    const bodyEnd = i - 1;
    if (bodyEnd < bodyStart) continue;
    const body = lines.slice(bodyStart, bodyEnd);

    if (!body.length) {
      out.push(lines[bodyEnd]);
      continue;
    }

    if (body.some(opensBlock)) {
      // Container: recurse so each member is elided on its own merits
      // instead of the whole container surviving or vanishing as one.
      const nested = reduceBraceLines(body);
      out.push(...nested.lines);
      out.push(lines[bodyEnd]);
      changed = changed || nested.changed;
      continue;
    }

    if (body.some(hasMarker)) {
      out.push(...body);
      out.push(lines[bodyEnd]);
      continue;
    }

    out.push(" ".repeat(headerIndent + 2) + "// ...");
    changed = true;
    out.push(lines[bodyEnd]);
  }

  return { lines: out, changed };
}

function reduceBraceBased(text) {
  const { lines: out, changed } = reduceBraceLines(text.split("\n"));
  if (!changed) return null;
  return out.join("\n");
}

function reduce(text, level = LEVEL_CONSERVATIVE, policy = null) {
  if (level < LEVEL_CONSERVATIVE || !text.trim()) return null;

  const result = looksIndentBased(text) ? reduceIndentBased(text) : reduceBraceBased(text);
  if (result === null || result === text) return null;

  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.85, markers: CODE_MARKERS });
  if (checkSafety(text, result, effective).length > 0) return null;
  return result;
}

export { reduce };