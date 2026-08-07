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
