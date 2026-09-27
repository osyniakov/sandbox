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
    _BROKEN_LISTING_TERMS,
    ComparableListingSearchService,
    ComparableSearchError,
    KleinanzeigenAPIProvider,
    _build_query,
    _build_query_attempts,
    _extract_condition,
    _extract_is_wanted,
    _extract_price_type,
    _filter_broken_listing_titles,
    _is_relevant,
    _listing_to_raw,
    _parse_listings,
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
        self.exclude_calls: list[list[str] | None] = []

    def search(self, query: str, exclude: list[str] | None = None) -> list[dict[str, Any]]:
        self.calls.append(query)
        self.exclude_calls.append(exclude)
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _make_item(
    keywords: list[str] | None = None,
    condition: str | None = None,
    identified_name: str | None = None,
    brand: str | None = None,
) -> Item:
    # Mirrors the identification tests: set status explicitly since column
    # defaults only apply on flush/insert, not bare construction.
    return Item(
        photo_path="/photos/item.jpg",
        status=ItemStatus.PENDING_SEARCH,
        search_keywords=keywords if keywords is not None else ["desk lamp", "ikea"],
        condition=condition,
        identified_name=identified_name,
        brand=brand,
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
    assert item.search_query_used == "desk lamp ikea"
    assert len(item.comparable_listings) == 2

    listing = item.comparable_listings[0]
    assert isinstance(listing, ComparableListing)
    assert listing.title == "IKEA desk lamp, works fine"
    assert listing.price == 10.0
    assert listing.url == "https://www.kleinanzeigen.de/s-anzeige/1"
    assert listing.condition == "Gebraucht"
    assert listing.location == "Berlin"
    assert listing.price_type is None

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
    # All attempts exhausted with zero results: search_query_used reflects
    # the LAST (loosest) candidate query that was tried, not the original
    # joined query -- consistent with "here's exactly what was searched".
    assert item.search_query_used == "ikea"


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
    # search_query_used must reflect the NARROWER query that actually
    # succeeded ("desk lamp"), not the original joined query ("desk lamp
    # ikea silver") that returned zero results.
    assert item.search_query_used == "desk lamp"


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
    # No query was ever attempted, so search_query_used stays None.
    assert item.search_query_used is None


def test_none_keywords_treated_as_zero_results() -> None:
    item = Item(photo_path="/photos/item.jpg", status=ItemStatus.PENDING_SEARCH, search_keywords=None)
    provider = _StubProvider(responses=[])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert item.comparable_listings == []
    assert item.status == ItemStatus.PENDING_DECISION
    assert provider.calls == []
    assert item.search_query_used is None


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
    # Even on outright failure, the failing query is recorded for debug
    # context alongside the search_failed status.
    assert item.search_query_used == "desk lamp ikea"


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
        price_type: Any = None,
    ) -> None:
        self.title = title
        self.price = price
        self.url = url
        self.city = city
        self.attributes = attributes or {}
        self.price_type = price_type


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


# ---------------------------------------------------------------------------
# price_type / is_wanted extraction
# ---------------------------------------------------------------------------


class _ObjectWithoutPriceType:
    """A listing-like object that has no ``price_type`` attribute at all."""


class _EnumLikeValue:
    """Stand-in for an enum member exposing ``.value`` (defensive case)."""

    def __init__(self, value: str) -> None:
        self.value = value


class _EnumLikeName:
    """Stand-in for an enum member exposing only ``.name`` (defensive case)."""

    def __init__(self, name: str) -> None:
        self.name = name


def test_extract_price_type_plain_string_is_stored_verbatim_stripped() -> None:
    listing = _FakeListing(title="t", price=1.0, url="u", price_type="  SPECIFIED_AMOUNT  ")
    assert _extract_price_type(listing) == "SPECIFIED_AMOUNT"


def test_extract_price_type_handles_real_observed_values_verbatim() -> None:
    # Real kleinanzeigen_api 0.4.0 values: SPECIFIED_AMOUNT, PLEASE_CONTACT (VB), FREE.
    for value in ("SPECIFIED_AMOUNT", "PLEASE_CONTACT", "FREE"):
        listing = _FakeListing(title="t", price=1.0, url="u", price_type=value)
        assert _extract_price_type(listing) == value


def test_extract_price_type_enum_like_object_uses_value() -> None:
    listing = _FakeListing(title="t", price=1.0, url="u", price_type=_EnumLikeValue("FREE"))
    assert _extract_price_type(listing) == "FREE"


def test_extract_price_type_enum_like_object_falls_back_to_name() -> None:
    listing = _FakeListing(title="t", price=1.0, url="u", price_type=_EnumLikeName("FREE"))
    assert _extract_price_type(listing) == "FREE"


def test_extract_price_type_missing_attribute_returns_none() -> None:
    assert _extract_price_type(_ObjectWithoutPriceType()) is None


def test_extract_price_type_none_returns_none() -> None:
    listing = _FakeListing(title="t", price=1.0, url="u", price_type=None)
    assert _extract_price_type(listing) is None


def test_extract_price_type_empty_or_whitespace_returns_none() -> None:
    for value in ("", "   "):
        listing = _FakeListing(title="t", price=1.0, url="u", price_type=value)
        assert _extract_price_type(listing) is None


def test_extract_is_wanted_returns_none_when_no_ad_type_field() -> None:
    # The real kleinanzeigen_api 0.4.0 Listing dataclass has no ad-type field
    # on returned listings at all (only as a search/create parameter).
    listing = _FakeListing(title="t", price=1.0, url="u")
    assert _extract_is_wanted(listing) is None
    assert _extract_is_wanted(_ObjectWithoutPriceType()) is None


class _ListingWithAdType(_FakeListing):
    def __init__(self, *args: Any, ad_type: Any = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.ad_type = ad_type


def test_extract_is_wanted_true_when_ad_type_is_wanted() -> None:
    listing = _ListingWithAdType(title="t", price=1.0, url="u", ad_type="WANTED")
    assert _extract_is_wanted(listing) is True


def test_extract_is_wanted_false_when_ad_type_is_offered() -> None:
    listing = _ListingWithAdType(title="t", price=1.0, url="u", ad_type="OFFERED")
    assert _extract_is_wanted(listing) is False


def test_listing_to_raw_includes_price_type_and_is_wanted_keys() -> None:
    listing = _FakeListing(title="t", price=1.0, url="u", price_type="FREE")
    raw = _listing_to_raw(listing)
    assert raw["price_type"] == "FREE"
    assert raw["is_wanted"] is None


# ---------------------------------------------------------------------------
# _parse_listings -- price_type storage
# ---------------------------------------------------------------------------


def test_parse_listings_stores_stripped_price_type() -> None:
    raw_results = [
        {
            "title": "Item",
            "price": 5.0,
            "url": "https://x/1",
            "price_type": "  SPECIFIED_AMOUNT  ",
        }
    ]
    listings = _parse_listings(raw_results)
    assert len(listings) == 1
    assert listings[0].price_type == "SPECIFIED_AMOUNT"


def test_parse_listings_stores_none_price_type_when_missing_or_blank() -> None:
    raw_results = [
        {"title": "A", "price": 5.0, "url": "https://x/1"},
        {"title": "B", "price": 5.0, "url": "https://x/2", "price_type": "   "},
        {"title": "C", "price": 5.0, "url": "https://x/3", "price_type": None},
    ]
    listings = _parse_listings(raw_results)
    assert len(listings) == 3
    assert all(listing.price_type is None for listing in listings)


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
        price_type="SPECIFIED_AMOUNT",
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
            "price_type": "SPECIFIED_AMOUNT",
            "is_wanted": None,
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
    assert listing.price_type is None


# ---------------------------------------------------------------------------
# Excluding defekt/Bastler/Ersatzteile listings (bead sandbox-8jm.4)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "condition",
    ["good", "fair", "Good", " fair ", None, "broken", "Broken", " BROKEN "],
)
def test_search_item_never_passes_exclude_to_provider(condition: str | None) -> None:
    """bead sandbox-0as: the service never forwards `exclude=` to the
    provider any more, regardless of the item's own condition -- see module
    docstring "Excluding defekt/Bastler/Ersatzteile listings" for why
    (the underlying library applies it as a substring match against title
    AND description, silently dropping good negated listings)."""
    item = _make_item(keywords=["lamp"], condition=condition)
    provider = _StubProvider(responses=[[]])
    service = ComparableListingSearchService(provider=provider)

    service.search_item(item)

    assert provider.exclude_calls == [None]


def test_filter_broken_listing_titles_drops_defekt_title() -> None:
    raw_results = [
        {"title": "Akkuschrauber DEFEKT", "price": 5.0, "url": "https://x/1"},
        {"title": "Akkuschrauber, funktioniert einwandfrei", "price": 40.0, "url": "https://x/2"},
    ]
    filtered = _filter_broken_listing_titles(raw_results)
    assert len(filtered) == 1
    assert filtered[0]["title"] == "Akkuschrauber, funktioniert einwandfrei"


def test_filter_broken_listing_titles_case_insensitive_for_all_terms() -> None:
    raw_results = [
        {"title": "Nur Bastler, keine Garantie", "price": 1.0, "url": "https://x/1"},
        {"title": "Nur ERSATZTEILE, Restposten", "price": 2.0, "url": "https://x/2"},
        {"title": "Gut erhalten, funktioniert", "price": 30.0, "url": "https://x/3"},
    ]
    filtered = _filter_broken_listing_titles(raw_results)
    assert len(filtered) == 1
    assert filtered[0]["title"] == "Gut erhalten, funktioniert"


def test_filter_broken_listing_titles_ignores_missing_or_non_string_title() -> None:
    raw_results = [
        {"title": None, "price": 5.0, "url": "https://x/1"},
        {"price": 5.0, "url": "https://x/2"},
    ]
    filtered = _filter_broken_listing_titles(raw_results)
    assert filtered == raw_results


@pytest.mark.parametrize(
    "title",
    [
        "Akkuschrauber defekt",
        "Bastlerstück Bohrmaschine",
        "Ersatzteile Rasenmäher",
        "Nicht defekt, aber Ersatzteile fehlen",
        "defekt? nicht wirklich",
    ],
)
def test_filter_broken_listing_titles_drops_unnegated_terms(title: str) -> None:
    raw_results = [{"title": title, "price": 5.0, "url": "https://x/1"}]
    assert _filter_broken_listing_titles(raw_results) == []


@pytest.mark.parametrize(
    "title",
    [
        "Akkuschrauber, nicht defekt",
        "Kein Bastlerartikel – voll funktionsfähig",
        "Bohrmaschine defektfrei",
        "Ohne Defekt, top Zustand",
        "nicht mal defekt",
    ],
)
def test_filter_broken_listing_titles_keeps_negated_terms(title: str) -> None:
    raw_results = [{"title": title, "price": 30.0, "url": "https://x/1"}]
    assert _filter_broken_listing_titles(raw_results) == raw_results


def test_all_results_dropped_by_broken_filter_triggers_query_loosening() -> None:
    """A non-broken item whose first (joined) query returns ONLY
    defekt/Bastler/Ersatzteile-titled listings must be treated as a
    zero-result query -- the service should keep loosening to the next
    candidate query rather than accepting the (would-be-empty-after-filter)
    result set as final.
    """
    item = _make_item(keywords=["akkuschrauber", "bosch"], condition="good")
    junk_results = [
        {"title": "Akkuschrauber DEFEKT", "price": 5.0, "url": "https://x/1"},
        {"title": "Akkuschrauber Ersatzteile", "price": 3.0, "url": "https://x/2"},
    ]
    good_results = [
        {"title": "Bosch Akkuschrauber, funktioniert", "price": 35.0, "url": "https://x/3"},
    ]
    provider = _StubProvider(responses=[junk_results, good_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert provider.calls == ["akkuschrauber bosch", "akkuschrauber"]
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Bosch Akkuschrauber, funktioniert"


def test_kleinanzeigen_api_provider_forwards_exclude_to_client() -> None:
    fake_client = _FakeKleinanzeigenClient(listings=[])
    provider = KleinanzeigenAPIProvider(client=fake_client)

    provider.search("desk lamp", exclude=list(_BROKEN_LISTING_TERMS))

    assert fake_client.last_kwargs is not None
    assert fake_client.last_kwargs["exclude"] == list(_BROKEN_LISTING_TERMS)


def test_kleinanzeigen_api_provider_omits_exclude_when_none() -> None:
    fake_client = _FakeKleinanzeigenClient(listings=[])
    provider = KleinanzeigenAPIProvider(client=fake_client)

    provider.search("desk lamp", exclude=None)

    assert fake_client.last_kwargs is not None
    assert "exclude" not in fake_client.last_kwargs


def test_search_item_end_to_end_keeps_negated_drops_unnegated() -> None:
    """bead sandbox-0as end-to-end: a "nicht defekt" listing survives the
    search while a genuinely "defekt" one is dropped, with no `exclude=`
    ever reaching the provider."""
    item = _make_item(keywords=["akkuschrauber"], condition="good")
    raw_results = [
        {"title": "Akkuschrauber, nicht defekt", "price": 35.0, "url": "https://x/1"},
        {"title": "Akkuschrauber defekt", "price": 5.0, "url": "https://x/2"},
    ]
    provider = _StubProvider(responses=[raw_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert provider.exclude_calls == [None]
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Akkuschrauber, nicht defekt"


# ---------------------------------------------------------------------------
# Relevance-gating single-keyword fallback results (bead sandbox-8jm.5)
# ---------------------------------------------------------------------------


def test_build_query_attempts_skips_brand_only_keyword_case_insensitively() -> None:
    assert _build_query_attempts(
        ["bosch akkuschrauber", "bosch"], brand="Bosch"
    ) == ["bosch akkuschrauber bosch", "bosch akkuschrauber"]
    assert _build_query_attempts(
        ["bosch akkuschrauber", "BOSCH"], brand="  bosch  "
    ) == ["bosch akkuschrauber BOSCH", "bosch akkuschrauber"]


def test_build_query_attempts_without_brand_keeps_brand_named_keyword() -> None:
    # No `brand` passed -> existing pre-sandbox-8jm.5 behavior, unchanged.
    assert _build_query_attempts(["bosch akkuschrauber", "bosch"]) == [
        "bosch akkuschrauber bosch",
        "bosch akkuschrauber",
        "bosch",
    ]


def test_build_query_attempts_brand_none_does_not_filter_anything() -> None:
    assert _build_query_attempts(["lamp", "ikea"], brand=None) == [
        "lamp ikea",
        "lamp",
        "ikea",
    ]


def test_is_relevant_matches_name_token_substring_in_title() -> None:
    assert _is_relevant(
        "Akkuschrauber-Set 18V", identified_name="Bosch Akkuschrauber", brand="Bosch"
    ) is True


def test_is_relevant_rejects_title_with_no_matching_token() -> None:
    assert _is_relevant(
        "Bosch Geschirrspueler, gebraucht",
        identified_name="Bosch Akkuschrauber",
        brand="Bosch",
    ) is False


def test_is_relevant_ignores_brand_token() -> None:
    # Title contains "Bosch" (the brand) but nothing else from the name --
    # should NOT be considered relevant just because the brand matches.
    assert _is_relevant(
        "Bosch Buegeleisen", identified_name="Bosch Akkuschrauber", brand="Bosch"
    ) is False


def test_is_relevant_ignores_tokens_shorter_than_3_chars() -> None:
    # "42" (numeric) and "gr" are both < 3 or dropped as too short; only
    # "nike" and "laufschuhe" survive as usable tokens.
    assert _is_relevant(
        "Nike Laufschuhe, guter Zustand",
        identified_name="Nike Laufschuhe Gr. 42",
        brand=None,
    ) is True
    assert _is_relevant(
        "Voellig unrelated title ohne Marke",
        identified_name="Nike Laufschuhe Gr. 42",
        brand=None,
    ) is False


def test_is_relevant_no_identified_name_does_not_filter() -> None:
    assert _is_relevant("Anything at all", identified_name=None, brand="Bosch") is True
    assert _is_relevant("Anything at all", identified_name="", brand="Bosch") is True


def test_is_relevant_only_brand_token_does_not_filter() -> None:
    # identified_name is just the brand -> no usable tokens left -> cannot
    # judge -> must not filter.
    assert _is_relevant(
        "Totally unrelated title", identified_name="Bosch", brand="Bosch"
    ) is True


def test_is_relevant_umlaut_brand_only_name_does_not_filter() -> None:
    # Regression: re.split must be Unicode-aware, so "Märklin" tokenizes as
    # a single token (not split at "ä"), which then equals the casefolded
    # brand and is dropped -> no usable tokens -> cannot judge -> True.
    assert _is_relevant("Bohrer", identified_name="Märklin", brand="Märklin") is True


def test_is_relevant_umlaut_name_does_not_spuriously_match_via_split_fragment() -> None:
    # Regression: with the old ASCII-only split, "Kaffeemühle" would split
    # into ["kaffeem", "hle"], and "hle" would spuriously match inside
    # "Stühle". With a Unicode-aware split, "kaffeemühle" stays one token
    # and does not appear in "stühle 4 stück" at all.
    assert _is_relevant(
        "Stühle 4 Stück", identified_name="Kaffeemühle", brand=None
    ) is False


def test_is_relevant_umlaut_name_matches_genuine_title_substring() -> None:
    assert _is_relevant(
        "Alte Kaffeemühle Holz", identified_name="Kaffeemühle", brand=None
    ) is True


def test_is_relevant_umlaut_brand_excluded_but_other_token_still_checked() -> None:
    name = "Märklin Lokomotive"
    brand = "Märklin"
    # Title only echoes the brand ("Märklin"), not "Lokomotive" -> the
    # brand token is excluded, leaving only "lokomotive" as a usable token,
    # which is not present here -> irrelevant.
    assert _is_relevant("Märklin Schienen", identified_name=name, brand=brand) is False
    # Title contains "Lokomotive" -> relevant.
    assert _is_relevant(
        "Märklin Lokomotive BR 01", identified_name=name, brand=brand
    ) is True


def test_is_relevant_sharp_s_token_still_matches() -> None:
    # "ß" must stay inside its token (Unicode-aware split), not be treated
    # as a separator.
    assert _is_relevant(
        "Neue Straße gepflastert", identified_name="Straße", brand=None
    ) is True
    # sandbox-182: this used to assert False (plain casefolded-substring
    # check couldn't see past the diaeresis). Now that "plain" fold mode
    # (Größe -> "grosse" -- diaeresis dropped) is tried too, "Größe"
    # legitimately matches "Grosse" as a substring -- flipped to True.
    assert _is_relevant(
        "Grosse Wohnung, viele Zimmer", identified_name="Größe", brand=None
    ) is True


# ---------------------------------------------------------------------------
# German spelling-variant tolerance (bead sandbox-182): hyphen/space-split
# compounds, plurals, and umlaut digraph/plain folding.
# ---------------------------------------------------------------------------


def test_is_relevant_hyphenated_compound_matches_one_word_name() -> None:
    assert _is_relevant(
        "Makita Akku-Schrauber 18V", identified_name="Akkuschrauber", brand=None
    ) is True


def test_is_relevant_plural_name_matches_singular_title_and_vice_versa() -> None:
    assert _is_relevant(
        "Nike Laufschuh Gr. 42", identified_name="Laufschuhe", brand=None
    ) is True
    assert _is_relevant(
        "Laufschuhe Damen", identified_name="Laufschuh", brand=None
    ) is True


def test_is_relevant_umlaut_digraph_and_plain_spellings_both_match() -> None:
    assert _is_relevant(
        "Kaffeemuehle Zassenhaus", identified_name="Kaffeemühle", brand=None
    ) is True
    assert _is_relevant(
        "Kaffeemuhle alt", identified_name="Kaffeemühle", brand=None
    ) is True


def test_is_relevant_plural_ikea_lamp_matches_singular_title() -> None:
    assert _is_relevant(
        "IKEA Schreibtischlampe", identified_name="Schreibtischlampen", brand=None
    ) is True


def test_is_relevant_umlaut_name_still_rejects_unrelated_title() -> None:
    # Existing sandbox-8jm.5 regression must still hold with stemming added.
    assert _is_relevant(
        "Stühle 4 Stück", identified_name="Kaffeemühle", brand=None
    ) is False


def test_is_relevant_multiword_brand_tokens_excluded() -> None:
    brand = "Black & Decker"
    name = "Black & Decker Akkuschrauber"
    assert _is_relevant(
        "Black & Decker Staubsauger", identified_name=name, brand=brand
    ) is False
    assert _is_relevant(
        "Black+Decker Akkuschrauber 12V", identified_name=name, brand=brand
    ) is True
    # No usable tokens left once both brand words are excluded -> True.
    assert _is_relevant(
        "Totally unrelated title", identified_name="Black & Decker", brand=brand
    ) is True


def test_is_relevant_umlaut_h_insertion_known_limitation() -> None:
    # Known, accepted limitation (see module docstring / _destem docstring):
    # "Fön"/"Föhn" differ by an "h"-insertion, not an umlaut-fold or a
    # plural suffix -- out of scope, so this stays False.
    assert _is_relevant("Föhn", identified_name="Fön", brand=None) is False


def test_build_query_attempts_skips_multiword_brand_keyword_variants() -> None:
    brand = "Black & Decker"
    attempts = _build_query_attempts(
        ["black & decker", "Black+Decker", "black & decker akkuschrauber"],
        brand=brand,
    )
    assert "black & decker" not in attempts
    assert "Black+Decker" not in attempts
    assert "black & decker akkuschrauber" in attempts


def test_search_item_drops_irrelevant_fallback_results_and_continues_loosening() -> None:
    item = _make_item(
        keywords=["akkuschrauber", "werkzeug"],
        condition="good",
        identified_name="Bosch Akkuschrauber",
        brand="Bosch",
    )
    irrelevant_results = [
        {"title": "Bosch Geschirrspueler, gebraucht", "price": 180.0, "url": "https://x/1"},
        {"title": "Bosch Standmixer, funktioniert", "price": 45.0, "url": "https://x/2"},
    ]
    relevant_results = [
        {"title": "Akkuschrauber, kompatibel mit Bosch", "price": 20.0, "url": "https://x/3"},
    ]
    provider = _StubProvider(responses=[[], irrelevant_results, relevant_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    # Three candidate queries tried: joined (zero results), "akkuschrauber"
    # (attempt 2, all irrelevant -> dropped), "werkzeug" (attempt 3, one
    # relevant result kept).
    assert provider.calls == [
        "akkuschrauber werkzeug",
        "akkuschrauber",
        "werkzeug",
    ]
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Akkuschrauber, kompatibel mit Bosch"


def test_search_item_never_relevance_gates_the_joined_query() -> None:
    # Attempt 1 (the fully-joined query) must never be relevance-filtered,
    # even though none of its results share a token with identified_name.
    item = _make_item(
        keywords=["bosch akkuschrauber"],
        condition="good",
        identified_name="Bosch Akkuschrauber",
        brand="Bosch",
    )
    unrelated_but_kept = [
        {"title": "Voellig unrelated listing", "price": 15.0, "url": "https://x/1"},
    ]
    provider = _StubProvider(responses=[unrelated_but_kept])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert len(item.comparable_listings) == 1
    assert item.comparable_listings[0].title == "Voellig unrelated listing"


def test_search_item_no_identified_name_does_not_filter_fallback_results() -> None:
    item = _make_item(
        keywords=["akkuschrauber", "bosch"],
        condition="good",
        identified_name=None,
        brand="Bosch akku",  # not equal to fallback keyword "bosch"
    )
    zero_results: list[dict[str, Any]] = []
    kept_results = [
        {"title": "Anything, no relevance check applied", "price": 20.0, "url": "https://x/1"},
    ]
    provider = _StubProvider(responses=[zero_results, kept_results])
    service = ComparableListingSearchService(provider=provider)

    ok = service.search_item(item)

    assert ok is True
    assert len(item.comparable_listings) == 1
