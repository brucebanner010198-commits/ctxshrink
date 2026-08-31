/**
 * Prose reducer: trims verbose phrasing while keeping the claim it makes.
 *
 * Deterministic phrase substitution, not paraphrase. Every rule replaces a
 * padded construction with its plain-English equivalent (filler removal,
 * passive throat-clearing, wordy connectives) so the transform is auditable
 * line by line and never invents or drops a claim. Meaning-bearing content
 * is never removed; only the words around it are trimmed.
 */

import { LEVEL_AGGRESSIVE, LEVEL_CONSERVATIVE } from "../levels.js";
import { SafetyPolicy, checkSafety } from "../safety.js";

// [pattern, replacement] applied at LEVEL_CONSERVATIVE and above. Ordered
// longest-match-first so overlapping phrases resolve predictably.
const PHRASE_RULES = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bowing to the fact that\b/gi, "because"],
  [/\bat this (?:point|moment) in time\b/gi, "now"],
  [/\bfor the purpose of\b/gi, "to"],
  [/\bin the event that\b/gi, "if"],
  [/\bin the case that\b/gi, "if"],
  [/\bwith regard to\b/gi, "about"],
  [/\bwith respect to\b/gi, "about"],
  [/\bin relation to\b/gi, "about"],
  [/\bis able to\b/gi, "can"],
  [/\bare able to\b/gi, "can"],
  [/\bwas able to\b/gi, "could"],
  [/\bwere able to\b/gi, "could"],
  [/\bthe majority of\b/gi, "most"],
  [/\ba (?:large|significant) number of\b/gi, "many"],
  [/\ba number of\b/gi, "several"],
  [/\beach and every\b/gi, "each"],
  [/\bwhether or not\b/gi, "whether"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bdespite the fact that\b/gi, "although"],
  [/\bit is (?:important|worth noting) to (?:note|mention) that\b/gi, ""],
  [/\bit should be noted that\b/gi, ""],
  [/\bplease note that\b/gi, "note:"],
  [/\bplease be advised that\b/gi, ""],
  [/\bas a matter of fact\b/gi, ""],
  [/\bfor all intents and purposes\b/gi, ""],
  [/\bat the end of the day\b/gi, ""],
  [/\bneeds to be able to\b/gi, "must"],
  [/\bhas the ability to\b/gi, "can"],
  [/\bmake use of\b/gi, "use"],
  [/\butilize\b/gi, "use"],
  [/\butilization\b/gi, "use"],
  [/\bcommence\b/gi, "start"],
  [/\bterminate\b/gi, "end"],
  [/\bsubsequently\b/gi, "then"],
  [/\bprior to\b/gi, "before"],
  [/\bin the near future\b/gi, "soon"],
  [/\bon a regular basis\b/gi, "regularly"],
  [/\bin a timely manner\b/gi, "promptly"],
  [/\bvery unique\b/gi, "unique"],
];

// Whole leading sentences/clauses that add no information; dropped if they
// start a sentence, kept if they are the entire content (avoid emptying
// text).
const FILLER_SENTENCES = [
  /^as (?:you|we) (?:can see|know),?\s*/i,
  /^it goes without saying that\s*/i,
  /^needless to say,?\s*/i,
  /^generally speaking,?\s*/i,
  /^basically,?\s*/i,
  /^essentially,?\s*/i,
  /^simply put,?\s*/i,
  /^in summary,?\s*/i,
  /^to summarize,?\s*/i,
  /^in conclusion,?\s*/i,
];

const WHITESPACE_RUN_RE = /[ \t]{2,}/g;
const BLANK_RUN_RE = /\n{3,}/g;

function applyPhraseRules(text) {
  let out = text;
  for (const [pattern, replacement] of PHRASE_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function applyFillerRemoval(text) {
  return text
    .split("\n")
    .map((line) => {
      let trimmed = line;
      for (const pattern of FILLER_SENTENCES) {
        const candidate = trimmed.replace(pattern, "");
        if (candidate.trim()) trimmed = candidate;
      }
      return trimmed;
    })
    .join("\n");
}

function tidyWhitespace(text) {
  text = text.replace(WHITESPACE_RUN_RE, " ");
  text = text.replace(BLANK_RUN_RE, "\n\n");
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

function reduce(text, level = LEVEL_CONSERVATIVE, policy = null) {
  if (level < LEVEL_CONSERVATIVE || !text.trim()) return null;

  let out = applyPhraseRules(text);
  if (level >= LEVEL_AGGRESSIVE) out = applyFillerRemoval(out);
  out = tidyWhitespace(out).replace(/\n+$/, "");

  if (out === text || !out) return null;

  const effective =
    policy ?? new SafetyPolicy({ maxDropRatio: level < LEVEL_AGGRESSIVE ? 0.5 : 0.7 });
  if (checkSafety(text, out, effective).length > 0) return null;
  return out;
}

export { reduce, PHRASE_RULES, FILLER_SENTENCES };