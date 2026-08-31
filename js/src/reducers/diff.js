/**
 * Diff reducer: keeps file/hunk headers and changed lines, collapses long
 * runs of unchanged context lines.
 *
 * A unified diff spends most of its bytes on context lines that did not
 * change. This reducer keeps every header (`diff --git`, `index`, `---`,
 * `+++`, `@@`), every added/removed line, and a small window of context
 * immediately around each change; longer context runs collapse to a
 * "... N unchanged lines ..." marker.
 */

import { LEVEL_CONSERVATIVE } from "../levels.js";
import { SafetyPolicy, checkSafety } from "../safety.js";

const HEADER_RE =
  /^(diff --git|index |--- |\+\+\+ |@@ |new file|deleted file|old mode|new mode|similarity index|rename (from|to))/;
const CHANGE_RE = /^[+-](?![+-]{2})/;

const DEFAULT_CONTEXT = 3;

function reduce(text, level = LEVEL_CONSERVATIVE, policy = null, context = DEFAULT_CONTEXT) {
  if (level < LEVEL_CONSERVATIVE || !text) return null;

  const lines = text.split("\n");
  const n = lines.length;
  const keep = new Array(n).fill(false);
  for (let idx = 0; idx < n; idx++) {
    const line = lines[idx];
    if (HEADER_RE.test(line) || CHANGE_RE.test(line)) {
      for (let j = Math.max(0, idx - context); j < Math.min(n, idx + context + 1); j++) {
        keep[j] = true;
      }
    }
  }

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
    out.push(`... ${i - start} unchanged lines ...`);
  }

  const result = out.join("\n");
  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.95 });
  if (checkSafety(text, result, effective).length > 0) return null;
  return result;
}

export { reduce };