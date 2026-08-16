"""Tests for the sell/give-away/throw-away decision engine (``app/pricing.py``)."""

from __future__ import annotations

from app import config
from app.models import ComparableListing, Decision, Item, ItemStatus
from app.pricing import PricingDecisionService


def _make_item(condition: str | None = "good", prices: list[float] | None = None) -> Item:
    # Mirrors the pattern in test_identification.py / test_comparable_search.py:
    # set status explicitly since column defaults only apply on flush/insert,
    # not on bare Python construction.
    item = Item(
        photo_path="/photos/item.jpg",
        status=ItemStatus.PENDING_DECISION,
        condition=condition,
    )
    item.comparable_listings = [
        ComparableListing(title=f"Listing {i}", price=price, url=f"https://example.com/{i}")
        for i, price in enumerate(prices or [])
    ]
    return item


def _make_item_with_listing_conditions(
    item_condition: str | None = "good",
    listings: list[tuple[float, str | None]] | None = None,
) -> Item:
    # Like _make_item, but lets each ComparableListing carry its own
    # (price, condition) pair -- needed to exercise _median_price's
    # new-condition filtering, which is per-listing, not per-item.
    item = Item(
        photo_path="/photos/item.jpg",
        status=ItemStatus.PENDING_DECISION,
        condition=item_condition,
    )
    item.comparable_listings = [
        ComparableListing(
            title=f"Listing {i}",
            price=price,
            url=f"https://example.com/{i}",
            condition=listing_condition,
        )
        for i, (price, listing_condition) in enumerate(listings or [])
    ]
    return item


# ---------------------------------------------------------------------------
# sell
# ---------------------------------------------------------------------------


def test_median_above_threshold_is_sell_with_exact_median() -> None:
    # prices: [5, 20, 25] -> median 20, well above the default threshold.
    item = _make_item(condition="good", prices=[5.0, 20.0, 25.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.SELL
    assert item.decision == Decision.SELL
    assert item.suggested_price == 20.0
    assert item.status == ItemStatus.DECIDED


def test_median_above_threshold_even_sized_list_averages_middle_two() -> None:
    # prices: [8, 12, 20, 40] -> median = (12 + 20) / 2 = 16.0
    item = _make_item(condition="fair", prices=[8.0, 12.0, 20.0, 40.0])

    PricingDecisionService().decide_item(item)

    assert item.suggested_price == 16.0
    assert item.decision == Decision.SELL


# ---------------------------------------------------------------------------
# give_away
# ---------------------------------------------------------------------------


def test_comparables_below_threshold_usable_condition_is_give_away() -> None:
    # prices: [2, 3, 4] -> median 3.0, below the default EUR10 threshold.
    item = _make_item(condition="fair", prices=[2.0, 3.0, 4.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.GIVE_AWAY
    assert item.decision == Decision.GIVE_AWAY
    assert item.suggested_price == 3.0
    assert item.status == ItemStatus.DECIDED


def test_unknown_condition_with_low_comparables_is_give_away_not_throw_away() -> None:
    # condition="unknown" is treated as usable/give_away-eligible, not
    # broken -- see module docstring point 4.
    item = _make_item(condition="unknown", prices=[1.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.GIVE_AWAY


def test_none_condition_with_low_comparables_is_give_away_not_throw_away() -> None:
    # condition=None (identification never ran / no confident guess) is
    # also treated as usable -- see module docstring point 4.
    item = _make_item(condition=None, prices=[1.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.GIVE_AWAY


# ---------------------------------------------------------------------------
# throw_away
# ---------------------------------------------------------------------------


def test_zero_comparables_is_throw_away() -> None:
    item = _make_item(condition="good", prices=[])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.THROW_AWAY
    assert item.decision == Decision.THROW_AWAY
    assert item.suggested_price is None
    assert item.status == ItemStatus.DECIDED


def test_broken_condition_is_throw_away_even_with_zero_comparables() -> None:
    item = _make_item(condition="broken", prices=[])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.THROW_AWAY
    assert item.suggested_price is None


def test_broken_condition_wins_even_with_high_value_comparables() -> None:
    # Bead's own example: comparables exist (and are even above the sell
    # threshold) but condition is broken -- throw_away should win.
    item = _make_item(condition="broken", prices=[50.0, 60.0, 70.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.THROW_AWAY
    # suggested_price is still recorded for informational purposes even
    # though the item is being thrown away.
    assert item.suggested_price == 60.0


def test_broken_condition_is_case_insensitive_and_trims_whitespace() -> None:
    item = _make_item(condition="  BROKEN  ", prices=[50.0])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.THROW_AWAY


# ---------------------------------------------------------------------------
# Threshold is genuinely read from config (not hardcoded)
# ---------------------------------------------------------------------------


def test_threshold_is_read_from_config_and_moving_it_moves_the_boundary(monkeypatch) -> None:
    # median = 5.0, which is give_away at the default SELL_THRESHOLD (10.0).
    item = _make_item(condition="good", prices=[5.0])
    decision_at_default = PricingDecisionService().decide_item(item)
    assert decision_at_default == Decision.GIVE_AWAY
    assert config.SELL_THRESHOLD == 10.0  # sanity-check the default is what we think it is

    # Lower the threshold below the same median: the same item should now
    # cross into sell. This proves the service reads config.SELL_THRESHOLD
    # live rather than a value baked in at import time.
    monkeypatch.setattr(config, "SELL_THRESHOLD", 4.0)
    item2 = _make_item(condition="good", prices=[5.0])
    decision_at_lower_threshold = PricingDecisionService().decide_item(item2)
    assert decision_at_lower_threshold == Decision.SELL


def test_threshold_boundary_is_inclusive_of_sell() -> None:
    # median exactly equal to the threshold should sell (>=), not give_away.
    item = _make_item(condition="good", prices=[config.SELL_THRESHOLD])

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.SELL


# ---------------------------------------------------------------------------
# new-condition comparable filtering (excludes brand-new listings from the
# median, since every item this app prices is an inherently used/secondhand
# good -- see _median_price/_is_new_condition in app/pricing.py).
# ---------------------------------------------------------------------------


def test_median_excludes_new_condition_comparables_mixed_with_used() -> None:
    # Listings: (5, "neu") excluded, (20, "gebraucht") and (30, "gut") kept
    # -> median of the surviving [20, 30] is 25.0, not the median of all
    # three ([5, 20, 30] -> 20.0).
    item = _make_item_with_listing_conditions(
        item_condition="good",
        listings=[(5.0, "neu"), (20.0, "gebraucht"), (30.0, "gut")],
    )

    decision = PricingDecisionService().decide_item(item)

    assert item.suggested_price == 25.0
    assert decision == Decision.SELL


def test_median_falls_back_to_full_list_when_all_comparables_are_new() -> None:
    # Every comparable is "new"-labeled -- filtering would leave zero
    # comparables, so _median_price must gracefully fall back to the full
    # unfiltered list rather than returning None (which would force an
    # unwanted throw_away).
    item = _make_item_with_listing_conditions(
        item_condition="good",
        listings=[(10.0, "neu"), (20.0, "brandneu"), (30.0, "new")],
    )

    decision = PricingDecisionService().decide_item(item)

    assert item.suggested_price == 20.0
    assert item.suggested_price is not None
    assert decision == Decision.SELL


def test_median_does_not_exclude_wie_neu_or_neuwertig_used_condition() -> None:
    # "wie neu" ("like new") and "neuwertig" ("as new") are common
    # Kleinanzeigen tiers meaning excellent-but-used condition, NOT
    # genuinely new -- they must NOT be excluded from the median. This is
    # the most important negative case for _is_new_condition.
    item = _make_item_with_listing_conditions(
        item_condition="good",
        listings=[(20.0, "wie neu"), (30.0, "neuwertig"), (40.0, "gut")],
    )

    decision = PricingDecisionService().decide_item(item)

    # None of the three listings are excluded -> median of [20, 30, 40] is 30.0.
    assert item.suggested_price == 30.0
    assert decision == Decision.SELL


def test_median_does_not_exclude_none_condition_comparables() -> None:
    # A comparable with condition=None (no condition data scraped) must
    # not be treated as "new" -- absence of data is not a "new" signal.
    item = _make_item_with_listing_conditions(
        item_condition="good",
        listings=[(20.0, None), (30.0, None)],
    )

    decision = PricingDecisionService().decide_item(item)

    assert item.suggested_price == 25.0
    assert decision == Decision.SELL


def test_broken_item_condition_still_throws_away_regardless_of_new_filtering() -> None:
    # item.condition == "broken" must still force throw_away even when the
    # item's comparables include (and, after filtering, are entirely) a
    # "new"-labeled listing -- new-condition filtering only ever applies to
    # comparable listings, never to the item's own condition/_is_broken.
    item = _make_item_with_listing_conditions(
        item_condition="broken",
        listings=[(50.0, "neu"), (60.0, "gut"), (70.0, "gebraucht")],
    )

    decision = PricingDecisionService().decide_item(item)

    assert decision == Decision.THROW_AWAY
    # suggested_price is still recorded (median of the non-new [60, 70]
    # comparables) for informational purposes even though thrown away.
    assert item.suggested_price == 65.0
