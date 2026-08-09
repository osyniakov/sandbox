"""Tests for the Kleinanzeigen comparable-listings search service.

All tests use fake/stub providers or a fake ``kleinanzeigen_api``-style
client -- no real network calls are made, and the real ``kleinanzeigen-api``
package is never actually invoked against the live site (see the manual
smoke-test procedure documented in ``app/comparable_search.py`` for that).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.comparable_search import (
    ComparableListingSearchService,
    ComparableSearchError,
    KleinanzeigenAPIProvider,
    _build_query,
    _build_query_attempts,
    _extract_condition,
)
from app.models import ComparableListing, Item, ItemStatus


class _StubProvider:
    """Minimal ComparableSearchProvider stub.

    ``results`` may be a single list (returned every call) or a list of
    "responses" consumed one per call -- each response is either a list of
    raw dicts (success) or an ``Exception`` instance (failure, raised).
    This lets a single stub express "fails once, then succeeds" or "fails
    every time" sequences for the retry tests.
    """

    def __init__(self, responses: list[Any]) -> None:
        self._responses = list(responses)
        self.calls: list[str] = []

    def search(self, query: str) -> list[dict[str, Any]]:
        self.calls.append(query)
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _make_item(keywords: list[str] | None = None) -> Item:
    # Mirrors the identification tests: set status explicitly since column
    # defaults only apply on flush/insert, not bare construction.
    return Item(
        photo_path="/photos/item.jpg",
        status=ItemStatus.PENDING_SEARCH,
        search_keywords=keywords if keywords is not None else ["desk lamp", "ikea"],
    )


# ---------------------------------------------------------------------------
# Well-formed results
# ---------------------------------------------------------------------------


def test_well_formed_results_produce_populated_comparable_listings() -> None:
    item = _make_item()
    raw_results = [
        {
            "title": "IKEA desk lamp, works fine",
            "price": 10.0,
            "url": "https://www.kleinanzeigen.de/s-anzeige/1",
            "condition": "Gebraucht",
            "location": "Berlin",
        },
        {
            "title": "Desk lamp IKEA silver",
            "price": 15.5,
            "url": "https://www.kleinanzeigen.de/s-anzeige/2",
            "condition": "Neu",
            "location": "Hamburg",
        },
    ]
    provider = _StubProvider(responses=[raw_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert provider.calls == ["desk lamp ikea"]
    assert item.status == ItemStatus.PENDING_DECISION
    assert len(item.comparable_listings) == 2

    listing = item.comparable_listings[0]
    assert isinstance(listing, ComparableListing)
    assert listing.title == "IKEA desk lamp, works fine"
    assert listing.price == 10.0
    assert listing.url == "https://www.kleinanzeigen.de/s-anzeige/1"
    assert listing.condition == "Gebraucht"
    assert listing.location == "Berlin"

    other = item.comparable_listings[1]
    assert other.title == "Desk lamp IKEA silver"
    assert other.price == 15.5
    assert other.condition == "Neu"
    assert other.location == "Hamburg"


def test_listings_missing_required_fields_are_skipped_not_crashed() -> None:
    item = _make_item()
    raw_results = [
        {"title": "", "price": 10.0, "url": "https://x/1", "condition": "used", "location": "Berlin"},
        {"title": "No URL item", "price": 10.0, "url": "", "condition": None, "location": None},
        {"title": "No price item", "price": None, "url": "https://x/3", "condition": None, "location": None},
        {"title": "Fine item", "price": 5.0, "url": "https://x/4", "condition": None, "location": None},
    ]
    provider = _StubProvider(responses=[raw_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.status == ItemStatus.PENDING_DECISION
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Fine item"


# ---------------------------------------------------------------------------
# Zero-results edge case
# ---------------------------------------------------------------------------


def test_zero_results_returns_empty_list_and_still_advances_status() -> None:
    """Every progressively looser query also returns zero results.

    ``_make_item()`` defaults to keywords ``["desk lamp", "ikea"]``, so
    ``_build_query_attempts`` produces exactly 3 candidate queries: the
    joined query, then each keyword individually ("desk lamp", "ikea").
    All three must be exhausted (all zero) before the service accepts
    "zero comparables found" as final -- this pins the EXACT call count
    (not just "some bounded number") so the query-loosening retry can
    never silently become unbounded.
    """
    item = _make_item()
    assert _build_query_attempts(item.search_keywords) == ["desk lamp ikea", "desk lamp", "ikea"]
    provider = _StubProvider(responses=[[], [], []])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.comparable_listings == []
    assert item.status == ItemStatus.PENDING_DECISION
    assert provider.calls == ["desk lamp ikea", "desk lamp", "ikea"]
    assert len(provider.calls) == 3


def test_zero_results_on_joined_query_but_looser_single_keyword_finds_results() -> None:
    """The fully-joined query is over-narrow (zero results), but the first
    individual keyword alone finds a real comparable -- the service should
    use that non-empty result set rather than giving up after the first
    (too-specific) attempt.
    """
    item = _make_item(keywords=["desk lamp", "ikea", "silver"])
    raw_results = [
        {
            "title": "IKEA desk lamp",
            "price": 12.0,
            "url": "https://www.kleinanzeigen.de/s-anzeige/42",
            "condition": "Gebraucht",
            "location": "Berlin",
        }
    ]
    provider = _StubProvider(
        responses=[
            [],  # attempt 1: "desk lamp ikea silver" -- zero results
            raw_results,  # attempt 2: "desk lamp" alone -- succeeds
        ]
    )
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.status == ItemStatus.PENDING_DECISION
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "IKEA desk lamp"
    # Stopped as soon as a non-empty result set was found -- exactly two
    # calls, not three (the third candidate query, "ikea", is never tried).
    assert provider.calls == ["desk lamp ikea silver", "desk lamp"]
    assert len(provider.calls) == 2


def test_no_usable_keywords_treated_as_zero_results() -> None:
    item = _make_item(keywords=[])
    provider = _StubProvider(responses=[])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.comparable_listings == []
    assert item.status == ItemStatus.PENDING_DECISION
    # Provider should never even be called -- nothing to search with.
    assert provider.calls == []


def test_none_keywords_treated_as_zero_results() -> None:
    item = Item(photo_path="/photos/item.jpg", status=ItemStatus.PENDING_SEARCH, search_keywords=None)
    provider = _StubProvider(responses=[])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.comparable_listings == []
    assert item.status == ItemStatus.PENDING_DECISION
    assert provider.calls == []


# ---------------------------------------------------------------------------
# Network / scrape failure -- retry once, then fail gracefully
# ---------------------------------------------------------------------------


def test_provider_fails_twice_sets_search_failed_status_and_retries_exactly_once() -> None:
    item = _make_item()
    provider = _StubProvider(
        responses=[
            ComparableSearchError("network blip"),
            ComparableSearchError("network blip again"),
        ]
    )
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is False
    assert item.status == ItemStatus.SEARCH_FAILED
    # comparable_listings should not have been touched/replaced.
    assert list(item.comparable_listings) == []
    # Exactly two calls: the initial attempt plus exactly one retry.
    assert len(provider.calls) == 2
    assert provider.calls == ["desk lamp ikea", "desk lamp ikea"]


def test_provider_fails_once_then_succeeds_recovers_on_retry() -> None:
    item = _make_item()
    raw_results = [
        {"title": "Recovered item", "price": 9.0, "url": "https://x/1", "condition": None, "location": None}
    ]
    provider = _StubProvider(
        responses=[
            ComparableSearchError("transient failure"),
            raw_results,
        ]
    )
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.status == ItemStatus.PENDING_DECISION
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Recovered item"
    # Called twice: once failed, once succeeded.
    assert len(provider.calls) == 2


def test_generic_exception_from_provider_is_also_caught() -> None:
    """Any exception, not just ComparableSearchError, must be handled gracefully."""
    item = _make_item()
    provider = _StubProvider(responses=[TimeoutError("timed out"), TimeoutError("timed out again")])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is False
    assert item.status == ItemStatus.SEARCH_FAILED


def test_hard_failure_on_a_looser_query_aborts_without_trying_further_queries() -> None:
    """A definitive failure on a *loosening* candidate query (attempt 2+),
    after exhausting its own one failure-retry, aborts the whole search
    immediately -- it is not treated as "zero results, keep loosening".
    The two retry axes (failure-retry vs. query-loosening) are not
    multiplied together: this must be exactly 3 calls (1 for the zero-result
    joined query, then 2 for the failed second candidate query), not 4+ from
    also trying the third candidate query.
    """
    item = _make_item(keywords=["desk lamp", "ikea"])
    provider = _StubProvider(
        responses=[
            [],  # attempt 1: "desk lamp ikea" -- zero results, loosen
            ComparableSearchError("outage"),  # attempt 2 initial: "desk lamp"
            ComparableSearchError("outage still"),  # attempt 2 retry: "desk lamp"
        ]
    )
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is False
    assert item.status == ItemStatus.SEARCH_FAILED
    assert list(item.comparable_listings) == []
    assert provider.calls == ["desk lamp ikea", "desk lamp", "desk lamp"]
    assert len(provider.calls) == 3


# ---------------------------------------------------------------------------
# _build_query
# ---------------------------------------------------------------------------


def test_build_query_joins_and_strips_keywords() -> None:
    assert _build_query(["  desk lamp ", "ikea"]) == "desk lamp ikea"


def test_build_query_handles_empty_and_none() -> None:
    assert _build_query([]) == ""
    assert _build_query(None) == ""


def test_build_query_ignores_non_string_and_blank_entries() -> None:
    assert _build_query(["lamp", "", "   ", None, "ikea"]) == "lamp ikea"  # type: ignore[list-item]


# ---------------------------------------------------------------------------
# _build_query_attempts
# ---------------------------------------------------------------------------


def test_build_query_attempts_joined_first_then_individual_keywords() -> None:
    assert _build_query_attempts(["desk lamp", "ikea", "silver"]) == [
        "desk lamp ikea silver",
        "desk lamp",
        "ikea",
        "silver",
    ]


def test_build_query_attempts_handles_empty_and_none() -> None:
    assert _build_query_attempts([]) == []
    assert _build_query_attempts(None) == []


def test_build_query_attempts_skips_duplicate_single_keyword() -> None:
    """A single keyword: the joined query and that keyword alone are
    identical, so there's nothing looser to retry with -- only one
    candidate query should be produced.
    """
    assert _build_query_attempts(["lamp"]) == ["lamp"]


def test_build_query_attempts_capped_at_max_query_attempts() -> None:
    """Five keywords would otherwise produce 6 candidate queries (1 joined +
    5 individual); this must be capped at _MAX_QUERY_ATTEMPTS (4) so a long
    keyword list can never turn into an unbounded number of live searches.
    """
    attempts = _build_query_attempts(["a", "b", "c", "d", "e"])
    assert attempts == ["a b c d e", "a", "b", "c"]
    assert len(attempts) == 4


# ---------------------------------------------------------------------------
# _extract_condition
# ---------------------------------------------------------------------------


def test_extract_condition_matches_zustand_label_case_insensitively() -> None:
    assert _extract_condition({"Zustand": "Gebraucht"}) == "Gebraucht"
    assert _extract_condition({"ZUSTAND": "Neu"}) == "Neu"
    assert _extract_condition({"Farbe": "Rot"}) is None
    assert _extract_condition({}) is None


# ---------------------------------------------------------------------------
# KleinanzeigenAPIProvider -- sort_type / location policy / error wrapping
# ---------------------------------------------------------------------------


class _FakeListing:
    """Stand-in for kleinanzeigen_api.Listing -- avoids depending on the real dataclass shape."""

    def __init__(
        self,
        title: str,
        price: float | None,
        url: str,
        city: str | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> None:
        self.title = title
        self.price = price
        self.url = url
        self.city = city
        self.attributes = attributes or {}


class _FakeKleinanzeigenClient:
    """Stand-in for kleinanzeigen_api.KleinanzeigenAPI's `.search()` call shape."""

    def __init__(self, listings: list[Any] | None = None, error: Exception | None = None) -> None:
        self._listings = listings or []
        self._error = error
        self.last_kwargs: dict[str, Any] | None = None

    def search(self, **kwargs: Any) -> list[Any]:
        self.last_kwargs = kwargs
        if self._error is not None:
            raise self._error
        return self._listings


def test_kleinanzeigen_api_provider_uses_date_descending_sort_and_nationwide_location() -> None:
    """Decision #1 and #2 from the spike review: sort_type and location policy."""
    fake_client = _FakeKleinanzeigenClient(listings=[])
    provider = KleinanzeigenAPIProvider(client=fake_client)

    provider.search("desk lamp")

    kwargs = fake_client.last_kwargs
    assert kwargs is not None
    assert kwargs["sort_type"] == "DATE_DESCENDING"
    assert kwargs["sort_type"] != "PRICE_ASCENDING"
    assert kwargs["location"] is None
    assert kwargs["q"] == "desk lamp"


def test_kleinanzeigen_api_provider_parses_listing_objects_into_raw_dicts() -> None:
    fake_listing = _FakeListing(
        title="IKEA desk lamp",
        price=12.5,
        url="https://www.kleinanzeigen.de/s-anzeige/1",
        city="Munich",
        attributes={"Zustand": "Gebraucht"},
    )
    fake_client = _FakeKleinanzeigenClient(listings=[fake_listing])
    provider = KleinanzeigenAPIProvider(client=fake_client)

    results = provider.search("desk lamp")

    assert results == [
        {
            "title": "IKEA desk lamp",
            "price": 12.5,
            "url": "https://www.kleinanzeigen.de/s-anzeige/1",
            "condition": "Gebraucht",
            "location": "Munich",
        }
    ]


def test_kleinanzeigen_api_provider_wraps_value_error_from_bad_location() -> None:
    """An unresolvable location must not escape as a raw ValueError (decision #2)."""
    fake_client = _FakeKleinanzeigenClient(
        error=ValueError("Could not resolve location 'Nowhereville'.")
    )
    provider = KleinanzeigenAPIProvider(client=fake_client)

    with pytest.raises(ComparableSearchError):
        provider.search("desk lamp")


def test_kleinanzeigen_api_provider_wraps_network_error() -> None:
    fake_client = _FakeKleinanzeigenClient(error=RuntimeError("GET failed after 3 tries"))
    provider = KleinanzeigenAPIProvider(client=fake_client)

    with pytest.raises(ComparableSearchError):
        provider.search("desk lamp")


def test_kleinanzeigen_api_provider_does_not_construct_real_client_when_injected() -> None:
    """Injecting a fake client means the real kleinanzeigen_api package is never touched."""
    fake_client = _FakeKleinanzeigenClient(listings=[])
    provider = KleinanzeigenAPIProvider(client=fake_client)

    # Should not raise / attempt any network setup.
    results = provider.search("anything")
    assert results == []


# ---------------------------------------------------------------------------
# End-to-end: KleinanzeigenAPIProvider (fake client) -> service
# ---------------------------------------------------------------------------


def test_end_to_end_through_service_with_fake_kleinanzeigen_client() -> None:
    fake_listing = _FakeListing(
        title="Wooden chair",
        price=20.0,
        url="https://www.kleinanzeigen.de/s-anzeige/9",
        city="Cologne",
        attributes={"Zustand": "Gut"},
    )
    fake_client = _FakeKleinanzeigenClient(listings=[fake_listing])
    provider = KleinanzeigenAPIProvider(client=fake_client)
    service = ComparableListingSearchService(provider=provider)

    item = _make_item(keywords=["wooden chair"])
    ok = service.search_item(item)

    assert ok is True
    assert item.status == ItemStatus.PENDING_DECISION
    assert len(item.comparable_listings) == 1
    listing = item.comparable_listings[0]
    assert listing.title == "Wooden chair"
    assert listing.price == 20.0
    assert listing.condition == "Gut"
    assert listing.location == "Cologne"
