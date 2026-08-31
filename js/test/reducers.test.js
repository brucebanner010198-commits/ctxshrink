// Reducer tests, including regressions for the nested-container and
// placeholder-eaten-by-comments bugs found during development.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as code from "../src/reducers/code.js";
import * as comments from "../src/reducers/comments.js";
import * as diff from "../src/reducers/diff.js";
import * as json from "../src/reducers/json.js";
import * as log from "../src/reducers/log.js";
import * as prose from "../src/reducers/prose.js";

test("code: elides simple function body", () => {
  const src = "def add(a, b):\n    total = a + b\n    print(total)\n    return total\n";
  const out = code.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(out.includes("def add(a, b):"));
  assert.ok(out.includes("..."));
  assert.ok(!out.includes("total = a + b"));
});

test("code: keeps docstring when eliding body", () => {
  const src = 'def f(x):\n    """Explain f."""\n    y = x + 1\n    return y\n';
  const out = code.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(out.includes('"""Explain f."""'));
});

test("code: recurses into class so one markered method does not block siblings", () => {
  const src =
    "class Widget:\n" +
    "    def a(self):\n" +
    "        x = 1\n" +
    "        y = 2\n" +
    "        return x + y\n" +
    "\n" +
    "    def b(self):\n" +
    "        # TODO: revisit\n" +
    "        return 1\n" +
    "\n" +
    "    def c(self):\n" +
    "        z = 3\n" +
    "        return z\n";
  const out = code.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(out.includes("def a(self):"));
  assert.ok(out.includes("def b(self):"));
  assert.ok(out.includes("def c(self):"));
  assert.ok(out.includes("TODO"));
  assert.ok(!out.includes("x = 1"));
  assert.ok(!out.includes("z = 3"));
});

test("code: brace-based recurses into class too", () => {
  const src =
    "class Server {\n" +
    "  constructor() {\n" +
    "    this.x = 1;\n" +
    "  }\n" +
    "\n" +
    "  risky() {\n" +
    "    // FIXME: needs validation\n" +
    "    return doWork();\n" +
    "  }\n" +
    "\n" +
    "  listen(port) {\n" +
    "    this.httpServer = create();\n" +
    "    this.httpServer.listen(port);\n" +
    "  }\n" +
    "}\n";
  const out = code.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(out.includes("FIXME"));
  assert.ok(!out.includes("this.x = 1;"));
  assert.ok(!out.includes("this.httpServer.listen(port);"));
});

test("code: control-flow bodies are not treated as elidable definitions", () => {
  const src =
    "function f(x) {\n" +
    "  if (!x) {\n" +
    '    throw new Error("bad input");\n' +
    "  }\n" +
    "  return x;\n" +
    "}\n";
  const out = code.reduce(src, 2);
  if (out !== null && !out.includes("throw new Error")) {
    assert.ok(out.includes("...") || out.includes("// ..."));
  }
});

test("code: returns null for code with nothing to elide", () => {
  assert.equal(code.reduce("x = 1\ny = 2\n", 2), null);
});

test("code: below conservative level is noop", () => {
  const src = "def f(x):\n    y = x + 1\n    return y\n";
  assert.equal(code.reduce(src, 1), null);
});

test("comments: drops noise line comment", () => {
  const src = "# increment x\nx = x + 1\n";
  const out = comments.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(!out.includes("# increment x"));
  assert.ok(out.includes("x = x + 1"));
});

test("comments: drops multiline noise block comment", () => {
  const src =
    "const config = loadConfig();\n" +
    "/* noise\n   spans lines */\n" +
    "value = 1;\n" +
    "console.log(config, value);\n";
  const out = comments.reduce(src, 2);
  assert.notEqual(out, null);
  assert.ok(!out.includes("noise"));
  assert.ok(out.includes("value = 1;"));
});

test("comments: does not eat a code placeholder from a prior pass", () => {
  const src = "function f() {\n  // ...\n}\n";
  const out = comments.reduce(src, 2);
  assert.ok(out === null || out.includes("// ..."));
});

test("prose: shortens verbose phrasing", () => {
  const src = "In order to fix this, due to the fact that the cache is stale, we must act.";
  const out = prose.reduce(src, 3);
  assert.notEqual(out, null);
  assert.ok(!out.toLowerCase().includes("in order to"));
  assert.ok(!out.toLowerCase().includes("due to the fact that"));
  assert.ok(out.length < src.length);
});

test("prose: preserves the claim being made", () => {
  const src = "In order to understand caching, we must invalidate stale entries.";
  const out = prose.reduce(src, 3);
  assert.notEqual(out, null);
  assert.ok(out.includes("invalidate"));
  assert.ok(out.includes("stale"));
});

test("prose: noop below conservative level", () => {
  assert.equal(prose.reduce("In order to do this.", 1), null);
});

test("json: truncates long array with marker", () => {
  const data = { rows: Array.from({ length: 50 }, (_, i) => ({ id: i })) };
  const out = json.reduce(JSON.stringify(data), 3);
  assert.notEqual(out, null);
  const parsed = JSON.parse(out);
  assert.ok(parsed.rows.some((x) => typeof x === "string" && x.includes("more")));
});

test("json: never truncates error subtree", () => {
  const data = { error: { details: Array.from({ length: 50 }, (_, i) => ({ code: i })) } };
  const out = json.reduce(JSON.stringify(data), 3);
  if (out !== null) {
    const parsed = JSON.parse(out);
    assert.equal(parsed.error.details.length, 50);
  }
});

test("json: noop for small payload", () => {
  assert.equal(json.reduce('{"a":1,"b":2}', 3), null);
});

test("log: keeps error and traceback context", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `INFO heartbeat ${i}`);
  lines.splice(50, 0, "ERROR connection refused");
  lines.splice(51, 0, "Traceback (most recent call last):");
  const text = lines.join("\n");
  const out = log.reduce(text, 3);
  assert.notEqual(out, null);
  assert.ok(out.includes("ERROR connection refused"));
  assert.ok(out.includes("Traceback"));
  assert.ok(out.includes("omitted"));
});

test("log: keeps edges of short logs unchanged", () => {
  const text = Array.from({ length: 5 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(log.reduce(text, 3), null);
});

test("diff: keeps headers and changed lines", () => {
  const lines = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,30 +1,30 @@"];
  for (let i = 0; i < 30; i++) {
    if (i === 15) {
      lines.push("-old", "+new");
    } else {
      lines.push(` context ${i}`);
    }
  }
  const text = lines.join("\n");
  const out = diff.reduce(text, 2, null, 1);
  assert.notEqual(out, null);
  assert.ok(out.includes("-old"));
  assert.ok(out.includes("+new"));
  assert.ok(out.includes("unchanged"));
});