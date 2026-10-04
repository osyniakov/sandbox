"""Tolerant JSON-object extraction from LLM text responses."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(r"```[A-Za-z0-9_-]*[ \t]*\r?\n?(.*?)```", re.DOTALL)


def _first_object(text: str) -> Any:
    """Decode the first complete JSON value starting at the first '{'."""
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in response text")
    value, _ = json.JSONDecoder().raw_decode(text, start)
    return value


def parse_json_object(text: str) -> dict:
    """Parse ``text`` as a JSON object, tolerating code fences and prose.

    Order: strict ``json.loads`` on the stripped text; then the first
    markdown code fence; then the first complete object found from the
    first ``{``. Raises ``ValueError`` if nothing yields a dict.
    """
    stripped = text.strip()
    if not stripped:
        raise ValueError("empty response text")

    try:
        data: Any = json.loads(stripped)
    except ValueError:
        data = None
        found = False
        fence = _FENCE_RE.search(stripped)
        if fence is not None:
            try:
                data = json.loads(fence.group(1).strip())
                found = True
            except ValueError:
                pass
        if not found:
            try:
                data = _first_object(stripped)
            except ValueError as exc:
                raise ValueError(f"could not extract a JSON object: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"JSON was not an object (got {type(data).__name__})")
    return data
