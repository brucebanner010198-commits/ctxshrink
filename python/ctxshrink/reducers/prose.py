"""Prose reducer: trims verbose phrasing while keeping the claim it makes.

Deterministic phrase substitution, not paraphrase. Every rule replaces a
padded construction with its plain-English equivalent (filler removal, passive
throat-clearing, wordy connectives) so the transform is auditable line by line
and never invents or drops a claim. Meaning-bearing content is never removed;
only the words around it are trimmed.
"""

from __future__ import annotations

import re
from typing import Optional

from ..levels import LEVEL_AGGRESSIVE, LEVEL_CONSERVATIVE
from ..safety import SafetyPolicy, check_safety

__all__ = ["reduce", "PHRASE_RULES", "FILLER_SENTENCES"]

# (pattern, replacement) applied at LEVEL_CONSERVATIVE and above.
# Ordered longest-match-first so overlapping phrases resolve predictably.
PHRASE_RULES: tuple = (
    (r"\bin order to\b", "to"),
    (r"\bdue to the fact that\b", "because"),
    (r"\bowing to the fact that\b", "because"),
    (r"\bat this (?:point|moment) in time\b", "now"),
    (r"\bfor the purpose of\b", "to"),
    (r"\bin the event that\b", "if"),
    (r"\bin the case that\b", "if"),
    (r"\bwith regard to\b", "about"),
    (r"\bwith respect to\b", "about"),
    (r"\bin relation to\b", "about"),
    (r"\bis able to\b", "can"),
    (r"\bare able to\b", "can"),
    (r"\bwas able to\b", "could"),
    (r"\bwere able to\b", "could"),
    (r"\bthe majority of\b", "most"),
    (r"\ba (?:large|significant) number of\b", "many"),
    (r"\ba number of\b", "several"),
    (r"\beach and every\b", "each"),
    (r"\bwhether or not\b", "whether"),
    (r"\bin spite of the fact that\b", "although"),
    (r"\bdespite the fact that\b", "although"),
    (r"\bit is (?:important|worth noting) to (?:note|mention) that\b", ""),
    (r"\bit should be noted that\b", ""),
    (r"\bplease note that\b", "note:"),
    (r"\bplease be advised that\b", ""),
    (r"\bas a matter of fact\b", ""),
    (r"\bfor all intents and purposes\b", ""),
    (r"\bat the end of the day\b", ""),
    (r"\bneeds to be able to\b", "must"),
    (r"\bhas the ability to\b", "can"),
    (r"\bmake use of\b", "use"),
    (r"\butilize\b", "use"),
    (r"\butilization\b", "use"),
    (r"\bcommence\b", "start"),
    (r"\bterminate\b", "end"),
    (r"\bsubsequently\b", "then"),
    (r"\bprior to\b", "before"),
    (r"\bin the near future\b", "soon"),
    (r"\bon a regular basis\b", "regularly"),
    (r"\bin a timely manner\b", "promptly"),
    (r"\bvery unique\b", "unique"),
)

# Whole leading sentences/clauses that add no information; dropped if they
# start a sentence, kept if they are the entire content (avoid emptying text).
FILLER_SENTENCES: tuple = (
    r"^as (?:you|we) (?:can see|know),?\s*",
    r"^it goes without saying that\s*",
    r"^needless to say,?\s*",
    r"^generally speaking,?\s*",
    r"^basically,?\s*",
    r"^essentially,?\s*",
    r"^simply put,?\s*",
    r"^in summary,?\s*",
    r"^to summarize,?\s*",
    r"^in conclusion,?\s*",
)

_PHRASE_COMPILED = [(re.compile(p, re.IGNORECASE), r) for p, r in PHRASE_RULES]
_FILLER_COMPILED = [re.compile(p, re.IGNORECASE) for p in FILLER_SENTENCES]
_WHITESPACE_RUN_RE = re.compile(r"[ \t]{2,}")
_BLANK_RUN_RE = re.compile(r"\n{3,}")


def _apply_phrase_rules(text: str) -> str:
    out = text
    for pattern, replacement in _PHRASE_COMPILED:
        out = pattern.sub(replacement, out)
    return out


def _apply_filler_removal(text: str) -> str:
    lines = text.split("\n")
    result = []
    for line in lines:
        trimmed = line
        for pattern in _FILLER_COMPILED:
            candidate = pattern.sub("", trimmed)
            if candidate.strip():
                trimmed = candidate
        result.append(trimmed)
    return "\n".join(result)


def _tidy_whitespace(text: str) -> str:
    text = _WHITESPACE_RUN_RE.sub(" ", text)
    text = _BLANK_RUN_RE.sub("\n\n", text)
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines)


def reduce(
    text: str,
    level: int = LEVEL_CONSERVATIVE,
    policy: Optional[SafetyPolicy] = None,
) -> Optional[str]:
    if level < LEVEL_CONSERVATIVE or not text.strip():
        return None

    out = _apply_phrase_rules(text)
    if level >= LEVEL_AGGRESSIVE:
        out = _apply_filler_removal(out)
    out = _tidy_whitespace(out).strip("\n")

    if out == text or not out:
        return None

    policy = policy or SafetyPolicy(max_drop_ratio=0.5 if level < LEVEL_AGGRESSIVE else 0.7)
    if check_safety(text, out, policy):
        return None
    return out
