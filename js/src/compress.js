/**
 * Orchestrator: detect, reduce, verify, and report.
 *
 * `compress()` is the single entry point most callers need. It detects
 * content type (or takes an explicit hint), routes to the TOON re-encoder
 * and/or the matching reducer chain for the chosen optimization level,
 * checks every candidate against the safety policy, and returns whichever
 * safe candidate saves the most estimated tokens. If nothing beats the
 * original, the original text comes back unchanged with `method: "none"`.
 */

import { detectContentType } from "./analyze.js";
import {
  LEVEL_AGGRESSIVE,
  LEVEL_CONSERVATIVE,
  LEVEL_LOSSLESS,
  LEVEL_NONE,
  levelName,
} from "./levels.js";
import * as codeReducer from "./reducers/code.js";
import * as commentsReducer from "./reducers/comments.js";
import * as diffReducer from "./reducers/diff.js";
import * as jsonReducer from "./reducers/json.js";
import * as logReducer from "./reducers/log.js";
import * as proseReducer from "./reducers/prose.js";
import { CODE_MARKERS, SafetyPolicy, checkSafety } from "./safety.js";
import { estimateTokens } from "./tokens.js";
import { toonDecode, toonEncode } from "./toon.js";

class CompressResult {
  constructor({ text, original, contentType, level, method, lossless, applied = [], notes = [] }) {
    this.text = text;
    this.original = original;
    this.contentType = contentType;
    this.level = level;
    this.method = method;
    this.lossless = lossless;
    this.applied = applied;
    this.notes = notes;
  }

  get originalTokens() {
    return estimateTokens(this.original);
  }

  get resultTokens() {
    return estimateTokens(this.text);
  }

  get originalChars() {
    return this.original.length;
  }

  get resultChars() {
    return this.text.length;
  }

  get savingsRatio() {
    const ot = this.originalTokens;
    if (ot === 0) return 0.0;
    return Math.max(0.0, 1.0 - this.resultTokens / ot);
  }

  get changed() {
    return this.text !== this.original;
  }

  asDict() {
    return {
      contentType: this.contentType,
      level: this.level,
      levelName: levelName(this.level),
      method: this.method,
      lossless: this.lossless,
      applied: [...this.applied],
      notes: [...this.notes],
      changed: this.changed,
      originalTokens: this.originalTokens,
      resultTokens: this.resultTokens,
      originalChars: this.originalChars,
      resultChars: this.resultChars,
      savingsRatio: Math.round(this.savingsRatio * 10000) / 10000,
    };
  }
}

function passthrough(text, contentType, level, note = "") {
  return new CompressResult({
    text,
    original: text,
    contentType,
    level,
    method: "none",
    lossless: true,
    applied: [],
    notes: note ? [note] : [],
  });
}

function candidateOk(original, candidate, policy) {
  if (candidate === null || candidate === original) return false;
  return checkSafety(original, candidate, policy).length === 0;
}

function best(candidates) {
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (estimateTokens(b[1]) < estimateTokens(a[1]) ? b : a));
}

function compressJson(text, level, policy) {
  const candidates = [];
  if (level >= LEVEL_LOSSLESS) {
    const toonOut = toonEncode(text);
    if (toonOut !== null && candidateOk(text, toonOut, policy)) {
      candidates.push(["toon", toonOut, true, ["toon"]]);
    }
  }
  if (level >= LEVEL_AGGRESSIVE) {
    const truncated = jsonReducer.reduce(text, level);
    if (truncated !== null && candidateOk(text, truncated, policy)) {
      candidates.push(["json-truncate", truncated, false, ["json"]]);
      const toonAfter = toonEncode(truncated);
      if (toonAfter !== null && candidateOk(text, toonAfter, policy)) {
        candidates.push(["json-truncate+toon", toonAfter, false, ["json", "toon"]]);
      }
    }
  }
  return candidates;
}

function compressCode(text, level, policy) {
  if (level < LEVEL_CONSERVATIVE) return [];
  const effective = policy ?? new SafetyPolicy({ maxDropRatio: 0.85, markers: CODE_MARKERS });
  const candidates = [];
  // Comments run first: code elision inserts its own "// ..." / "..."
  // placeholder, which a comments pass run afterward would mistake for a
  // noise comment.
  const step1 = commentsReducer.reduce(text, level);
  let applied = step1 !== null ? ["comments"] : [];
  let working = step1 ?? text;
  const step2 = codeReducer.reduce(working, level);
  if (step2 !== null) {
    working = step2;
    applied = [...applied, "code"];
  }
  if (applied.length && candidateOk(text, working, effective)) {
    candidates.push(["code", working, false, applied]);
  } else if (step1 !== null && candidateOk(text, step1, effective)) {
    candidates.push(["code", step1, false, ["comments"]]);
  }
  return candidates;
}

function compressSimple(reducerModule, method, text, level, policy) {
  const out = reducerModule.reduce(text, level);
  if (out !== null && candidateOk(text, out, policy)) {
    return [[method, out, false, [method]]];
  }
  return [];
}

/**
 * Reduce `text` at the requested optimization level.
 *
 * `level` follows levels.js (0 none .. 3 aggressive). `contentType`
 * overrides autodetection when the caller already knows the shape (`json`,
 * `code`, `diff`, `log`, `text`, `toon`).
 */
function compress(text, level = LEVEL_CONSERVATIVE, contentType = null, policy = null) {
  const ctype = contentType || detectContentType(text);

  if (level <= LEVEL_NONE || !text) {
    return passthrough(text, ctype, level);
  }

  let candidates;
  if (ctype === "json") {
    candidates = compressJson(text, level, policy);
  } else if (ctype === "code") {
    candidates = compressCode(text, level, policy);
  } else if (ctype === "diff") {
    candidates = compressSimple(diffReducer, "diff", text, level, policy);
  } else if (ctype === "log") {
    candidates = compressSimple(logReducer, "log", text, level, policy);
  } else if (ctype === "text") {
    candidates = compressSimple(proseReducer, "prose", text, level, policy);
  } else {
    candidates = [];
  }

  const winner = best(candidates);
  if (winner === null) {
    return passthrough(text, ctype, level, "no safe reduction found");
  }

  const [method, outText, lossless, applied] = winner;
  return new CompressResult({
    text: outText,
    original: text,
    contentType: ctype,
    level,
    method,
    lossless,
    applied,
    notes: [],
  });
}

/** Reverse a lossless transform. Only "toon" is currently reversible; lossy
 * methods have no inverse and return null. */
function decompress(text, method) {
  if (method === "toon") return toonDecode(text);
  return null;
}

export { compress, decompress, CompressResult };