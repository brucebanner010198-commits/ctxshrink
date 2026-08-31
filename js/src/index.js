/**
 * ctxshrink: shrink prompts and code context for AI coding assistants.
 *
 * Public API
 * ----------
 *
 * `countTokens(text)` / `estimateTokens(text)`
 *   Token counting, with an optional exact backend.
 * `analyze(text)`
 *   Content-type detection and text statistics.
 * `compress(text, level)`
 *   Detect, reduce, and safety-check in one call; returns a
 *   `CompressResult`.
 * `toonEncode(jsonText)` / `toonDecode(toonText)`
 *   The lossless TOON re-encoding, standalone.
 * `runBenchmark(...)`
 *   Run the bundled fixture corpus and report savings.
 *
 * Everything here is deterministic and local: no network calls, no model
 * inference. Reductions are conservative by default and fail closed to the
 * original text whenever a safety check does not pass.
 */

import { analyze, detectContentType, CONTENT_TYPES } from "./analyze.js";
import { compress, decompress, CompressResult } from "./compress.js";
import {
  LEVEL_AGGRESSIVE,
  LEVEL_CONSERVATIVE,
  LEVEL_LOSSLESS,
  LEVEL_NONE,
  S1,
  S2,
  S3,
  S4,
  levelName,
  safetyName,
} from "./levels.js";
import { MARKERS, CODE_MARKERS, SafetyFailure, SafetyPolicy, checkSafety, isSafe } from "./safety.js";
import { countTokens, estimateTokens } from "./tokens.js";
import { toonDecode, toonEncode } from "./toon.js";

const VERSION = "0.1.0";

export {
  VERSION,
  // tokens
  countTokens,
  estimateTokens,
  // analyze
  analyze,
  detectContentType,
  CONTENT_TYPES,
  // compress
  compress,
  decompress,
  CompressResult,
  // toon
  toonEncode,
  toonDecode,
  // levels
  LEVEL_NONE,
  LEVEL_LOSSLESS,
  LEVEL_CONSERVATIVE,
  LEVEL_AGGRESSIVE,
  levelName,
  S1,
  S2,
  S3,
  S4,
  safetyName,
  // safety
  SafetyPolicy,
  SafetyFailure,
  checkSafety,
  isSafe,
  MARKERS,
  CODE_MARKERS,
};