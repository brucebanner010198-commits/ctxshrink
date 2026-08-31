// Orchestrator tests: detection routing, level gating, and the
// never-worse-than-original safety guarantee.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compress, decompress } from "../src/compress.js";
import { LEVEL_AGGRESSIVE, LEVEL_CONSERVATIVE, LEVEL_LOSSLESS, LEVEL_NONE } from "../src/levels.js";

test("level none is always a passthrough", () => {
  const text = "def f(x):\n    return x + 1\n";
  const result = compress(text, LEVEL_NONE);
  assert.equal(result.text, text);
  assert.equal(result.method, "none");
  assert.equal(result.changed, false);
});

test("json uses toon at lossless level", () => {
  const data = JSON.stringify({
    rows: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `n${i}` })),
  });
  const result = compress(data, LEVEL_LOSSLESS);
  assert.equal(result.method, "toon");
  assert.equal(result.lossless, true);
  assert.ok(result.resultTokens < result.originalTokens);
});

test("toon round-trips through decompress", () => {
  const data = JSON.stringify({ a: 1, b: [1, 2, 3], c: { d: "e" } });
  const result = compress(data, LEVEL_LOSSLESS);
  if (result.method === "toon") {
    const back = decompress(result.text, result.method);
    assert.notEqual(back, null);
    assert.deepEqual(JSON.parse(back), JSON.parse(data));
  }
});

test("code reduction at conservative level", () => {
  const src =
    "import os\n\n\n" +
    "def compute(x, y):\n" +
    "    total = x + y\n" +
    "    scaled = total * 2\n" +
    "    return scaled\n";
  const result = compress(src, LEVEL_CONSERVATIVE, "code");
  assert.equal(result.contentType, "code");
  assert.ok(result.resultTokens <= result.originalTokens);
});

test("never returns something larger than the original", () => {
  const samples = [
    "def f(x):\n    return x\n",
    JSON.stringify({ a: [1, 2, 3] }),
    "plain english sentence with nothing to compress",
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n",
  ];
  for (const text of samples) {
    for (const level of [LEVEL_LOSSLESS, LEVEL_CONSERVATIVE, LEVEL_AGGRESSIVE]) {
      const result = compress(text, level);
      assert.ok(result.resultTokens <= result.originalTokens);
      assert.ok(result.text.length <= text.length || result.text === text);
    }
  }
});

test("unsafe reduction falls back to original", () => {
  const text = "TODO: fix this";
  const result = compress(text, LEVEL_AGGRESSIVE, "text");
  assert.equal(result.text, text);
});

test("asDict contains expected fields", () => {
  const result = compress("hello world", LEVEL_CONSERVATIVE, "text");
  const d = result.asDict();
  for (const key of [
    "contentType", "level", "levelName", "method", "lossless", "applied",
    "changed", "originalTokens", "resultTokens", "savingsRatio",
  ]) {
    assert.ok(key in d, `missing key ${key}`);
  }
});

test("content type override is respected", () => {
  const text = "some_var = 1";
  const result = compress(text, LEVEL_CONSERVATIVE, "text");
  assert.equal(result.contentType, "text");
});

test("empty text is a clean noop", () => {
  const result = compress("", LEVEL_AGGRESSIVE);
  assert.equal(result.text, "");
  assert.equal(result.method, "none");
});

test("decompress returns null for lossy methods", () => {
  assert.equal(decompress("anything", "prose"), null);
  assert.equal(decompress("anything", "code"), null);
});