/**
 * JSON reducer: lossy array truncation for oversized, repetitive payloads.
 *
 * Complements toon.js, which is a lossless re-encoding. This reducer is for
 * the case TOON cannot help: a JSON array so large that even the compact
 * tabular form is still too big. It keeps object keys and structure, never
 * truncates a subtree reached through a key that looks like an error,
 * message, or status field, and truncates other long homogeneous arrays to
 * a head/tail sample with an explicit "...N more" marker so a reader knows
 * data was cut, not silently dropped.
 */

import { LEVEL_AGGRESSIVE } from "../levels.js";
import { SafetyPolicy, checkSafety } from "../safety.js";

const INTERESTING_KEY_RE = /error|exception|message|status|code|fail|warn/i;

const DEFAULT_HEAD = 3;
const DEFAULT_TAIL = 2;
const DEFAULT_ARRAY_THRESHOLD = 12;

function walk(value, head, tail, threshold, protectedFlag, changed) {
  if (Array.isArray(value)) {
    const walked = value.map((e) => walk(e, head, tail, threshold, protectedFlag, changed));
    if (protectedFlag || walked.length <= threshold) return walked;
    const keptHead = walked.slice(0, head);
    const keptTail = tail ? walked.slice(-tail) : [];
    const marker = `...${walked.length - head - tail} more`;
    changed.push(true);
    return [...keptHead, marker, ...keptTail];
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walk(v, head, tail, threshold, protectedFlag || INTERESTING_KEY_RE.test(k), changed);
    }
    return out;
  }
  return value;
}

function reduce(
  text,
  level = LEVEL_AGGRESSIVE,
  policy = null,
  head = DEFAULT_HEAD,
  tail = DEFAULT_TAIL,
  threshold = DEFAULT_ARRAY_THRESHOLD
) {
  if (level < LEVEL_AGGRESSIVE) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const changed = [];
  const result = walk(value, head, tail, threshold, false, changed);
  if (!changed.length) return null;

  const out = JSON.stringify(result);
  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.95, preserveMarkers: false });
  if (checkSafety(text, out, effective).length > 0) return null;
  return out;
}

export { reduce };