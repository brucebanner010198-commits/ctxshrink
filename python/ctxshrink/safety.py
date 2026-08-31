"""Safety checks that gate every reduction.

A reducer may produce output that is smaller yet wrong: it can drop a line that
caries an error, a secret, a TODO, or the one import the answer depends on.
Safety checks are applied to transformed output before it is accepted. If any
check fails, the caller must fall back to the original text. Failing closed is
the default, never a "best effort" claim that silently loses data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

__all__ = [
    "SafetyPolicy",
    "check_safety",
    "SafetyFailure",
    "MARKERS",
    "CODE_MARKERS",
]

# Lines that carry meaning an implementer must not drop. These are preserved at
# every level except when a reducer is explicitly told otherwise.
MARKERS = (
    "TODO",
    "FIXME",
    "XXX",
    "HACK",
    "BUG",
    "WARNING",
    "DEPRECATED",
    "NOTE",
    "IMPORTANT",
    "SECURITY",
    "error",
    "Error",
    "ERROR",
    "exception",
    "Exception",
    "panic",
    "traceback",
    "Traceback",
    "password",
    "secret",
    "token",
    "api_key",
    "apiKey",
    "private_key",
)

# Narrower set for code bodies: only the shouty comment-tag convention
# (TODO, FIXME, ...). Bare words like "error", "token", or "exception" are
# ordinary code vocabulary (`throw new Error(...)`, `catch (error)`, a JWT
# `token` variable) and would make almost every real function "unsafe" to
# elide if treated as must-preserve markers.
CODE_MARKERS = (
    "TODO",
    "FIXME",
    "XXX",
    "HACK",
    "BUG",
    "WARNING",
    "DEPRECATED",
    "NOTE",
    "IMPORTANT",
    "SECURITY",
)


@dataclass(frozen=True)
class SafetyFailure:
    reason: str
    rule: str


@dataclass
class SafetyPolicy:
    """Bounds a transform. ``max_drop_ratio`` is the largest share of input
    characters a transform may remove in one step (guards over-aggressive
    collapse); ``require_smaller`` forces a strict size improvement;
    ``preserve_markers`` keeps marker lines; and ``markers`` overrides which
    marker set to preserve (defaults to :data:`MARKERS`)."""  # noqa: D205

    require_smaller: bool = True
    max_drop_ratio: float = 0.90
    preserve_markers: bool = True
    max_output_chars: Optional[int] = None
    markers: Optional[tuple] = None

    def as_dict(self) -> dict:
        return {
            "require_smaller": self.require_smaller,
            "max_drop_ratio": self.max_drop_ratio,
            "preserve_markers": self.preserve_markers,
            "max_output_chars": self.max_output_chars,
            "markers": list(self.markers) if self.markers else None,
        }


def _marker_lines(text: str, markers: tuple = MARKERS) -> set:
    return {line for line in text.splitlines() if any(m in line for m in markers)}


def check_safety(
    original: str,
    transformed: str,
    policy: Optional[SafetyPolicy] = None,
) -> list[SafetyFailure]:
    """Return the list of failures; empty list means the transform is accepted."""
    policy = policy or SafetyPolicy()
    failures: list[SafetyFailure] = []

    if policy.require_smaller and len(transformed) >= len(original):
        failures.append(
            SafetyFailure("output is not smaller than input", "size")
        )
    if policy.require_smaller and not transformed and original:
        failures.append(SafetyFailure("output is empty", "size"))

    if policy.max_output_chars is not None and len(transformed) > policy.max_output_chars:
        failures.append(
            SafetyFailure(
                "output exceeds max_output_chars (%d)" % policy.max_output_chars,
                "size",
            )
        )

    if original and policy.max_drop_ratio is not None:
        remaining = len(transformed) / len(original)
        if remaining < (1.0 - policy.max_drop_ratio):
            failures.append(
                SafetyFailure(
                    "output drops more than %.0f%% of input" % (policy.max_drop_ratio * 100),
                    "drop_ratio",
                )
            )

    if policy.preserve_markers and original:
        active_markers = policy.markers or MARKERS
        original_markers = _marker_lines(original, active_markers)
        if original_markers:
            kept = _marker_lines(transformed, active_markers)
            lost = original_markers - kept
            if lost:
                preview = next(iter(sorted(lost)))[:80]
                failures.append(
                    SafetyFailure(
                        "dropped marker line: %s" % preview,
                        "marker",
                    )
                )

    return failures


def is_safe(
    original: str,
    transformed: str,
    policy: Optional[SafetyPolicy] = None,
) -> bool:
    return not check_safety(original, transformed, policy)
