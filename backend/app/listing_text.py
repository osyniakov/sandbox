"""Listing-text generation service.

Turns an already-identified/decided :class:`~app.models.Item` into a
German-language Kleinanzeigen-ready ``title``/``description`` pair via a
text-only LLM call.

This module is a *service*, not an HTTP endpoint -- wiring it into a
FastAPI route (and deciding when/how DB sessions get committed) is the
job of the pipeline-orchestration bead. Callers are expected to pass in
an already-loaded ``Item`` ORM instance (with ``decision`` already set),
call ``ListingTextService().generate_listing_text(item)``, and then
persist the (mutated in place) item themselves (e.g. ``session.commit()``).

Architecture mirrors ``app.identification`` closely on purpose (see that
module's docstring): a ``ListingTextProvider`` Protocol isolates the
actual LLM call, ``ClaudeListingTextProvider`` is the default concrete
implementation (this one text-only -- no image content block, since by
the time we're generating listing text the item has already been
identified from its photo), and ``ListingTextService`` is pure
orchestration logic that never raises.

Decision gating
----------------
Generating listing text only makes sense for items the user has decided
to actually list somewhere: ``Decision.SELL`` (a paid Kleinanzeigen
listing) or ``Decision.GIVE_AWAY`` (a "zu verschenken" listing). For
``Decision.THROW_AWAY`` and ``Decision.PENDING`` this stage is a no-op --
``generate_listing_text`` returns ``False`` immediately without making
any provider call, and leaves ``suggested_title``/``suggested_description``
untouched.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Protocol, runtime_checkable

from app.models import Decision, Item

logger = logging.getLogger(__name__)

# Reuse the same model config as identification -- no separate env var for
# listing-text model selection.
DEFAULT_CLAUDE_MODEL = "claude-sonnet-5"

# Kleinanzeigen's real title UI limit. Enforced both in the prompt (best
# effort) and, as a safety net, in code via `_clamp_title`.
MAX_TITLE_LENGTH = 65

_LISTING_TEXT_PROMPT_TEMPLATE = """\
You are writing a listing for a German classifieds site (Kleinanzeigen) \
for a household item that is being {decision_phrase}.

Item details:
- Name: {name}
- Category: {category}
- Brand: {brand}
- Condition: {condition}
- Search keywords: {keywords}
- Suggested price: {price}

Respond with ONLY a single JSON object (no prose, no markdown fences) \
with exactly these keys:

- "title": a short, appealing listing title IN GERMAN, no more than 65 \
  characters long
- "description": a short listing description IN GERMAN, a few sentences \
  covering what the item is, its condition, and{description_extra}

Both "title" and "description" must be non-empty strings written in \
German.
"""


@runtime_checkable
class ListingTextProvider(Protocol):
    """Interface for anything that can turn structured item info into listing text.

    Implementations should raise on outright call failure (network error,
    timeout, malformed/unparseable response, etc.) rather than returning
    a sentinel value -- ``ListingTextService`` treats any exception from
    ``generate()`` as a failure, logs it, and leaves the item's
    ``suggested_title``/``suggested_description`` untouched (see module
    docstring).
    """

    def generate(self, item_info: dict[str, Any]) -> dict[str, Any]:
        """Return a dict describing listing text for ``item_info``.

        ``item_info`` carries the structured fields the provider needs:
        ``identified_name``, ``category``, ``brand``, ``condition``,
        ``search_keywords``, ``decision``, and ``suggested_price``.

        Expected keys on the returned dict: ``title`` and ``description``
        (both strings).
        """
        ...


class ListingTextError(Exception):
    """Raised by a ``ListingTextProvider`` when the underlying call fails.

    Covers network errors, timeouts, non-success API responses, and
    responses that can't be parsed into the expected structure.
    """


def _extract_text_block(response: Any) -> str:
    """Return the text of the first ``text``-type block in ``response.content``.

    The Anthropic Messages API does not guarantee that ``content[0]`` is a
    text block -- when extended thinking is enabled (or for other reasons),
    a ``ThinkingBlock`` (or some other non-text block) can be returned
    before the actual text response. Blindly indexing ``content[0]`` then
    either raises ``AttributeError`` (non-text blocks have no ``.text``
    attribute) or silently grabs the wrong block's (possibly empty) text,
    which later surfaces as a confusing ``json.JSONDecodeError``. This scans
    all content blocks and returns the first whose ``type`` is ``"text"``,
    regardless of position.
    """
    text_block = next(
        (block for block in response.content if getattr(block, "type", None) == "text"),
        None,
    )
    if text_block is None:
        block_types = [getattr(block, "type", None) for block in response.content]
        raise ListingTextError(
            f"Claude listing-text response contained no text content block (block types: {block_types!r})"
        )
    return text_block.text


def _decision_phrase(decision: Decision) -> str:
    if decision == Decision.GIVE_AWAY:
        return "given away for free"
    return "sold"


def _description_extra(decision: Decision) -> str:
    if decision == Decision.GIVE_AWAY:
        return (
            ' that it is free to a good home ("zu verschenken") -- do not '
            "mention a price"
        )
    return (
        ' a natural price framing that mentions the suggested price and, '
        'if it fits naturally, "VB" (Verhandlungsbasis / negotiable), as '
        "is customary in German classifieds ads"
    )


class ClaudeListingTextProvider:
    """Default ``ListingTextProvider`` backed by Anthropic's text API.

    The Anthropic client is created lazily (on first ``generate()`` call,
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

    def generate(self, item_info: dict[str, Any]) -> dict[str, Any]:
        decision = item_info.get("decision")
        prompt_text = _LISTING_TEXT_PROMPT_TEMPLATE.format(
            decision_phrase=_decision_phrase(decision),
            name=item_info.get("identified_name") or "unknown item",
            category=item_info.get("category") or "unknown",
            brand=item_info.get("brand") or "unknown/none",
            condition=item_info.get("condition") or "unknown",
            keywords=", ".join(item_info.get("search_keywords") or []) or "none",
            price=item_info.get("suggested_price") if item_info.get("suggested_price") is not None else "unknown",
            description_extra=_description_extra(decision),
        )

        client = self._get_client()

        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt_text},
                        ],
                    }
                ],
            )
        except Exception as exc:  # network errors, timeouts, SDK/API errors, etc.
            raise ListingTextError(f"Claude listing-text API call failed: {exc}") from exc

        try:
            text = _extract_text_block(response)
            data = json.loads(text)
        except ListingTextError:
            raise
        except Exception as exc:
            raise ListingTextError(
                f"Could not parse Claude listing-text response as JSON: {exc}"
            ) from exc

        if not isinstance(data, dict):
            raise ListingTextError(
                f"Claude listing-text response JSON was not an object: {data!r}"
            )

        return data


def _clamp_title(title: str, max_length: int = MAX_TITLE_LENGTH) -> str:
    """Truncate ``title`` to at most ``max_length`` characters.

    Safety net against the LLM ignoring the prompt's length instruction.
    Prefers truncating at a word boundary when one is reasonably close to
    the limit (within the last 20 characters of the allowed length), to
    avoid chopping a word in half; otherwise falls back to a hard
    truncation at exactly ``max_length`` characters.
    """
    if len(title) <= max_length:
        return title

    truncated = title[:max_length]
    last_space = truncated.rfind(" ")
    # Only prefer the word boundary if it doesn't throw away too much of
    # the title (i.e. it's within the last 20 chars of the limit).
    if last_space != -1 and last_space >= max_length - 20:
        return truncated[:last_space].rstrip()
    return truncated.rstrip()


class ListingTextService:
    """Orchestrates generating listing text for an ``Item`` and updating the row.

    Pure business logic: does not touch a DB session, does not commit --
    it mutates the passed-in ``Item`` instance's attributes in place. The
    caller (the pipeline) owns the session lifecycle and decides when to
    commit.
    """

    def __init__(self, provider: ListingTextProvider | None = None) -> None:
        self._provider = provider or ClaudeListingTextProvider()

    def generate_listing_text(self, item: Item) -> bool:
        """Generate listing text for ``item`` and update its fields in place.

        Returns ``False`` immediately (no LLM call made) if
        ``item.decision`` is not ``Decision.SELL`` or ``Decision.GIVE_AWAY``
        -- this stage is a no-op for throw_away/pending items, and
        ``suggested_title``/``suggested_description`` are left untouched.

        Otherwise calls the provider. Never raises: provider failures (or
        a malformed response -- missing/empty/non-string ``title`` or
        ``description``) are caught, logged via the standard ``logging``
        module, and reported through the return value rather than
        propagating; in that case ``suggested_title``/
        ``suggested_description`` are left untouched (``None``).

        On success, sets ``item.suggested_title`` (clamped to
        ``MAX_TITLE_LENGTH`` characters) and ``item.suggested_description``,
        and returns ``True``.
        """
        if item.decision not in (Decision.SELL, Decision.GIVE_AWAY):
            return False

        item_info = {
            "identified_name": item.identified_name,
            "category": item.category,
            "brand": item.brand,
            "condition": item.condition,
            "search_keywords": item.search_keywords,
            "decision": item.decision,
            "suggested_price": item.suggested_price,
        }

        try:
            raw = self._provider.generate(item_info)
        except Exception:
            logger.exception(
                "Listing text generation failed for item id=%s",
                getattr(item, "id", None),
            )
            return False

        title = raw.get("title")
        description = raw.get("description")

        if not isinstance(title, str) or not title.strip():
            logger.error(
                "Listing text response for item id=%s had missing/empty title: %r",
                getattr(item, "id", None),
                raw,
            )
            return False

        if not isinstance(description, str) or not description.strip():
            logger.error(
                "Listing text response for item id=%s had missing/empty description: %r",
                getattr(item, "id", None),
                raw,
            )
            return False

        item.suggested_title = _clamp_title(title.strip())
        item.suggested_description = description.strip()
        return True
