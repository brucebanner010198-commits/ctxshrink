# ctxshrink

Shrink prompts and code context for AI coding assistants, without losing meaning.

ctxshrink counts tokens, detects content type, and applies deterministic,
fail-closed reductions to JSON, code, comments, logs, diffs, and verbose
prose. It ships as a Python package, a JavaScript package, and a matching CLI
for each, plus a local metrics dashboard and a benchmark runner. Every
reduction is checked against a safety policy before it is returned; if a
transform would drop something that matters (a `TODO`, an error line, a
security marker) or would not actually come out smaller, ctxshrink returns
the original text unchanged instead.

## Why

Feeding an AI coding assistant a full file, a full log, or a full JSON
payload burns tokens on things the model does not need: comment noise,
elided function bodies it could infer from the signature, and JSON
punctuation that repeats itself. ctxshrink targets that waste directly
instead of relying on the model to skim past it.

## What it does

- **Counts tokens.** A deterministic, dependency-free estimator (identical
  results in Python and JavaScript), or an exact BPE count when `tiktoken`
  (Python) or `js-tiktoken` (JavaScript) is installed.
- **Analyzes text.** Detects content type (JSON, code, diff, log, TOON,
  text), guesses the source language, and reports line/word/marker counts.
- **Reduces safely.** A reducer per content type: JSON array truncation with
  protected error/status subtrees, code body elision that keeps signatures
  and docstrings, comment noise removal, verbose-prose tightening, log
  collapse around errors and tracebacks, and diff context trimming.
- **Speaks TOON.** [TOON](#toon-format) is a lossless, line-oriented
  re-encoding of JSON: smaller than JSON for typical API responses and
  tables, and it decodes back to the exact same data.
- **Has levels and safety classes.** Four optimization levels (none,
  lossless, conservative, aggressive) and four safety classes (S1 reversible
  through S4 best-effort lossy) bound how much a reduction is allowed to
  change.
- **Reports savings.** A benchmark runner over a bundled fixture corpus and a
  local dashboard (no build step, no external service) show token counts and
  percent saved per file and per content type.

## Install

Python:

```bash
pip install -e ./python          # from a checkout
# or, once published:
pip install ctxshrink
```

JavaScript (zero required dependencies):

```bash
cd js && npm install             # installs nothing but dev tooling; the
                                  # package itself has no hard dependencies
# or, once published:
npm install ctxshrink
```

## Quick start

Python:

```python
from ctxshrink import compress, count_tokens, analyze

result = compress(open("service.py").read(), level=2)  # conservative
print(result.text)
print(result.original_tokens, "->", result.result_tokens,
      f"({result.savings_ratio:.0%} saved)")
```

JavaScript:

```js
import { compress } from "ctxshrink";

const result = compress(sourceText, 2); // conservative
console.log(result.text);
console.log(`${result.originalTokens} -> ${result.resultTokens}`,
            `(${(result.savingsRatio * 100).toFixed(0)}% saved)`);
```

## CLI

Both packages ship an equivalent CLI: `ctxshrink` (Python, installed via
`pip install`) and `node js/bin/ctxshrink.mjs` (or `ctxshrink` once installed
globally via npm).

```bash
# Count tokens
cat file.py | ctxshrink count

# Detect content type and print stats
cat file.py | ctxshrink analyze

# Reduce at a chosen level (0 none, 1 lossless, 2 conservative, 3 aggressive)
cat file.py | ctxshrink compress --level 2 --stats

# The TOON re-encoder, standalone
ctxshrink toon encode data.json
ctxshrink toon decode data.toon

# Reference for levels and safety classes
ctxshrink levels

# Run the bundled benchmark corpus
ctxshrink benchmark

# Serve the local metrics dashboard at http://127.0.0.1:8877
ctxshrink dashboard
```

The JavaScript CLI takes the same subcommands and flags:

```bash
cat file.py | node js/bin/ctxshrink.mjs compress --level 2 --stats
node js/bin/ctxshrink.mjs dashboard
```

## Optimization levels

| Level | Name | What it does |
|---|---|---|
| 0 | none | Passthrough. Nothing changes. |
| 1 | lossless | Reversible only: TOON re-encoding for JSON. |
| 2 | conservative | Adds code body elision (signatures and docstrings kept), comment noise removal, and diff context trimming. |
| 3 | aggressive | Adds prose tightening, log collapse around errors, and JSON array truncation. |

## Safety classes

| Class | Meaning |
|---|---|
| S1 | Reversible: decoding the result reproduces the exact original. |
| S2 | Structurally safe: syntax, keys, imports, and signatures stay intact. |
| S3 | Signal preserved: diagnostic and security marker lines are kept. |
| S4 | Best-effort lossy: meaning-carrying content is retained, not guaranteed byte-for-byte. |

Every reducer runs its output through a safety check before returning it:
the result must be strictly smaller, must not drop more than a configured
share of the input, and must not drop a line carrying a marker (`TODO`,
`FIXME`, `SECURITY`, an error message, and similar; a narrower marker set
applies inside code bodies so ordinary words like "error" or "token" do not
block eliding an unrelated function). Any failed check falls back to the
original text. See `ctxshrink.safety` / `js/src/safety.js`.

## TOON format

TOON re-encodes JSON as an indented, comma-delimited layout instead of
brace-and-quote-heavy JSON:

```json
{
  "hikes": [
    {"id": 1, "name": "Blue Lake", "distanceKm": 7.5, "sunny": true},
    {"id": 2, "name": "Ridge", "distanceKm": 9.2, "sunny": false}
  ],
  "friends": ["ana", "luis", "sam"]
}
```

becomes

```
friends[2]: ana,luis
hikes[2]{distanceKm,id,name,sunny}:
  7.5,1,Blue Lake,true
  9.2,2,Ridge,false
```

Object keys sort lexicographically, arrays of uniform objects become a
table (header row plus one line per record), scalar arrays become one
comma-joined line, and strings that could be confused with a number,
boolean, `null`, or a delimiter get JSON-quoted. Decoding a TOON document
reproduces the exact same JSON data; encoding fails closed (returns `null`)
for anything outside the supported subset, such as a JSON object key that
cannot be spelled in TOON's `[A-Za-z_][A-Za-z0-9_.-]*` key grammar.

The Python and JavaScript implementations are independently written from the
same specification and produce byte-identical output for the same input;
see `tests/python/test_toon.py` and `js/test/toon.test.js`.

## Dashboard

`ctxshrink dashboard` serves a small, dependency-free single-page app at
`http://127.0.0.1:8877` (default): a summary of tokens saved, a breakdown by
content type, and a per-file table. It reads either a saved benchmark report
(`--metrics-file report.json`, produced by `ctxshrink benchmark --save
report.json`) or runs a fresh benchmark against the bundled fixtures on
first load. No build step, no framework: a static HTML page plus a
`/api/metrics` JSON endpoint, served by the standard library in both
languages (`http.server` in Python, `node:http` in JavaScript).

## Benchmark

```bash
ctxshrink benchmark                       # print a savings table
ctxshrink benchmark --json                # machine-readable report
ctxshrink benchmark --save report.json    # write a report the dashboard can load
ctxshrink benchmark --fixtures ./my-fixtures --levels 2 3
```

The bundled fixtures under `benchmarks/fixtures/` are representative, not
exhaustive: a JSON API response, a unified diff, an application log with one
error burst, and Python/JavaScript source files. Numbers are local
`estimated` token counts (or exact, when a BPE backend is installed), never
a provider invoice.

## Docker

```bash
docker build -t ctxshrink:local .
docker run --rm -p 8877:8877 ctxshrink:local           # dashboard on :8877
docker run --rm -i ctxshrink:local compress --level 2 < file.py
docker run --rm -i ctxshrink:local js compress --level 2 < file.py
docker run --rm ctxshrink:local benchmark

# or, with docker compose
docker compose up dashboard                              # dashboard on :8877
docker compose run --rm benchmark
docker compose run --rm cli compress --level 2 < file.py
```

The image ships one Python and one Node interpreter over the shared source
tree; neither package needs a dependency install at runtime, so the image
has nothing to `pip install` or `npm install` beyond the standard library.
The entrypoint runs the Python CLI by default; prefix a command with `js` to
run the JavaScript CLI instead (`docker run ctxshrink:local js benchmark`).

## Project layout

```
python/ctxshrink/     Python package (pip install -e ./python)
js/                    JavaScript package (npm install, in js/)
dashboard/             Static dashboard assets shared by both CLIs
benchmarks/fixtures/   Sample files used by `ctxshrink benchmark`
tests/python/          pytest suite
js/test/                node:test suite
Dockerfile, docker-compose.yml, docker-entrypoint.sh
```

## Design notes

- **Deterministic, not model-based.** Every reduction is a fixed rule
  (regex substitution, brace/indent tracking, array truncation with a
  visible marker), not an LLM call. Given the same input, both packages
  produce the same output.
- **Fail closed.** A reducer that cannot prove its output is smaller, safe,
  and marker-preserving returns the original text. `compress()` never
  fabricates a "reduction" that is actually larger or that silently drops
  content.
- **Elision is visible.** Removed content leaves a marker behind: `...` for
  an elided Python function body, `// ...` for a brace-language one, `...N
  more` for a truncated JSON array, `... N lines omitted ...` for a
  collapsed log run. Nothing disappears without a trace.
- **Cross-language parity by construction.** The token estimator, the TOON
  codec, and the reducer heuristics are written twice from one
  specification, not generated from each other, and are checked against the
  same fixtures for identical output (see `benchmarks/fixtures/` and the two
  test suites).

## License

MIT.