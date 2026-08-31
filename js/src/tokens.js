/**
 * Token counting with a deterministic estimator and optional exact backends.
 *
 * `estimateTokens` is a fast, dependency-free heuristic calibrated so the
 * same input yields the identical integer in Python and JavaScript. It
 * counts CJK codepoints as one token each and every four remaining
 * characters as one token, rounded half up. Numbers labeled "estimated" are
 * not a provider invoice.
 *
 * `countTokens` uses a real BPE counter when the optional backend
 * (`js-tiktoken`) is installed and falls back to the estimator otherwise,
 * reporting which path it took.
 */

const CJK_RANGES = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x2eff], // CJK radicals
  [0x3000, 0x303f], // CJK punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3130, 0x318f], // Hangul compatibility
  [0x31f0, 0x31ff], // Katakana phonetic extensions
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa960, 0xa97f], // Hangul Jamo ext
  [0xac00, 0xd7af], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xffef], // halfwidth/fullwidth forms
  [0x20000, 0x2fa1f], // CJK ext B+
];

const MODEL_ENCODINGS = {
  o200k_base: "o200k_base",
  cl100k_base: "cl100k_base",
  "gpt-4": "cl100k_base",
  "gpt-4o": "o200k_base",
  "gpt-4.1": "o200k_base",
  auto: null,
};

function isCJK(cp) {
  for (const [lo, hi] of CJK_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  // Iterate by codepoint (not UTF-16 code unit) so astral-plane CJK
  // extensions count once, matching Python's `for ch in text`.
  for (const ch of text) {
    if (isCJK(ch.codePointAt(0))) cjk++;
  }
  const chars = Array.from(text).length;
  const rest = chars - cjk;
  return cjk + Math.floor((rest + 2) / 4);
}

let cachedTiktokenModule = null;
let triedLoadingTiktoken = false;

async function loadTiktoken() {
  if (triedLoadingTiktoken) return cachedTiktokenModule;
  triedLoadingTiktoken = true;
  try {
    cachedTiktokenModule = await import("js-tiktoken");
  } catch {
    cachedTiktokenModule = null;
  }
  return cachedTiktokenModule;
}

/**
 * Count tokens with an exact BPE backend when available, else estimate.
 * Async because the optional `js-tiktoken` backend loads lazily; use
 * `estimateTokens` directly for a synchronous, dependency-free count.
 */
async function countTokens(text, model = "auto") {
  const mod = await loadTiktoken();
  if (mod) {
    try {
      const encodingName = MODEL_ENCODINGS[model] || "o200k_base";
      const encoding = mod.getEncoding
        ? mod.getEncoding(encodingName)
        : mod.default.getEncoding(encodingName);
      const tokens = encoding.encode(text).length;
      return { tokens, chars: text.length, method: encodingName, exact: true };
    } catch {
      // fall through to estimate
    }
  }
  return {
    tokens: estimateTokens(text),
    chars: text.length,
    method: "estimate",
    exact: false,
  };
}

export { estimateTokens, countTokens, CJK_RANGES };