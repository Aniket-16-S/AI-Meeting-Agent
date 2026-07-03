"""
app/utils/owner_parser.py
--------------------------
Resolves the raw owner string returned by the LLM into a structured list
of individual speaker identifiers.

Rules:
  - "Unassigned" / empty              → []
  - "All attendees" / "Everyone" / …  → all speakers from the meeting
  - "Presenters (Speaker A, Speaker B)" → ["Speaker A", "Speaker B"]
  - "Speaker A, Speaker B"            → ["Speaker A", "Speaker B"]
  - "Speaker A"                       → ["Speaker A"]
"""

import re
from typing import List

# Keywords that indicate the task is assigned to the whole group
_ALL_KEYWORDS = [
    "all attendees",
    "all participants",
    "all members",
    "everyone",
    "whole team",
    "entire team",
    "all team",
    "the group",
    "all",
]


def resolve_owners(owner_str: str, all_speakers: List[str]) -> List[str]:
    """
    Convert an LLM owner string into an ordered list of individual speaker labels.

    Args:
        owner_str:    The raw string returned by the LLM (e.g. "All attendees",
                      "Presenters (Speaker A, Speaker B)", "Speaker C").
        all_speakers: Every speaker identified in the meeting transcript.

    Returns:
        A deduplicated list of owner names. Returns an empty list when the task
        is unassigned.
    """
    if not owner_str:
        return []

    stripped = owner_str.strip()

    # Unassigned → nothing to store
    if stripped.lower() == "unassigned":
        return []

    lower = stripped.lower()

    # ── "All attendees" and synonyms ──────────────────────────────────────────
    if any(kw in lower for kw in _ALL_KEYWORDS):
        # If we have a speaker list use it, otherwise fall back to the raw string
        return list(all_speakers) if all_speakers else [stripped]

    # ── Parenthesised sub-list: "Presenters (Speaker A, Speaker B)" ──────────
    paren_match = re.search(r"\(([^)]+)\)", stripped)
    if paren_match:
        inner = paren_match.group(1)
        names = [n.strip() for n in inner.split(",") if n.strip()]
        return _deduplicate(names) if names else [stripped]

    # ── Comma-separated list without parens: "Speaker A, Speaker B" ──────────
    if "," in stripped:
        names = [n.strip() for n in stripped.split(",") if n.strip()]
        return _deduplicate(names)

    # ── Single owner ──────────────────────────────────────────────────────────
    return [stripped]


def _deduplicate(names: List[str]) -> List[str]:
    """Return names list with duplicates removed, preserving order."""
    seen = set()
    result = []
    for name in names:
        key = name.lower()
        if key not in seen:
            seen.add(key)
            result.append(name)
    return result
