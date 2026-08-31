/**
 * Safety checks that gate every reduction.
 *
 * A reducer may produce output that is smaller yet wrong: it can drop a line
 * that carries an error, a secret, a TODO, or the one import the answer
 * depends on. Safety checks are applied to transformed output before it is
 * accepted. If any check fails, the caller must fall back to the original
 * text. Failing closed is the default, never a "best effort" claim that
 * silently loses data.
 */

// Lines that carry meaning an implementer must not drop. These are
// preserved at every level except when a reducer is explicitly told
// otherwise.
const MARKERS = [
  "TODO",
  "FIXME",
  "XXX",
  "HACK",
  "BUG",
  "WARNING",
  "DEPRECATED",
  "NOTE",
  "IMPORTANT",
  "SECURITY",
  "error",
  "Error",
  "ERROR",
  "exception",
  "Exception",
  "panic",
  "traceback",
  "Traceback",
  "password",
  "secret",
  "token",
  "api_key",
  "apiKey",
  "private_key",
];

// Narrower set for code bodies: only the shouty comment-tag convention
// (TODO, FIXME, ...). Bare words like "error", "token", or "exception" are
// ordinary code vocabulary (`throw new Error(...)`, `catch (error)`, a JWT
// `token` variable) and would make almost every real function "unsafe" to
// elide if treated as must-preserve markers.
const CODE_MARKERS = [
  "TODO",
  "FIXME",
  "XXX",
  "HACK",
  "BUG",
  "WARNING",
  "DEPRECATED",
  "NOTE",
  "IMPORTANT",
  "SECURITY",
];

class SafetyFailure {
  constructor(reason, rule) {
    this.reason = reason;
    this.rule = rule;
  }
}

class SafetyPolicy {
  constructor({
    requireSmaller = true,
    maxDropRatio = 0.9,
    preserveMarkers = true,
    maxOutputChars = null,
    markers = null,
  } = {}) {
    this.requireSmaller = requireSmaller;
    this.maxDropRatio = maxDropRatio;
    this.preserveMarkers = preserveMarkers;
    this.maxOutputChars = maxOutputChars;
    this.markers = markers;
  }

  asDict() {
    return {
      requireSmaller: this.requireSmaller,
      maxDropRatio: this.maxDropRatio,
      preserveMarkers: this.preserveMarkers,
      maxOutputChars: this.maxOutputChars,
      markers: this.markers ? [...this.markers] : null,
    };
  }
}

function markerLines(text, markers) {
  const set = new Set();
  for (const line of text.split("\n")) {
    if (markers.some((m) => line.includes(m))) set.add(line);
  }
  return set;
}

function checkSafety(original, transformed, policy = null) {
  policy = policy ?? new SafetyPolicy();
  const failures = [];

  if (policy.requireSmaller && transformed.length >= original.length) {
    failures.push(new SafetyFailure("output is not smaller than input", "size"));
  }
  if (policy.requireSmaller && !transformed && original) {
    failures.push(new SafetyFailure("output is empty", "size"));
  }

  if (policy.maxOutputChars !== null && transformed.length > policy.maxOutputChars) {
    failures.push(
      new SafetyFailure(
        `output exceeds maxOutputChars (${policy.maxOutputChars})`,
        "size"
      )
    );
  }

  if (original && policy.maxDropRatio !== null) {
    const remaining = transformed.length / original.length;
    if (remaining < 1.0 - policy.maxDropRatio) {
      failures.push(
        new SafetyFailure(
          `output drops more than ${Math.round(policy.maxDropRatio * 100)}% of input`,
          "drop_ratio"
        )
      );
    }
  }

  if (policy.preserveMarkers && original) {
    const activeMarkers = policy.markers ?? MARKERS;
    const originalMarkers = markerLines(original, activeMarkers);
    if (originalMarkers.size > 0) {
      const kept = markerLines(transformed, activeMarkers);
      const lost = [...originalMarkers].filter((line) => !kept.has(line)).sort();
      if (lost.length > 0) {
        failures.push(
          new SafetyFailure(`dropped marker line: ${lost[0].slice(0, 80)}`, "marker")
        );
      }
    }
  }

  return failures;
}

function isSafe(original, transformed, policy = null) {
  return checkSafety(original, transformed, policy).length === 0;
}

export { SafetyPolicy, SafetyFailure, checkSafety, isSafe, MARKERS, CODE_MARKERS };