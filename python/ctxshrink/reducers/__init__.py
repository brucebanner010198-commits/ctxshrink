"""Reducers: deterministic, fail-closed transforms per content type.

Each reducer module exports a ``reduce(text, level, policy) -> Optional[str]``
function. It returns the transformed text, or ``None`` if the reducer has
nothing safe to do (the caller then keeps the original). Reducers never raise
on malformed input; they return ``None`` instead.
"""

from __future__ import annotations

from . import code, comments, diff, json_, log, prose

__all__ = ["code", "comments", "diff", "json_", "log", "prose", "REGISTRY"]

# content_type -> ordered list of reducer modules tried at that content type.
REGISTRY = {
    "code": (code, comments),
    "text": (prose,),
    "json": (json_,),
    "log": (log,),
    "diff": (diff,),
}