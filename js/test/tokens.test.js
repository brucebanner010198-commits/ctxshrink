// Token estimation tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, countTokens } from "../src/tokens.js";

test("empty string is zero tokens", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimate is deterministic", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  assert.equal(estimateTokens(text), estimateTokens(text));
});

test("estimate scales roughly with length", () => {
  const short = "hello world";
  const long = short.repeat(20);
  assert.ok(estimateTokens(long) > estimateTokens(short));
});

test("estimate counts CJK more densely than ASCII", () => {
  const asciiText = "a".repeat(12);
  const cjkText = "\u4f60\u597d".repeat(6); // 12 CJK characters
  assert.ok(estimateTokens(cjkText) > estimateTokens(asciiText));
});

test("estimate never negative", () => {
  for (const text of ["", " ", "\n\n\n", "x", "a".repeat(1000)]) {
    assert.ok(estimateTokens(text) >= 0);
  }
});

test("count tokens falls back to estimate without backend", async () => {
  const result = await countTokens("hello world", "auto");
  assert.ok(result.tokens >= 0);
  assert.ok(["estimate", "o200k_base", "cl100k_base"].includes(result.method));
  assert.equal(typeof result.exact, "boolean");
});

test("count tokens reports char length", async () => {
  const result = await countTokens("hello");
  assert.equal(result.chars, 5);
});