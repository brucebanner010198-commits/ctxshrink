/**
 * Comment reducer: drops noise comments, keeps meaning-carrying ones.
 *
 * Kept unconditionally: docstrings (Python triple-quoted, JSDoc `/** *\/`
 * blocks), shebang lines, license/copyright headers, and any comment
 * containing a marker keyword (TODO, FIXME, SECURITY, and friends from
 * safety.js). Everything else that is a standalone comment line is dropped;
 * comments trailing on a code line are left alone because they usually
 * disambiguate the line they sit on.
 */

import { LEVEL_CONSERVATIVE } from "../levels.js";
import { MARKERS, SafetyPolicy, checkSafety } from "../safety.js";

const LINE_COMMENT_RE = /^\s*(#|\/\/)(?!!)(?!\/)\s?(.*)$/;
const SHEBANG_RE = /^#!/;
const LICENSE_HINT_RE = /copyright|license|spdx|all rights reserved/i;
const DOC_COMMENT_START_RE = /^\s*\/\*\*/;
const BLOCK_COMMENT_START_RE = /^\s*\/\*/;
const BLOCK_COMMENT_END_RE = /\*\/\s*$/;
const TRIPLE_QUOTE_RE = /^\s*("""|''')/;

function hasMarker(line) {
  return MARKERS.some((m) => line.includes(m));
}

function isNoiseLineComment(line) {
  const m = LINE_COMMENT_RE.exec(line);
  if (!m) return false;
  if (SHEBANG_RE.test(line)) return false;
  const body = m[2];
  if (body.trim() === "...") {
    // The code reducer's own elision placeholder. A caller may run comments
    // after code (this module makes no assumption about pipeline order), so
    // this must never be mistaken for a noise comment.
    return false;
  }
  if (hasMarker(line) || LICENSE_HINT_RE.test(body)) return false;
  return true;
}

function reduce(text, level = LEVEL_CONSERVATIVE, policy = null) {
  if (level < LEVEL_CONSERVATIVE || !text) return null;

  const lines = text.split("\n");
  const out = [];
  let inJsdocBlock = false;
  let inDroppedBlock = false;
  let inTripleQuote = false;
  let changed = false;

  for (const line of lines) {
    if (inTripleQuote) {
      out.push(line);
      if (TRIPLE_QUOTE_RE.test(line)) {
        inTripleQuote = false;
      }
      continue;
    }
    const tripleMatch = TRIPLE_QUOTE_RE.exec(line);
    if (tripleMatch) {
      out.push(line);
      const stripped = line.trim();
      const quote = stripped.slice(0, 3);
      const count = stripped.split(quote).length - 1;
      if (count < 2) inTripleQuote = true;
      continue;
    }
    if (inJsdocBlock) {
      out.push(line);
      if (BLOCK_COMMENT_END_RE.test(line)) inJsdocBlock = false;
      continue;
    }
    if (inDroppedBlock) {
      changed = true;
      if (BLOCK_COMMENT_END_RE.test(line)) inDroppedBlock = false;
      continue;
    }
    if (DOC_COMMENT_START_RE.test(line)) {
      out.push(line);
      if (!BLOCK_COMMENT_END_RE.test(line)) inJsdocBlock = true;
      continue;
    }
    if (BLOCK_COMMENT_START_RE.test(line) && !hasMarker(line)) {
      changed = true;
      if (!BLOCK_COMMENT_END_RE.test(line)) inDroppedBlock = true;
      continue;
    }
    if (isNoiseLineComment(line)) {
      changed = true;
      continue;
    }
    out.push(line);
  }

  if (!changed) return null;

  const result = out.join("\n");
  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.6 });
  if (checkSafety(text, result, effective).length > 0) return null;
  return result;
}

export { reduce };