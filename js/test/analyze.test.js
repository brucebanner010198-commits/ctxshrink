// Content-type detection tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, detectContentType } from "../src/analyze.js";

test("detects json", () => {
  assert.equal(detectContentType('{"a": 1, "b": [1, 2, 3]}'), "json");
});

test("detects diff", () => {
  const text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n";
  assert.equal(detectContentType(text), "diff");
});

test("detects log", () => {
  const text = "2024-01-01T10:00:00 INFO starting\n2024-01-01T10:00:01 ERROR failed\n";
  assert.equal(detectContentType(text), "log");
});

test("detects python code", () => {
  const text = "def foo(x, y):\n    return x + y\n\nclass Bar:\n    pass\n";
  assert.equal(detectContentType(text), "code");
});

test("detects plain text", () => {
  const text = "This is a plain English paragraph with no code or structured data at all.";
  assert.equal(detectContentType(text), "text");
});

test("empty text defaults to text", () => {
  assert.equal(detectContentType(""), "text");
  assert.equal(detectContentType("   \n  "), "text");
});

test("analyze reports marker and line counts", () => {
  const result = analyze("def foo(x):\n    # TODO fix this\n    return x\n");
  assert.equal(result.contentType, "code");
  assert.equal(result.lines, 4);
  assert.equal(result.markerLines, 1);
  assert.ok(result.tokensEstimate > 0);
});

test("analyze guesses python language", () => {
  const result = analyze("import os\n\ndef f():\n    pass\n");
  assert.equal(result.detectedLanguage, "python");
});