"""Tests for the vision-based item identification service.

All tests use fake/mocked providers or a fake Anthropic client -- no real
network calls are made and no ``ANTHROPIC_API_KEY`` is required.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.identification import (
    ClaudeVisionProvider,
    IdentificationError,
    ItemIdentificationService,
)
from app.models import Item, ItemStatus


class _StubProvider:
    """Minimal IdentificationProvider stub: returns a fixed dict or raises."""

    def __init__(self, result: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.calls: list[str] = []
        self.hint_calls: list[str | None] = []

    def identify(self, photo_path: str, hint: str | None = None) -> dict[str, Any]:
        self.calls.append(photo_path)
        self.hint_calls.append(hint)
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _make_item(photo_path: str = "/photos/item.jpg", user_hint: str | None = None) -> Item:
    # In production this item is loaded from the DB, where the `status`
    # column default (pending_identification) has already been applied at
    # INSERT time. SQLAlchemy column defaults only apply on flush/insert,
    # not on bare Python construction, so we set it explicitly here to
    # mirror a realistic already-persisted Item.
    return Item(photo_path=photo_path, status=ItemStatus.PENDING_IDENTIFICATION, user_hint=user_hint)


# ---------------------------------------------------------------------------
# Well-formed response
# ---------------------------------------------------------------------------


def test_well_formed_response_updates_item_and_advances_status() -> None:
    item = _make_item()
    provider = _StubProvider(
        result={
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp", "ikea lamp", "table light"],
            "confidence": "high",
        }
    )
    service = ItemIdentificationService(provider=provider)

    ok = service.identify_item(item)

    assert ok is True
    assert provider.calls == [item.photo_path]
    assert item.identified_name == "Desk Lamp"
    assert item.category == "lighting"
    assert item.brand == "IKEA"
    assert item.condition == "good"
    assert item.search_keywords == ["desk lamp", "ikea lamp", "table light"]
    assert item.status == ItemStatus.PENDING_SEARCH


def test_well_formed_response_with_null_brand() -> None:
    item = _make_item()
    provider = _StubProvider(
        result={
            "name": "Wooden Chair",
            "category": "furniture",
            "brand": None,
            "condition": "fair",
            "search_keywords": ["wooden chair", "vintage chair"],
            "confidence": "medium",
        }
    )
    service = ItemIdentificationService(provider=provider)

    assert service.identify_item(item) is True
    assert item.brand is None
    assert item.status == ItemStatus.PENDING_SEARCH


# ---------------------------------------------------------------------------
# user_hint forwarding
# ---------------------------------------------------------------------------


def test_identify_item_forwards_user_hint_to_provider() -> None:
    item = _make_item(user_hint="it's a broken toaster")
    provider = _StubProvider(
        result={
            "name": "Toaster",
            "category": "appliances",
            "brand": None,
            "condition": "broken",
            "search_keywords": ["toaster"],
            "confidence": "high",
        }
    )
    service = ItemIdentificationService(provider=provider)

    assert service.identify_item(item) is True
    assert provider.hint_calls == ["it's a broken toaster"]


def test_identify_item_passes_none_hint_when_item_has_no_hint() -> None:
    item = _make_item(user_hint=None)
    provider = _StubProvider(
        result={
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": None,
            "condition": "good",
            "search_keywords": ["desk lamp"],
            "confidence": "high",
        }
    )
    service = ItemIdentificationService(provider=provider)

    assert service.identify_item(item) is True
    assert provider.hint_calls == [None]


# ---------------------------------------------------------------------------
# API call failure / timeout
# ---------------------------------------------------------------------------


def test_provider_exception_sets_identification_failed_status_and_does_not_raise() -> None:
    item = _make_item()
    provider = _StubProvider(error=TimeoutError("vision API timed out"))
    service = ItemIdentificationService(provider=provider)

    ok = service.identify_item(item)

    assert ok is False
    assert item.status == ItemStatus.IDENTIFICATION_FAILED
    # None of the identification fields should have been touched.
    assert item.identified_name is None
    assert item.category is None
    assert item.brand is None
    assert item.condition is None
    assert item.search_keywords is None


def test_identification_error_from_provider_is_caught() -> None:
    item = _make_item()
    provider = _StubProvider(error=IdentificationError("network error"))
    service = ItemIdentificationService(provider=provider)

    ok = service.identify_item(item)

    assert ok is False
    assert item.status == ItemStatus.IDENTIFICATION_FAILED


# ---------------------------------------------------------------------------
# Ambiguous / unidentifiable photo
# ---------------------------------------------------------------------------


def test_low_confidence_response_produces_fallback_name_and_keywords() -> None:
    item = _make_item()
    provider = _StubProvider(
        result={
            "name": "",
            "category": "unknown",
            "brand": None,
            "condition": "unknown",
            "search_keywords": [],
            "confidence": "low",
        }
    )
    service = ItemIdentificationService(provider=provider)

    ok = service.identify_item(item)

    assert ok is True
    assert item.identified_name == "unidentified item"
    assert item.identified_name is not None
    assert item.search_keywords is not None
    assert len(item.search_keywords) > 0
    assert item.status == ItemStatus.PENDING_SEARCH


def test_empty_name_without_confidence_marker_still_falls_back() -> None:
    item = _make_item()
    provider = _StubProvider(
        result={
            "name": "",
            "category": "misc",
            "brand": None,
            "condition": "unknown",
            "search_keywords": ["something", "unclear object"],
        }
    )
    service = ItemIdentificationService(provider=provider)

    assert service.identify_item(item) is True
    assert item.identified_name == "unidentified item"
    # Model-provided keywords are still honored even though name fell back.
    assert item.search_keywords == ["something", "unclear object"]


def test_confident_name_but_empty_keywords_gets_keyword_fallback() -> None:
    item = _make_item()
    provider = _StubProvider(
        result={
            "name": "Mystery Gadget",
            "category": "electronics",
            "brand": None,
            "condition": "unknown",
            "search_keywords": [],
            "confidence": "high",
        }
    )
    service = ItemIdentificationService(provider=provider)

    assert service.identify_item(item) is True
    assert item.identified_name == "Mystery Gadget"
    assert item.search_keywords == ["Mystery Gadget"]
    assert item.status == ItemStatus.PENDING_SEARCH


# ---------------------------------------------------------------------------
# ClaudeVisionProvider (default provider), with a fake Anthropic client
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


def test_claude_vision_provider_parses_well_formed_json_response(tmp_path) -> None:
    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp", "ikea lamp"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)

    result = provider.identify(str(photo))

    assert result["name"] == "Desk Lamp"
    assert result["brand"] == "IKEA"
    assert result["search_keywords"] == ["desk lamp", "ikea lamp"]
    # Sanity-check the request shape: an image block should have been sent.
    kwargs = fake_client.messages.last_kwargs
    assert kwargs is not None
    content_blocks = kwargs["messages"][0]["content"]
    assert any(block["type"] == "image" for block in content_blocks)


def test_claude_vision_provider_no_hint_sends_byte_identical_prompt(tmp_path) -> None:
    """Regression check: omitting the hint must not change the prompt at all."""
    from app.identification import _IDENTIFICATION_PROMPT

    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)

    provider.identify(str(photo))

    kwargs = fake_client.messages.last_kwargs
    assert kwargs is not None
    content_blocks = kwargs["messages"][0]["content"]
    text_block = next(block for block in content_blocks if block["type"] == "text")
    assert text_block["text"] == _IDENTIFICATION_PROMPT


def test_claude_vision_provider_empty_string_hint_sends_byte_identical_prompt(tmp_path) -> None:
    from app.identification import _IDENTIFICATION_PROMPT

    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)

    provider.identify(str(photo), hint="")

    kwargs = fake_client.messages.last_kwargs
    assert kwargs is not None
    content_blocks = kwargs["messages"][0]["content"]
    text_block = next(block for block in content_blocks if block["type"] == "text")
    assert text_block["text"] == _IDENTIFICATION_PROMPT


def test_claude_vision_provider_with_hint_appends_hint_after_prompt(tmp_path) -> None:
    from app.identification import _IDENTIFICATION_PROMPT

    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)

    provider.identify(str(photo), hint="this is my grandmother's antique lamp")

    kwargs = fake_client.messages.last_kwargs
    assert kwargs is not None
    content_blocks = kwargs["messages"][0]["content"]
    text_block = next(block for block in content_blocks if block["type"] == "text")
    sent_text = text_block["text"]

    # The hint must appear in the outgoing text...
    assert "this is my grandmother's antique lamp" in sent_text
    # ...appended after the existing JSON-schema instructions, not
    # interleaved into them.
    assert sent_text.startswith(_IDENTIFICATION_PROMPT)
    assert sent_text != _IDENTIFICATION_PROMPT


def test_claude_vision_provider_raises_identification_error_on_client_failure(tmp_path) -> None:
    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    fake_client = _FakeAnthropicClient(error=ConnectionError("boom"))
    provider = ClaudeVisionProvider(client=fake_client)

    with pytest.raises(IdentificationError):
        provider.identify(str(photo))


def test_claude_vision_provider_raises_identification_error_on_unparseable_response(tmp_path) -> None:
    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    fake_client = _FakeAnthropicClient(response_text="not valid json {{{")
    provider = ClaudeVisionProvider(client=fake_client)

    with pytest.raises(IdentificationError):
        provider.identify(str(photo))


def test_claude_vision_provider_finds_text_block_after_leading_thinking_block(tmp_path) -> None:
    """Regression test: a leading ThinkingBlock (extended thinking) must not
    break parsing -- the provider should find the actual text block
    regardless of its position in ``response.content``."""
    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Desk Lamp",
            "category": "lighting",
            "brand": "IKEA",
            "condition": "good",
            "search_keywords": ["desk lamp"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(
        response_text=response_json,
        leading_blocks=[_FakeThinkingBlock()],
    )
    provider = ClaudeVisionProvider(client=fake_client)

    result = provider.identify(str(photo))

    assert result["name"] == "Desk Lamp"
    assert result["brand"] == "IKEA"


def test_claude_vision_provider_raises_clear_error_when_no_text_block_present(tmp_path) -> None:
    """No text block anywhere in the response -> a clear IdentificationError,
    not a generic AttributeError or JSONDecodeError."""
    photo = tmp_path / "lamp.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    fake_client = _FakeAnthropicClient(content=[_FakeThinkingBlock()])
    provider = ClaudeVisionProvider(client=fake_client)

    with pytest.raises(IdentificationError, match="no text content block") as exc_info:
        provider.identify(str(photo))

    # Locks in the anti-rewrap fix specifically (not just the message
    # substring, which a broken re-wrap would still contain as a suffix):
    # the outer `except Exception` must not re-catch and re-wrap this error
    # with a misleading "...as JSON"/chained-exception shape.
    assert "as JSON" not in str(exc_info.value)
    assert exc_info.value.__cause__ is None


def test_claude_vision_provider_end_to_end_through_service(tmp_path) -> None:
    """Full path: ClaudeVisionProvider (fake client) -> ItemIdentificationService."""
    photo = tmp_path / "chair.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Wooden Chair",
            "category": "furniture",
            "brand": None,
            "condition": "fair",
            "search_keywords": ["wooden chair"],
            "confidence": "medium",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)
    service = ItemIdentificationService(provider=provider)

    item = _make_item(photo_path=str(photo))
    assert service.identify_item(item) is True
    assert item.identified_name == "Wooden Chair"
    assert item.status == ItemStatus.PENDING_SEARCH


def test_claude_vision_provider_via_service_on_client_failure_sets_identification_failed(tmp_path) -> None:
    photo = tmp_path / "chair.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    fake_client = _FakeAnthropicClient(error=TimeoutError("timed out"))
    provider = ClaudeVisionProvider(client=fake_client)
    service = ItemIdentificationService(provider=provider)

    item = _make_item(photo_path=str(photo))
    assert service.identify_item(item) is False
    assert item.status == ItemStatus.IDENTIFICATION_FAILED


def test_claude_vision_provider_does_not_require_api_key_when_client_injected(tmp_path, monkeypatch) -> None:
    """Injecting a fake client means no ANTHROPIC_API_KEY is ever needed."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    photo = tmp_path / "thing.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")

    response_json = json.dumps(
        {
            "name": "Thing",
            "category": "misc",
            "brand": None,
            "condition": "unknown",
            "search_keywords": ["thing"],
            "confidence": "high",
        }
    )
    fake_client = _FakeAnthropicClient(response_text=response_json)
    provider = ClaudeVisionProvider(client=fake_client)

    # Should not raise despite no API key being configured anywhere.
    result = provider.identify(str(photo))
    assert result["name"] == "Thing"
