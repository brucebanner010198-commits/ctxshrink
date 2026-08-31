/**
 * Optimization levels and safety classes for context reduction.
 *
 * Optimization levels select how aggressive the reducers may be. Losing
 * meaning is the failure mode, so every level is gated by a safety class
 * that bounds what a transform is allowed to drop.
 *
 * Levels (higher = smaller output, higher risk):
 *
 * - `LEVEL_NONE` (0) - passthrough, nothing changed.
 * - `LEVEL_LOSSLESS` (1) - reversible only (TOON, trailing whitespace).
 * - `LEVEL_CONSERVATIVE` (2) - preserves structure, signatures, markers.
 * - `LEVEL_AGGRESSIVE` (3) - prose rewrite, log collapse, array truncation.
 *
 * Safety classes describe what a transform preserves:
 *
 * - `S1` - reversible: decode yields the exact original.
 * - `S2` - structurally safe: syntax, keys, imports, signatures intact.
 * - `S3` - signal preserved: diagnostic/security markers kept.
 * - `S4` - best-effort lossy: meaning-carrying content retained, not
 *   guaranteed byte-for-byte.
 */

const LEVEL_NONE = 0;
const LEVEL_LOSSLESS = 1;
const LEVEL_CONSERVATIVE = 2;
const LEVEL_AGGRESSIVE = 3;

const LEVEL_NAMES = {
  [LEVEL_NONE]: "none",
  [LEVEL_LOSSLESS]: "lossless",
  [LEVEL_CONSERVATIVE]: "conservative",
  [LEVEL_AGGRESSIVE]: "aggressive",
};

const S1 = "S1";
const S2 = "S2";
const S3 = "S3";
const S4 = "S4";

const SAFETY_NAMES = {
  [S1]: "reversible",
  [S2]: "structurally safe",
  [S3]: "signal preserved",
  [S4]: "best-effort lossy",
};

function levelName(value) {
  return LEVEL_NAMES[value] ?? "unknown";
}

function safetyName(cls) {
  return SAFETY_NAMES[cls] ?? "unknown";
}

export {
  LEVEL_NONE,
  LEVEL_LOSSLESS,
  LEVEL_CONSERVATIVE,
  LEVEL_AGGRESSIVE,
  LEVEL_NAMES,
  S1,
  S2,
  S3,
  S4,
  SAFETY_NAMES,
  levelName,
  safetyName,
};