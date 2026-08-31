/**
 * Reducers: deterministic, fail-closed transforms per content type.
 *
 * Each reducer module exports a `reduce(text, level, policy) -> string |
 * null` function. It returns the transformed text, or null if the reducer
 * has nothing safe to do (the caller then keeps the original). Reducers
 * never throw on malformed input; they return null instead.
 */

import * as code from "./code.js";
import * as comments from "./comments.js";
import * as diff from "./diff.js";
import * as json from "./json.js";
import * as log from "./log.js";
import * as prose from "./prose.js";

// contentType -> ordered list of reducer modules tried at that content type.
const REGISTRY = {
  code: [code, comments],
  text: [prose],
  json: [json],
  log: [log],
  diff: [diff],
};

export { code, comments, diff, json, log, prose, REGISTRY };