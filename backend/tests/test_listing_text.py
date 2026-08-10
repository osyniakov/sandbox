"""Tests for the listing-text generation service.

All tests use fake/mocked providers or a fake Anthropic client -- no real
network calls are made and no ``ANTHROPIC_API_KEY`` is required.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.listing_text import (
    ClaudeListingTextProvider,
    ListingTextError,
    ListingTextService,
    MAX_TITLE_LENGTH,
    _clamp_title,
)
from app.models import Decision, Item, ItemStatus


class _StubProvider:
    """Minimal ListingTextProvider stub: returns a fixed dict or raises."""

    def __init__(self, result: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.calls: list[dict[str, Any]] = []

    def generate(self, item_info: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(item_info)
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _make_item(decision: Decision = Decision.SELL, **kwargs: Any) -> Item:
    defaults: dict[str, Any] = dict(
        photo_path="/photos/item.jpg",
        status=ItemStatus.PENDING_DECISION,
        identified_name="Desk Lamp",
        category="lighting",
        brand="IKEA",
        condition="good",
        search_keywords=["desk lamp", "ikea lamp"],
        suggested_price=15.0,
        decision=decision,
    )
    defaults.update(kwargs)
    return Item(**defaults)


# ---------------------------------------------------------------------------
# Decision gating (no-op for throw_away / pending)
# ---------------------------------------------------------------------------


def test_throw_away_decision_is_a_noop_and_makes_no_provider_call() -> None:
    item = _make_item(decision=Decision.THROW_AWAY)
    provider = _StubProvider(result={"title": "x", "description": "y"})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert provider.calls == []
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_pending_decision_is_a_noop_and_makes_no_provider_call() -> None:
    item = _make_item(decision=Decision.PENDING)
    provider = _StubProvider(result={"title": "x", "description": "y"})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert provider.calls == []
    assert item.suggested_title is None
    assert item.suggested_description is None


# ---------------------------------------------------------------------------
# Well-formed response for sell / give_away
# ---------------------------------------------------------------------------


def test_sell_decision_with_well_formed_response_sets_fields() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(
        result={"title": "Schreibtischlampe IKEA, guter Zustand", "description": "Eine gut erhaltene Schreibtischlampe von IKEA. VB 15 Euro."}
    )
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is True
    assert len(provider.calls) == 1
    assert item.suggested_title == "Schreibtischlampe IKEA, guter Zustand"
    assert item.suggested_description == "Eine gut erhaltene Schreibtischlampe von IKEA. VB 15 Euro."


def test_give_away_decision_with_well_formed_response_sets_fields() -> None:
    item = _make_item(decision=Decision.GIVE_AWAY)
    provider = _StubProvider(
        result={"title": "Schreibtischlampe zu verschenken", "description": "Funktionstuechtige Lampe, zu verschenken."}
    )
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is True
    assert item.suggested_title == "Schreibtischlampe zu verschenken"
    assert item.suggested_description == "Funktionstuechtige Lampe, zu verschenken."


def test_provider_receives_expected_item_info_fields() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"title": "t", "description": "d"})
    service = ListingTextService(provider=provider)

    service.generate_listing_text(item)

    assert len(provider.calls) == 1
    info = provider.calls[0]
    assert info["identified_name"] == "Desk Lamp"
    assert info["category"] == "lighting"
    assert info["brand"] == "IKEA"
    assert info["condition"] == "good"
    assert info["search_keywords"] == ["desk lamp", "ikea lamp"]
    assert info["decision"] == Decision.SELL
    assert info["suggested_price"] == 15.0


# ---------------------------------------------------------------------------
# Provider failure (exception) -- never raises, fields untouched
# ---------------------------------------------------------------------------


def test_provider_exception_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(error=TimeoutError("listing text API timed out"))
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_listing_text_error_from_provider_is_caught() -> None:
    item = _make_item(decision=Decision.GIVE_AWAY)
    provider = _StubProvider(error=ListingTextError("network error"))
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


# ---------------------------------------------------------------------------
# Malformed response -- treated as failure, no partial population
# ---------------------------------------------------------------------------


def test_missing_title_key_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"description": "Eine schoene Lampe."})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_missing_description_key_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"title": "Lampe"})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_empty_title_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"title": "", "description": "Eine schoene Lampe."})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_non_string_description_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"title": "Lampe", "description": 12345})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


def test_non_string_title_returns_false_and_leaves_fields_none() -> None:
    item = _make_item(decision=Decision.SELL)
    provider = _StubProvider(result={"title": None, "description": "Eine schoene Lampe."})
    service = ListingTextService(provider=provider)

    ok = service.generate_listing_text(item)

    assert ok is False
    assert item.suggested_title is None
    assert item.suggested_description is None


# ---------------------------------------------------------------------------
# Title clamping helper (direct unit tests)
# ---------------------------------------------------------------------------


def test_clamp_title_well_under_limit_is_unchanged() -> None:
    title = "Schreibtischlampe IKEA"
    assert _clamp_title(title) == title


def test_clamp_title_exactly_at_limit_is_unchanged() -> None:
    title = "a" * MAX_TITLE_LENGTH
    result = _clamp_title(title)
    assert result == title
    assert len(result) == MAX_TITLE_LENGTH


def test_clamp_title_well_over_limit_with_no_convenient_word_boundary_hard_truncates() -> None:
    # A single long run of characters with no spaces near the cutoff.
    title = "x" * 100
    result = _clamp_title(title)
    assert len(result) == MAX_TITLE_LENGTH
    assert result == "x" * MAX_TITLE_LENGTH


def test_clamp_title_over_limit_with_convenient_word_boundary_truncates_at_word() -> None:
    # Construct a title where a space falls within the last 20 chars of
    # the 65-char cutoff, so truncation should land on that word boundary
    # rather than mid-word.
    prefix = "a" * 60  # 60 chars
    title = prefix + " lampe fuer den schreibtisch"  # space at index 60, well within last 20 of limit 65
    result = _clamp_title(title)
    assert len(result) <= MAX_TITLE_LENGTH
    assert result == prefix
    assert not result.endswith(" ")


def test_clamp_title_respects_custom_max_length() -> None:
    title = "abcdefghij"
    assert _clamp_title(title, max_length=5) == "abcde"


# ---------------------------------------------------------------------------
# ClaudeListingTextProvider (default provider), with a fake Anthropic client
# ---------------------------------------------------------------------------


class _FakeContentBlock:
    """A fake ``text``-type content block, matching the real SDK's shape."""

    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _FakeThinkingBlock:
    """A fake ``thinking``-type content block (extended thinking).

    Deliberately has no ``.text`` attribute, mirroring the real SDK's
    ``ThinkingBlock`` (which exposes ``.thinking`` instead) -- this is what
    triggers ``AttributeError: 'ThinkingBlock' object has no attribute
    'text'`` if code blindly indexes ``content[0]``.
    """

    def __init__(self, thinking: str = "pondering...") -> None:
        self.type = "thinking"
        self.thinking = thinking


class _FakeMessage:
    def __init__(self, text: str, leading_blocks: list[Any] | None = None) -> None:
        self.content = [*(leading_blocks or []), _FakeContentBlock(text)]


class _FakeMessagesAPI:
    def __init__(
        self,
        response_text: str | None = None,
        error: Exception | None = None,
        leading_blocks: list[Any] | None = None,
        content: list[Any] | None = None,
    ) -> None:
        self._response_text = response_text
        self._error = error
        self._leading_blocks = leading_blocks
        self._content = content
        self.last_kwargs: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> Any:
        self.last_kwargs = kwargs
        if self._error is not None:
            raise self._error
        if self._content is not None:

            class _RawMessage:
                pass

            msg = _RawMessage()
            msg.content = self._content
            return msg
        assert self._response_text is not None
        return _FakeMessage(self._response_text, leading_blocks=self._leading_blocks)


class _FakeAnthropicClient:
    def __init__(
        self,
        response_text: str | None = None,
        error: Exception | None = None,
        leading_blocks: list[Any] | None = None,
        content: list[Any] | None = None,
    ) -> None:
        self.messages = _FakeMessagesAPI(
            response_text=response_text, error=error, leading_blocks=leading_blocks, content=content
        )


def _item_info(decision: Decision = Decision.SELL) -> dict[str, Any]:
    return {
        "identified_name": "Desk Lamp",
        "category": "lighting",
        "brand": "IKEA",
        "condition": "good",
        "search_keywords": ["desk lamp", "ikea lamp"],
        "decision": decision,
        "suggested_price": 15.0,
    }


def test_claude_listing_text_provider_parses_well_formed_json_response() -> None:
    response_json = json.dumps({"title": "Schreibtischlampe IKEA", "description": "Gut erhaltene Lampe. VB 15 Euro."})
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeListingTextProvider(client=fake_client)

    result = provider.generate(_item_info())

    assert result["title"] == "Schreibtischlampe IKEA"
    assert result["description"] == "Gut erhaltene Lampe. VB 15 Euro."
    # Sanity-check the request shape: text-only, no image content block.
    kwargs = fake_client.messages.last_kwargs
    assert kwargs is not None
    content_blocks = kwargs["messages"][0]["content"]
    assert all(block["type"] == "text" for block in content_blocks)
    assert not any(block["type"] == "image" for block in content_blocks)


def test_claude_listing_text_provider_raises_on_client_failure() -> None:
    fake_client = _FakeAnthropicClient(error=ConnectionError("boom"))
    provider = ClaudeListingTextProvider(client=fake_client)

    with pytest.raises(ListingTextError):
        provider.generate(_item_info())


def test_claude_listing_text_provider_raises_on_unparseable_response() -> None:
    fake_client = _FakeAnthropicClient(response_text="not valid json {{{")
    provider = ClaudeListingTextProvider(client=fake_client)

    with pytest.raises(ListingTextError):
        provider.generate(_item_info())


def test_claude_listing_text_provider_finds_text_block_after_leading_thinking_block() -> None:
    """Regression test: a leading ThinkingBlock (extended thinking) must not
    break parsing -- the provider should find the actual text block
    regardless of its position in ``response.content``."""
    response_json = json.dumps({"title": "Schreibtischlampe IKEA", "description": "Gut erhaltene Lampe. VB 15 Euro."})
    fake_client = _FakeAnthropicClient(
        response_text=response_json,
        leading_blocks=[_FakeThinkingBlock()],
    )
    provider = ClaudeListingTextProvider(client=fake_client)

    result = provider.generate(_item_info())

    assert result["title"] == "Schreibtischlampe IKEA"
    assert result["description"] == "Gut erhaltene Lampe. VB 15 Euro."


def test_claude_listing_text_provider_raises_clear_error_when_no_text_block_present() -> None:
    """No text block anywhere in the response -> a clear ListingTextError,
    not a generic AttributeError or JSONDecodeError."""
    fake_client = _FakeAnthropicClient(content=[_FakeThinkingBlock()])
    provider = ClaudeListingTextProvider(client=fake_client)

    with pytest.raises(ListingTextError, match="no text content block") as exc_info:
        provider.generate(_item_info())

    # Locks in the anti-rewrap fix specifically (not just the message
    # substring, which a broken re-wrap would still contain as a suffix):
    # the outer `except Exception` must not re-catch and re-wrap this error
    # with a misleading "...as JSON"/chained-exception shape.
    assert "as JSON" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None


def test_claude_listing_text_provider_end_to_end_through_service() -> None:
    response_json = json.dumps({"title": "Schreibtischlampe IKEA", "description": "Gut erhaltene Lampe. VB 15 Euro."})
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeListingTextProvider(client=fake_client)
    service = ListingTextService(provider=provider)

    item = _make_item(decision=Decision.SELL)
    assert service.generate_listing_text(item) is True
    assert item.suggested_title == "Schreibtischlampe IKEA"
    assert item.suggested_description == "Gut erhaltene Lampe. VB 15 Euro."


def test_claude_listing_text_provider_does_not_require_api_key_when_client_injected(monkeypatch) -> None:
    """Injecting a fake client means no ANTHROPIC_API_KEY is ever needed."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    response_json = json.dumps({"title": "Lampe", "description": "Eine Lampe."})
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeListingTextProvider(client=fake_client)

    # Should not raise despite no API key being configured anywhere.
    result = provider.generate(_item_info())
    assert result["title"] == "Lampe"


def test_claude_listing_text_provider_can_be_constructed_without_api_key(monkeypatch) -> None:
    """Constructing the provider (no client injected) must never require
    ANTHROPIC_API_KEY -- the real anthropic client is only built lazily on
    first `generate()` call."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    # Must not raise.
    provider = ClaudeListingTextProvider()
    assert provider is not None
