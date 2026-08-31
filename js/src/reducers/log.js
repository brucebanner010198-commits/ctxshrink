/**
 * Log reducer: keeps errors, stack traces, and the first/last lines; drops
 * repetitive INFO/DEBUG/progress noise in between.
 *
 * Rules:
 *
 * - Every line matching an error/warn/fatal/traceback signal is kept, plus
 *   a small window of lines immediately around it (context for the error).
 * - The first and last `edge` lines of the whole log are always kept
 *   (startup/shutdown context).
 * - Runs of dropped lines collapse to a single "... N lines omitted ..."
 *   marker so length changes are visible, never silent.
 */

import { LEVEL_AGGRESSIVE } from "../levels.js";
import { SafetyPolicy, checkSafety } from "../safety.js";

const ERROR_RE = /\b(ERROR|FATAL|CRITICAL|PANIC|Traceback|Exception|WARN(?:ING)?)\b/;
const STACK_FRAME_RE = /^\s*(at |File "|  File "|\s+in |\s+#\d+ )/;

const DEFAULT_EDGE = 8;
const DEFAULT_CONTEXT = 2;

function reduce(
  text,
  level = LEVEL_AGGRESSIVE,
  policy = null,
  edge = DEFAULT_EDGE,
  context = DEFAULT_CONTEXT
) {
  if (level < LEVEL_AGGRESSIVE || !text) return null;

  const lines = text.split("\n");
  const n = lines.length;
  if (n <= edge * 2) return null;

  const keep = new Array(n).fill(false);
  for (let idx = 0; idx < n; idx++) {
    const line = lines[idx];
    if (ERROR_RE.test(line) || STACK_FRAME_RE.test(line)) {
      for (let j = Math.max(0, idx - context); j < Math.min(n, idx + context + 1); j++) {
        keep[j] = true;
      }
    }
  }
  for (let idx = 0; idx < Math.min(edge, n); idx++) keep[idx] = true;
  for (let idx = Math.max(0, n - edge); idx < n; idx++) keep[idx] = true;

  if (keep.every(Boolean)) return null;

  const out = [];
  let i = 0;
  while (i < n) {
    if (keep[i]) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const start = i;
    while (i < n && !keep[i]) i += 1;
    out.push(`... ${i - start} lines omitted ...`);
  }

  const result = out.join("\n");
  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.97 });
  if (checkSafety(text, result, effective).length > 0) return null;
  return result;
}

export { reduce };