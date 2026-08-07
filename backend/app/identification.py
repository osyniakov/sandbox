"""Vision-based item identification service.

Sends an :class:`~app.models.Item`'s photo to a vision-capable LLM and
turns the response into the structured fields needed to advance the item
to the next stage of the pipeline (searching Kleinanzeigen for comparable
listings).

This module is a *service*, not an HTTP endpoint -- wiring it into a
FastAPI route (and deciding when/how DB sessions get committed) is the
job of the pipeline-orchestration bead. Callers are expected to pass in
an already-loaded ``Item`` ORM instance, call
``ItemIdentificationService().identify_item(item)``, and then persist the
(mutated in place) item themselves (e.g. ``session.commit()``).

Provider abstraction
---------------------
The actual LLM call is isolated behind the ``IdentificationProvider``
protocol (``identify(photo_path) -> dict``). ``ClaudeVisionProvider`` is
the default concrete implementation, using Anthropic's Messages API
(image content blocks). Swapping to a different vision provider later
only requires implementing a new ``IdentificationProvider`` -- the
``ItemIdentificationService`` orchestration logic (parsing, fallbacks,
status transitions) does not change.

Failure vs. ambiguity convention
---------------------------------
Two very different situations can happen when we ask the vision model
about a photo, and this module treats them differently on purpose:

1. **The call itself failed** (network error, timeout, non-2xx response,
   response that isn't valid/parseable JSON, etc.). This is a
   *transient/infrastructure* problem. A provider signals this by
   raising :class:`IdentificationError` (or any other exception) out of
   ``identify()``. The service catches it, logs it, and leaves
   ``Item.status`` at ``pending_identification`` so the item is retried
   later. No exception propagates out of
   ``ItemIdentificationService.identify_item``.

2. **The call succeeded, but the model itself wasn't confident** (e.g. a
   blurry photo, or a pile of indistinguishable junk). The provider still
   returns a well-formed dict -- it just signals uncertainty *within*
   that dict, via either (a) an empty/missing ``name`` field, or (b) a
   ``confidence`` field set to a low-confidence marker such as ``"low"``,
   ``"unsure"``, ``"uncertain"``, ``"unclear"``, or ``"none"``
   (case-insensitive). This is *not* an error: the service treats it as
   a successful identification with a best-effort fallback name (
   ``"unidentified item"``) and non-empty, generically-useful search
   keywords, and still advances ``Item.status`` to ``pending_search`` --
   downstream steps need *something* to search with, and "no idea what
   this is" is itself actionable information rather than a reason to
   halt the pipeline.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from app.models import Item, ItemStatus

logger = logging.getLogger(__name__)

# Best-effort fallback values used when the vision model can't produce a
# confident/non-empty name. See "Failure vs. ambiguity convention" above.
FALLBACK_NAME = "unidentified item"
FALLBACK_KEYWORDS = ["unidentified item", "household item", "used item"]

# Confidence markers (case-insensitive) that a provider may set on its
# response dict to signal "I responded, but I'm not sure about this."
_LOW_CONFIDENCE_MARKERS = {"low", "unsure", "uncertain", "unclear", "none"}

DEFAULT_CLAUDE_MODEL = "claude-sonnet-5"

_IDENTIFICATION_PROMPT = """\
You are helping identify a household item from a photo so it can be \
searched for on a German classifieds site (Kleinanzeigen) and evaluated \
for sale, donation, or disposal.

Look at the photo and respond with ONLY a single JSON object (no prose, \
no markdown fences) with exactly these keys:

- "name": short human-readable name of the item (empty string "" if you \
  genuinely cannot tell what it is)
- "category": general category, e.g. "furniture", "electronics", "tools"
- "brand": brand name if visible/identifiable, or null if unknown
- "condition": one of "good", "fair", "broken", or "unknown"
- "search_keywords": a JSON array of 2-5 short strings suitable as \
  search terms on a German classifieds marketplace
- "confidence": one of "high", "medium", or "low", reflecting how \
  confident you are in this identification

If the photo is blurry, ambiguous, or you cannot identify the item, still \
return the JSON object, but set "name" to "" and "confidence" to "low".
"""


@runtime_checkable
class IdentificationProvider(Protocol):
    """Interface for anything that can turn a photo into a raw identification dict.

    Implementations should raise on outright call failure (network error,
    timeout, malformed/unparseable response, etc.) rather than returning
    a sentinel value -- ``ItemIdentificationService`` distinguishes "call
    failed" from "call succeeded but was ambiguous" precisely via whether
    an exception was raised (see module docstring).
    """

    def identify(self, photo_path: str) -> dict[str, Any]:
        """Return a dict describing the item in ``photo_path``.

        Expected (but not strictly required) keys: ``name``, ``category``,
        ``brand``, ``condition``, ``search_keywords``, and optionally
        ``confidence``.
        """
        ...


class IdentificationError(Exception):
    """Raised by an ``IdentificationProvider`` when the underlying call fails.

    Covers network errors, timeouts, non-success API responses, and
    responses that can't be parsed into the expected structure.
    """


class ClaudeVisionProvider:
    """Default ``IdentificationProvider`` backed by Anthropic's vision API.

    The Anthropic client is created lazily (on first ``identify()`` call,
    not at construction time) so importing/instantiating this class never
    requires ``ANTHROPIC_API_KEY`` to be set -- tests inject a fake
    ``client`` instead and never touch the real network.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        client: Any | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model or os.environ.get("ANTHROPIC_VISION_MODEL", DEFAULT_CLAUDE_MODEL)
        self._client = client

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        import anthropic  # imported lazily so the package is only required at runtime

        api_key = self._api_key or os.environ.get("ANTHROPIC_API_KEY")
        self._client = anthropic.Anthropic(api_key=api_key)
        return self._client

    def identify(self, photo_path: str) -> dict[str, Any]:
        try:
            image_bytes = Path(photo_path).read_bytes()
        except OSError as exc:
            raise IdentificationError(f"Could not read photo at {photo_path!r}: {exc}") from exc

        media_type = mimetypes.guess_type(photo_path)[0] or "image/jpeg"
        image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

        client = self._get_client()

        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_b64,
                                },
                            },
                            {"type": "text", "text": _IDENTIFICATION_PROMPT},
                        ],
                    }
                ],
            )
        except Exception as exc:  # network errors, timeouts, SDK/API errors, etc.
            raise IdentificationError(f"Claude vision API call failed: {exc}") from exc

        try:
            text = response.content[0].text
            data = json.loads(text)
        except Exception as exc:
            raise IdentificationError(
                f"Could not parse Claude vision response as JSON: {exc}"
            ) from exc

        if not isinstance(data, dict):
            raise IdentificationError(
                f"Claude vision response JSON was not an object: {data!r}"
            )

        return data


def _is_low_confidence(raw: dict[str, Any]) -> bool:
    confidence = raw.get("confidence")
    if not isinstance(confidence, str):
        return False
    return confidence.strip().lower() in _LOW_CONFIDENCE_MARKERS


def _clean_keyword_list(raw_keywords: Any) -> list[str]:
    if not isinstance(raw_keywords, list):
        return []
    return [kw.strip() for kw in raw_keywords if isinstance(kw, str) and kw.strip()]


class ItemIdentificationService:
    """Orchestrates identifying an ``Item``'s photo and updating the row.

    Pure business logic: does not touch a DB session, does not commit --
    it mutates the passed-in ``Item`` instance's attributes in place. The
    caller (eventually the pipeline in a later bead) owns the session
    lifecycle and decides when to commit.
    """

    def __init__(self, provider: IdentificationProvider | None = None) -> None:
        self._provider = provider or ClaudeVisionProvider()

    def identify_item(self, item: Item) -> bool:
        """Identify ``item``'s photo and update its fields in place.

        Returns ``True`` if identification succeeded (fields were
        populated and ``item.status`` advanced to ``pending_search``), or
        ``False`` if the underlying provider call failed -- in which case
        ``item.status`` is left untouched (still ``pending_identification``)
        so it can be retried later.

        Never raises: provider failures are caught, logged via the
        standard ``logging`` module, and reported through the return
        value rather than propagating.
        """
        try:
            raw = self._provider.identify(item.photo_path)
        except Exception:
            logger.exception(
                "Identification failed for item id=%s photo_path=%r",
                getattr(item, "id", None),
                item.photo_path,
            )
            return False

        raw_name = raw.get("name")
        raw_name = raw_name.strip() if isinstance(raw_name, str) else ""
        low_confidence = _is_low_confidence(raw)

        # See module docstring "Failure vs. ambiguity convention": an
        # empty name or an explicit low-confidence marker both mean "the
        # model responded but wasn't sure" -- fall back to a generic
        # best-effort name/keywords rather than leaving fields null.
        if raw_name and not low_confidence:
            name = raw_name
        else:
            name = FALLBACK_NAME
            logger.info(
                "Ambiguous identification for item id=%s (raw name=%r, confidence=%r); "
                "using fallback name %r",
                getattr(item, "id", None),
                raw.get("name"),
                raw.get("confidence"),
                FALLBACK_NAME,
            )

        keywords = _clean_keyword_list(raw.get("search_keywords"))
        if not keywords:
            keywords = [name] if name != FALLBACK_NAME else list(FALLBACK_KEYWORDS)

        raw_brand = raw.get("brand")
        brand = raw_brand.strip() if isinstance(raw_brand, str) and raw_brand.strip() else None

        raw_category = raw.get("category")
        category = raw_category.strip() if isinstance(raw_category, str) and raw_category.strip() else "unknown"

        raw_condition = raw.get("condition")
        condition = (
            raw_condition.strip() if isinstance(raw_condition, str) and raw_condition.strip() else "unknown"
        )

        item.identified_name = name
        item.category = category
        item.brand = brand
        item.condition = condition
        item.search_keywords = keywords
        item.status = ItemStatus.PENDING_SEARCH
        return True
