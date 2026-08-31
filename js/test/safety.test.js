// Safety-policy tests: the gate every reducer output must pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKERS, CODE_MARKERS, SafetyPolicy, checkSafety, isSafe } from "../src/safety.js";

test("smaller output with no markers is safe", () => {
  assert.ok(isSafe("a".repeat(100), "a".repeat(50)));
});

test("not smaller is unsafe", () => {
  const failures = checkSafety("short", "short but longer now");
  assert.ok(failures.some((f) => f.rule === "size"));
});

test("dropping a marker line is unsafe", () => {
  const original = "normal line\nTODO: fix this\nother line";
  const transformed = "normal line\nother";
  const failures = checkSafety(original, transformed);
  assert.ok(failures.some((f) => f.rule === "marker"));
});

test("keeping the marker line is safe", () => {
  const original = "aaaaaaaaaa\nTODO: fix this\nbbbbbbbbbb";
  const transformed = "TODO: fix this";
  assert.ok(isSafe(original, transformed));
});

test("max drop ratio rejects over-aggressive collapse", () => {
  const original = "x".repeat(1000);
  const transformed = "x";
  const policy = new SafetyPolicy({ maxDropRatio: 0.5 });
  const failures = checkSafety(original, transformed, policy);
  assert.ok(failures.some((f) => f.rule === "drop_ratio"));
});

test("preserveMarkers false allows dropping markers", () => {
  const original = "TODO: fix this\nbbbbbbbbbb";
  const transformed = "bbbbbbbbbb";
  const policy = new SafetyPolicy({ preserveMarkers: false });
  assert.ok(isSafe(original, transformed, policy));
});

test("code markers exclude common code vocabulary", () => {
  for (const word of ["error", "Error", "exception", "token", "secret", "password"]) {
    assert.ok(!CODE_MARKERS.includes(word));
  }
  assert.ok(MARKERS.includes("error") || MARKERS.includes("Error"));
});

test("code markers still include shouty tags", () => {
  for (const tag of ["TODO", "FIXME", "SECURITY"]) {
    assert.ok(CODE_MARKERS.includes(tag));
  }
});

test("custom markers override default set", () => {
  const original = "line one\nCUSTOM_TAG here\nline two";
  const transformed = "line one\nline two";
  assert.equal(checkSafety(original, transformed).length, 0);

  const customPolicy = new SafetyPolicy({ markers: ["CUSTOM_TAG"] });
  const customFailures = checkSafety(original, transformed, customPolicy);
  assert.ok(customFailures.some((f) => f.rule === "marker"));
});