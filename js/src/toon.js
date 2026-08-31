/**
 * TOON: a lossless, line-oriented re-encoding of JSON.
 *
 * TOON (the "TOON" compact text format) turns standard JSON into a smaller
 * key: value / table layout that a model reads with fewer tokens, and that
 * can be decoded back to the exact same JSON data. It is lossless: the
 * decode of an encode equals the encode of the decode for any JSON in the
 * supported subset.
 *
 * The format is deliberately minimal.
 *
 * - Object keys sort lexicographically.
 * - Scalars: `key: value`.
 * - Empty object: `key: {}`, empty array: `key[0]: []`.
 * - Scalar array: `key[N]: a,b,c`.
 * - Tabular array (array of objects with identical scalar keys):
 *   `key[N]{field1,field2}:` followed by N comma-joined rows at indent + 1.
 * - Root scalar / array / object start at indent 0.
 *
 * Strings that could be confused with a number, boolean, null, a delimiter,
 * or leading/trailing whitespace are JSON-quoted; all other strings are
 * bare.
 *
 * `toonEncode` returns null for input that falls outside the supported,
 * proven-round-trip subset. Callers must pass the original bytes through
 * unchanged in that case (fail closed, never emit a transform that loses
 * data). This mirrors python/ctxshrink/toon.py line for line so both
 * packages produce byte-identical TOON text for the same JSON input.
 */

const SAFE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const JSON_NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

// A JSON number whose lexical form is preserved (no float coercion).
class TNum {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

function isSafeKey(key) {
  return SAFE_KEY_RE.test(key);
}

function indentStr(level) {
  return "  ".repeat(level);
}

// --------------------------------------------------------------------------
// A hand-rolled JSON parser: native JSON.parse cannot preserve a number's
// lexical form (7.50 -> 7.5) or reject duplicate object keys, both required
// for a faithful TOON encode.
// --------------------------------------------------------------------------

class JSONParseError extends Error {}

class ToonJSONParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  error(msg) {
    throw new JSONParseError(msg + " at position " + this.pos);
  }

  skipWs() {
    while (this.pos < this.text.length && " \t\n\r".includes(this.text[this.pos])) {
      this.pos++;
    }
  }

  parseDocument() {
    this.skipWs();
    const value = this.parseValue();
    this.skipWs();
    if (this.pos !== this.text.length) {
      this.error("trailing data");
    }
    return value;
  }

  parseValue() {
    this.skipWs();
    if (this.pos >= this.text.length) this.error("unexpected end of input");
    const ch = this.text[this.pos];
    if (ch === "{") return this.parseObject();
    if (ch === "[") return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber();
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.text.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    this.error("unexpected token");
    return undefined;
  }

  parseObject() {
    this.pos++; // {
    const obj = {};
    const seen = new Set();
    this.skipWs();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return obj;
    }
    for (;;) {
      this.skipWs();
      if (this.text[this.pos] !== '"') this.error("expected object key");
      const key = this.parseString();
      if (seen.has(key)) this.error("duplicate object key: " + key);
      seen.add(key);
      this.skipWs();
      if (this.text[this.pos] !== ":") this.error("expected ':'");
      this.pos++;
      this.skipWs();
      obj[key] = this.parseValue();
      this.skipWs();
      const ch = this.text[this.pos];
      if (ch === ",") {
        this.pos++;
        continue;
      }
      if (ch === "}") {
        this.pos++;
        break;
      }
      this.error("expected ',' or '}'");
    }
    return obj;
  }

  parseArray() {
    this.pos++; // [
    const arr = [];
    this.skipWs();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return arr;
    }
    for (;;) {
      this.skipWs();
      arr.push(this.parseValue());
      this.skipWs();
      const ch = this.text[this.pos];
      if (ch === ",") {
        this.pos++;
        continue;
      }
      if (ch === "]") {
        this.pos++;
        break;
      }
      this.error("expected ',' or ']'");
    }
    return arr;
  }

  parseString() {
    const start = this.pos;
    this.pos++; // opening quote
    let sawUnescaped = false;
    while (true) {
      if (this.pos >= this.text.length) this.error("unterminated string");
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos++;
        break;
      }
      if (ch === "\\") {
        this.pos += 2;
        sawUnescaped = true;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) this.error("control character in string");
      this.pos++;
    }
    const raw = this.text.slice(start, this.pos);
    try {
      return JSON.parse(raw);
    } catch {
      void sawUnescaped;
      this.error("invalid string literal");
      return undefined;
    }
  }

  parseNumber() {
    const start = this.pos;
    if (this.text[this.pos] === "-") this.pos++;
    if (this.text[this.pos] === "0") {
      this.pos++;
    } else if (this.text[this.pos] >= "1" && this.text[this.pos] <= "9") {
      while (this.pos < this.text.length && this.text[this.pos] >= "0" && this.text[this.pos] <= "9") {
        this.pos++;
      }
    } else {
      this.error("invalid number");
    }
    if (this.text[this.pos] === ".") {
      this.pos++;
      if (!(this.text[this.pos] >= "0" && this.text[this.pos] <= "9")) this.error("invalid number");
      while (this.pos < this.text.length && this.text[this.pos] >= "0" && this.text[this.pos] <= "9") {
        this.pos++;
      }
    }
    if (this.text[this.pos] === "e" || this.text[this.pos] === "E") {
      this.pos++;
      if (this.text[this.pos] === "+" || this.text[this.pos] === "-") this.pos++;
      if (!(this.text[this.pos] >= "0" && this.text[this.pos] <= "9")) this.error("invalid number");
      while (this.pos < this.text.length && this.text[this.pos] >= "0" && this.text[this.pos] <= "9") {
        this.pos++;
      }
    }
    return new TNum(this.text.slice(start, this.pos));
  }
}

function parseJSONForTOON(text) {
  try {
    const parser = new ToonJSONParser(text);
    return { ok: true, value: parser.parseDocument() };
  } catch {
    return { ok: false, value: undefined };
  }
}

// --------------------------------------------------------------------------
// Encode
// --------------------------------------------------------------------------

function toonEncode(text, delimiter = ",") {
  const parsed = parseJSONForTOON(text);
  if (!parsed.ok) return null;
  const out = [];
  const ok = writeValue(out, parsed.value, "", 0, delimiter);
  if (!ok) return null;
  return out.join("");
}

function sortKeys(obj) {
  return Object.keys(obj).sort();
}

function writeValue(out, value, name, indent, delimiter) {
  if (isPlainObject(value)) {
    if (name === "") {
      if (Object.keys(value).length === 0) {
        out.push("{}\n");
        return true;
      }
      return writeObject(out, value, indent, delimiter);
    }
    if (!isSafeKey(name)) return false;
    if (Object.keys(value).length === 0) {
      out.push(indentStr(indent) + name + ": {}\n");
      return true;
    }
    out.push(indentStr(indent) + name + ":\n");
    return writeObject(out, value, indent + 1, delimiter);
  }
  if (Array.isArray(value)) {
    return writeArray(out, value, name, indent, delimiter);
  }
  const encoded = encodeScalar(value, delimiter);
  if (encoded === null) return false;
  out.push(indentStr(indent));
  if (name === "") {
    out.push(encoded + "\n");
  } else {
    if (!isSafeKey(name)) return false;
    out.push(name + ": " + encoded + "\n");
  }
  return true;
}

function writeObject(out, obj, indent, delimiter) {
  for (const key of sortKeys(obj)) {
    if (!isSafeKey(key)) return false;
    if (!writeValue(out, obj[key], key, indent, delimiter)) return false;
  }
  return true;
}

function writeArray(out, arr, name, indent, delimiter) {
  if (name !== "" && !isSafeKey(name)) return false;
  if (arr.length === 0) {
    out.push(indentStr(indent));
    out.push(name === "" ? "[]\n" : name + "[0]: []\n");
    return true;
  }
  if (isScalarArray(arr)) {
    const cells = [];
    for (const elem of arr) {
      const cell = encodeScalar(elem, delimiter);
      if (cell === null) return false;
      cells.push(cell);
    }
    out.push(indentStr(indent));
    if (name === "") {
      out.push("[" + arr.length + "]: " + cells.join(delimiter) + "\n");
    } else {
      out.push(name + "[" + arr.length + "]: " + cells.join(delimiter) + "\n");
    }
    return true;
  }
  const tabular = tabularRows(arr, delimiter);
  if (tabular === null) return false;
  const { fields, rows } = tabular;
  for (const field of fields) {
    if (!isSafeKey(field)) return false;
  }
  out.push(indentStr(indent));
  const header = "[" + rows.length + "]{" + fields.join(",") + "}:\n";
  out.push(name === "" ? header : name + header);
  for (const row of rows) {
    out.push(indentStr(indent + 1) + row.join(delimiter) + "\n");
  }
  return true;
}

function isScalarArray(arr) {
  return arr.every(isScalar);
}

function isScalar(v) {
  return v === null || typeof v === "boolean" || v instanceof TNum || typeof v === "string";
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof TNum);
}

function tabularRows(arr, delimiter) {
  if (arr.length === 0 || !isPlainObject(arr[0]) || Object.keys(arr[0]).length === 0) {
    return null;
  }
  const fields = sortKeys(arr[0]);
  for (const f of fields) {
    if (!isScalar(arr[0][f])) return null;
  }
  const rows = [];
  for (const item of arr) {
    if (!isPlainObject(item)) return null;
    const itemKeys = sortKeys(item);
    if (itemKeys.length !== fields.length || !itemKeys.every((k, idx) => k === fields[idx])) {
      return null;
    }
    const row = [];
    for (const field of fields) {
      const cell = encodeScalar(item[field], delimiter);
      if (cell === null) return null;
      row.push(cell);
    }
    rows.push(row);
  }
  return { fields, rows };
}

function encodeScalar(v, delimiter) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof TNum) {
    return validJSONNumber(v.text) ? v.text : null;
  }
  if (typeof v === "string") {
    if (needsQuote(v, delimiter)) {
      try {
        return JSON.stringify(v);
      } catch {
        return null;
      }
    }
    return v;
  }
  return null;
}

function needsQuote(s, delimiter) {
  if (s === "" || s.trim() !== s) return true;
  if (/[\n\r\t]/.test(s)) return true;
  if (s.includes('"') || s.includes(":") || s.includes(delimiter)) return true;
  if ('[{"-'.includes(s[0])) return true;
  if (s[0] >= "0" && s[0] <= "9") return true;
  if (s === "true" || s === "false" || s === "null") return true;
  return validJSONNumber(s);
}

function validJSONNumber(s) {
  return JSON_NUMBER_RE.test(s);
}

// --------------------------------------------------------------------------
// Decode: TOON text back to JSON text.
// --------------------------------------------------------------------------

const TABULAR_LINE_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)?\[(\d+)\]\{([^}]*)\}:$/;
const ARRAY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)?\[(\d+)\]:(?: (.*))?$/;
const KEY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_.-]*):(?: (.*))?$/;

function toonDecode(text) {
  const scan = scanLines(text);
  if (!scan.ok || scan.lines.length === 0) return null;
  if (scan.lines[0].indent !== 0) return null;
  const result = parseRoot(scan.lines, 0);
  if (!result.ok || result.next !== scan.lines.length) return null;
  return toJSONText(result.value);
}

function scanLines(text) {
  const stripped = text.replace(/\n+$/, "");
  if (stripped.trim() === "") return { ok: false, lines: [] };
  const raw = stripped.split("\n");
  const lines = [];
  for (const line of raw) {
    if (line.trim() === "") return { ok: false, lines: [] };
    let spaces = 0;
    while (spaces < line.length && line[spaces] === " ") spaces++;
    if (spaces % 2 !== 0) return { ok: false, lines: [] };
    lines.push({ indent: spaces / 2, text: line.slice(spaces) });
  }
  return { ok: true, lines };
}

function parseRoot(lines, i) {
  const text = lines[i].text;
  if (text === "{}") return { ok: true, value: {}, next: i + 1 };
  if (text === "[]") return { ok: true, value: [], next: i + 1 };
  if (text.startsWith('"')) {
    const s = parseScalar(text);
    return s.ok ? { ok: true, value: s.value, next: i + 1 } : { ok: false, next: i };
  }
  if (text.startsWith("[")) return parseArray(lines, i, 0);
  if (!text.includes(":")) {
    const s = parseScalar(text);
    return s.ok ? { ok: true, value: s.value, next: i + 1 } : { ok: false, next: i };
  }
  return parseObject(lines, i, 0);
}

function parseObject(lines, i, indent) {
  const out = {};
  while (i < lines.length) {
    if (lines[i].indent < indent) break;
    if (lines[i].indent > indent) return { ok: false, next: i };
    const text = lines[i].text;

    let m = TABULAR_LINE_RE.exec(text);
    if (m && m[1]) {
      const key = m[1];
      if (Object.prototype.hasOwnProperty.call(out, key)) return { ok: false, next: i };
      const r = parseArray(lines, i, indent);
      if (!r.ok) return { ok: false, next: i };
      out[key] = r.value;
      i = r.next;
      continue;
    }

    m = ARRAY_LINE_RE.exec(text);
    if (m && m[1]) {
      const key = m[1];
      if (Object.prototype.hasOwnProperty.call(out, key)) return { ok: false, next: i };
      const r = parseArray(lines, i, indent);
      if (!r.ok) return { ok: false, next: i };
      out[key] = r.value;
      i = r.next;
      continue;
    }

    m = KEY_LINE_RE.exec(text);
    if (!m || !m[1]) return { ok: false, next: i };
    const key = m[1];
    const rest = m[2] ?? "";
    if (Object.prototype.hasOwnProperty.call(out, key)) return { ok: false, next: i };

    if (rest === "{}") {
      out[key] = {};
      i += 1;
      continue;
    }
    if (rest === "") {
      if (i + 1 >= lines.length || lines[i + 1].indent !== indent + 1) return { ok: false, next: i };
      const r = parseObject(lines, i + 1, indent + 1);
      if (!r.ok) return { ok: false, next: i };
      out[key] = r.value;
      i = r.next;
      continue;
    }
    const val = parseScalar(rest);
    if (!val.ok) return { ok: false, next: i };
    out[key] = val.value;
    i += 1;
  }
  return { ok: true, value: out, next: i };
}

function parseArray(lines, i, indent) {
  const text = lines[i].text;
  let m = TABULAR_LINE_RE.exec(text);
  if (m) {
    const n = parseInt(m[2], 10);
    const fields = splitFields(m[3]);
    if (!fields || fields.length === 0) return { ok: false, next: i };
    if (n > lines.length - i - 1) return { ok: false, next: i };
    const out = [];
    i += 1;
    for (let row = 0; row < n; row++) {
      if (i >= lines.length || lines[i].indent !== indent + 1) return { ok: false, next: i };
      const cells = splitCells(lines[i].text, ",");
      if (!cells.ok || cells.value.length !== fields.length) return { ok: false, next: i };
      const obj = {};
      for (let c = 0; c < fields.length; c++) {
        const val = parseScalar(cells.value[c]);
        if (!val.ok) return { ok: false, next: i };
        obj[fields[c]] = val.value;
      }
      out.push(obj);
      i += 1;
    }
    return { ok: true, value: out, next: i };
  }
  m = ARRAY_LINE_RE.exec(text);
  if (!m) return { ok: false, next: i };
  const n = parseInt(m[2], 10);
  const rest = m[3] ?? "";
  if (n === 0) {
    if (rest !== "[]") return { ok: false, next: i };
    return { ok: true, value: [], next: i + 1 };
  }
  const cells = splitCells(rest, ",");
  if (!cells.ok || cells.value.length !== n) return { ok: false, next: i };
  const out = [];
  for (const cell of cells.value) {
    const val = parseScalar(cell);
    if (!val.ok) return { ok: false, next: i };
    out.push(val.value);
  }
  return { ok: true, value: out, next: i + 1 };
}

function splitFields(s) {
  if (s === "") return null;
  const parts = s.split(",");
  const seen = new Set();
  for (const p of parts) {
    if (!isSafeKey(p)) return null;
    if (seen.has(p)) return null;
    seen.add(p);
  }
  return parts;
}

function splitCells(s, delimiter) {
  const out = [];
  let buf = "";
  let inQuote = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (inQuote && ch === "\\") {
      buf += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      buf += ch;
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && ch === delimiter) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (inQuote || escaped) return { ok: false, value: [] };
  out.push(buf);
  return { ok: true, value: out };
}

function parseScalar(s) {
  if (s === "") return { ok: false, value: undefined };
  if (s.startsWith('"')) {
    try {
      const v = JSON.parse(s);
      if (typeof v !== "string") return { ok: false, value: undefined };
      return { ok: true, value: v };
    } catch {
      return { ok: false, value: undefined };
    }
  }
  if (s === "true") return { ok: true, value: true };
  if (s === "false") return { ok: true, value: false };
  if (s === "null") return { ok: true, value: null };
  if (validJSONNumber(s)) return { ok: true, value: new TNum(s) };
  if (/[\n\r\t]/.test(s)) return { ok: false, value: undefined };
  if (s.trim() !== s) return { ok: false, value: undefined };
  return { ok: true, value: s };
}

function toJSONText(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (value instanceof TNum) return value.text;
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(toJSONText).join(",") + "]";
  }
  if (isPlainObject(value)) {
    const keys = sortKeys(value);
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + toJSONText(value[k])).join(",") + "}";
  }
  throw new TypeError("unsupported value in TOON decode");
}

export { toonEncode, toonDecode, isSafeKey };