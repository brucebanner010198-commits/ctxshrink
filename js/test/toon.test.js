// TOON round-trip and fail-closed tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toonEncode, toonDecode } from "../src/toon.js";

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

function roundtripOk(originalJSON) {
  const encoded = toonEncode(originalJSON);
  if (encoded === null) return false;
  const decoded = toonDecode(encoded);
  if (decoded === null) return false;
  try {
    return canonical(JSON.parse(decoded)) === canonical(JSON.parse(originalJSON));
  } catch {
    return false;
  }
}

const ROUNDTRIP_CASES = [
  '{"hikes":[{"id":1,"name":"Blue Lake","distanceKm":7.5,"sunny":true},' +
    '{"id":2,"name":"Ridge","distanceKm":9.2,"sunny":false},' +
    '{"id":3,"name":"Loop","distanceKm":5.1,"sunny":true}],' +
    '"friends":["ana","luis","sam"],"meta":{"season":"spring_2025"}}',
  '{"values":["a,b","true","123",""," leading"]}',
  '[{"id":1,"ok":true},{"id":2,"ok":false}]',
  '{"nested":{"tags":["x","y"],"empty":{}}}',
  "42",
  '"hello"',
  '":"',
  "[1,2,3]",
  '{"name":"first","items":[]}',
  "[]",
  "{}",
  "null",
  "true",
  "false",
  "[true,false,null]",
  '{"a":1,"b":[{"x":"v1","y":2},{"x":"v2","y":3}]}',
  '{"quoted-looking":"true","numeric-looking":"123","has_space":"a b"}',
  '{"unicode":"caf\\u00e9"}',
  "[1.5,2.25,-3,0,-0.0,1e3,1.2e-4]",
];

test("toon round-trip", () => {
  for (const original of ROUNDTRIP_CASES) {
    assert.ok(roundtripOk(original), `round-trip failed for ${original}`);
  }
});

test("encode produces tabular header for uniform object arrays", () => {
  const data = JSON.stringify({
    hikes: [
      { id: 1, name: "a", distanceKm: 1.0, sunny: true },
      { id: 2, name: "b", distanceKm: 2.0, sunny: false },
    ],
  });
  const out = toonEncode(data);
  assert.notEqual(out, null);
  assert.ok(out.includes("hikes[2]{distanceKm,id,name,sunny}:"));
});

test("encode is smaller than JSON for tabular data", () => {
  const data = JSON.stringify({
    rows: Array.from({ length: 20 }, (_, i) => ({ id: i, name: `item${i}` })),
  });
  const out = toonEncode(data);
  assert.notEqual(out, null);
  assert.ok(out.length < data.length);
});

test("encode keys are sorted", () => {
  const out = toonEncode('{"zebra":1,"apple":2,"mango":3}');
  assert.notEqual(out, null);
  assert.ok(out.indexOf("apple") < out.indexOf("mango"));
  assert.ok(out.indexOf("mango") < out.indexOf("zebra"));
});

test("decode rejects impossible row count", () => {
  assert.equal(toonDecode("rows[1000000000]{id}:\n  1"), null);
});

test("decode rejects duplicate tabular keys", () => {
  assert.equal(toonDecode("rows[1]{id,id}:\n  1,2"), null);
});

test("decode rejects duplicate object keys", () => {
  assert.equal(toonDecode("name: first\nname: second"), null);
});

test("encode rejects duplicate JSON keys", () => {
  for (const bad of ['{"id":0,"id":""}', '{"rows":[{"id":0,"id":""}]}', '{"outer":{"id":0,"id":""}}']) {
    assert.equal(toonEncode(bad), null);
  }
});

test("encode rejects NaN and Infinity", () => {
  assert.equal(toonEncode("NaN"), null);
  assert.equal(toonEncode("Infinity"), null);
  assert.equal(toonEncode('{"x": NaN}'), null);
});

test("decode rejects malformed indentation", () => {
  assert.equal(toonDecode("name: value\n foo: bar"), null); // odd indent (1 space)
});

test("decode rejects blank lines", () => {
  assert.equal(toonDecode("name: value\n\nother: value"), null);
});

test("encode invalid JSON returns null", () => {
  assert.equal(toonEncode("{not valid json"), null);
});

test("decode invalid TOON returns null", () => {
  assert.equal(toonDecode(""), null);
  assert.equal(toonDecode("   "), null);
});

test("string needing quotes round-trips", () => {
  const values = [
    "true", "false", "null", "123", "-5", "1.5e10", "", " leading", "trailing ",
    "a,b", "a:b", 'has"quote', "[bracket", "{brace", "-dash",
  ];
  for (const value of values) {
    const original = JSON.stringify({ v: value });
    assert.ok(roundtripOk(original), `failed for ${JSON.stringify(value)}`);
  }
});

test("plain string stays unquoted", () => {
  const out = toonEncode('{"name":"hello world"}');
  assert.notEqual(out, null);
  assert.ok(out.includes("name: hello world\n"));
});

test("encode fails closed on keys it cannot represent", () => {
  for (const badKeyJSON of ['{"has space": 1}', '{"has:colon": 1}', '{"1leading": 1}', '{"": 1}']) {
    assert.equal(toonEncode(badKeyJSON), null);
  }
});