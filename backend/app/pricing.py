"""Sell / give-away / throw-away decision engine.

Given an :class:`~app.models.Item` that has already been identified (see
``app/identification.py``) and searched for comparable listings (see
``app/comparable_search.py``, which populates
``Item.comparable_listings`` and advances ``Item.status`` to
``pending_decision``), this module computes a ``suggested_price`` and
classifies the item into one of :class:`~app.models.Decision`'s three
"real" outcomes (``sell``, ``give_away``, ``throw_away`` -- ``pending`` is
only ever the column default, never assigned by this module), then
advances ``Item.status`` to ``decided``.

This module is a *service*, not an HTTP endpoint -- wiring it into a
FastAPI route (and deciding when/how DB sessions get committed) is the
job of the pipeline-orchestration bead (``sandbox-yqf.9``). Callers are
expected to pass in an already-loaded ``Item`` ORM instance (with its
``comparable_listings`` relationship populated), call
``PricingDecisionService().decide_item(item)``, and then persist the
(mutated in place) item themselves (e.g. ``session.commit()``). This
mirrors the convention established by ``ItemIdentificationService``
(``app/identification.py``) and ``ComparableListingSearchService``
(``app/comparable_search.py``).

``suggested_price`` formula
----------------------------
``suggested_price`` is the **median** of the item's
``ComparableListing.price`` values, not the mean. Comparable-listing
prices scraped from a live marketplace are exactly the kind of skewed,
outlier-prone data the median is designed for -- a single wildly
overpriced "collector's item" listing (or a EUR1 "parts only, doesn't
work" listing) would drag a mean far away from what a typical buyer
would actually pay, while the median stays robust to it. This mirrors
the reasoning already given for using ``sort_type=DATE_DESCENDING`` (not
price-ascending) in ``app/comparable_search.py``: the goal both there and
here is a *representative* price signal, not a systematically biased one.
Python's ``statistics.median`` is used directly, which averages the two
middle values for an even-sized list -- the standard/unambiguous
definition of median, no bespoke tie-breaking logic needed.

Threshold configuration
------------------------
The sell/give-away boundary is governed by ``app.config.SELL_THRESHOLD``
(a single named config location -- see ``app/config.py`` for why it's a
placeholder value and why it's a plain module constant rather than
something more elaborate). This module always reads
``config.SELL_THRESHOLD`` via attribute access on the module
(``config.SELL_THRESHOLD``, not ``from app.config import SELL_THRESHOLD``)
specifically so tests (and any future runtime config reload) can
monkeypatch the module attribute and have this service observe the new
value on its very next call -- a ``from ... import NAME`` would bind a
local copy at import time that a monkeypatch of the config module
wouldn't reach.

Decision boundary logic (judgment calls made by this bead)
-------------------------------------------------------------
The bead spec leaves several boundary cases underspecified on purpose.
This is the precedence this module applies, evaluated top to bottom
(first matching rule wins):

1. **Condition == "broken" always wins, regardless of comparables.**
   If the item is broken/unusable, nobody should be given it and it's
   not worth listing for sale even if comparable *working* units sell
   for real money -- ``throw_away``. This directly matches the bead's
   own example: "comparables exist below threshold AND condition is
   broken -- throw_away should probably win".
2. **No comparables found at all -> throw_away.** The bead's ACTION
   section defines ``give_away`` as requiring "comparables exist at a
   low price" (2b) and defines ``throw_away`` as triggered by "no
   comparables found AND/OR condition indicates broken/unusable" (2c).
   Taking that spec literally: with zero comparables there is no market
   signal at all -- we don't know if the item is sellable, giveable, or
   worthless, and ``give_away`` is explicitly gated on comparables
   existing. Rather than silently guessing "it's probably fine, give it
   away", this module treats "no evidence this item has any current
   market" the same as "not worth keeping/handling further":
   ``throw_away``. (This is a placeholder-threshold-app-wide judgment
   call, not a claim that unsellable-and-unsearchable items are
   literally worthless -- flagged here in case a later bead wants a
   distinct "manual review" outcome for this case instead.)
3. **Median >= SELL_THRESHOLD -> sell.**
4. **Otherwise (comparables exist, median < SELL_THRESHOLD, condition
   not broken) -> give_away.** This is also the branch taken when
   ``Item.condition`` is ``None`` or ``"unknown"``: an unconfirmed
   condition is treated as usable/give-away-eligible rather than
   broken, since ``ItemIdentificationService`` already uses
   ``"unknown"`` to mean "the vision model wasn't sure what this even
   is" (see its module docstring), not "the vision model saw that this
   is broken". Defaulting an unknown condition to broken/throw_away
   would punish exactly the ambiguous-photo case that identification
   already treats as non-fatal, and a physically-present, uninspected
   item is far more often usable than not.

Condition matching is case-insensitive and whitespace-trimmed (mirroring
how ``ItemIdentificationService`` normalizes raw provider strings), so
``"Broken"``/``" broken "``/``"BROKEN"`` are all treated the same.
"""

from __future__ import annotations

import logging
import statistics
from typing import Sequence

from app import config
from app.models import ComparableListing, Decision, Item, ItemStatus

logger = logging.getLogger(__name__)

# The one condition value that unconditionally routes to throw_away
# regardless of comparable-listing data. See module docstring point 1.
_BROKEN_CONDITION = "broken"


def _median_price(comparable_listings: Sequence[ComparableListing]) -> float | None:
    """Return the median ``price`` across ``comparable_listings``, or ``None`` if empty.

    See module docstring "suggested_price formula" for why median (not
    mean) is used.
    """
    prices = [listing.price for listing in comparable_listings]
    if not prices:
        return None
    return statistics.median(prices)


def _is_broken(condition: str | None) -> bool:
    if condition is None:
        return False
    return condition.strip().lower() == _BROKEN_CONDITION


class PricingDecisionService:
    """Orchestrates pricing and sell/give-away/throw-away classification for an ``Item``.

    Pure business logic: does not touch a DB session, does not commit --
    it mutates the passed-in ``Item`` instance's attributes in place. The
    caller (the pipeline, in a later bead) owns the session lifecycle and
    decides when to commit -- this mirrors ``ItemIdentificationService``
    and ``ComparableListingSearchService``.
    """

    def decide_item(self, item: Item) -> Decision:
        """Compute ``suggested_price``/``decision`` for ``item`` and update it in place.

        Always succeeds and never raises (there is no external call here
        to fail): reads ``item.comparable_listings`` and
        ``item.condition``, sets ``item.suggested_price``,
        ``item.decision``, and advances ``item.status`` to ``decided``.
        Returns the computed ``Decision`` for convenience.
        """
        median_price = _median_price(item.comparable_listings)
        broken = _is_broken(item.condition)

        if broken:
            decision = Decision.THROW_AWAY
        elif median_price is None:
            decision = Decision.THROW_AWAY
        elif median_price >= config.SELL_THRESHOLD:
            decision = Decision.SELL
        else:
            decision = Decision.GIVE_AWAY

        logger.info(
            "Decision for item id=%s: median_price=%r condition=%r broken=%s "
            "sell_threshold=%r -> %s",
            getattr(item, "id", None),
            median_price,
            item.condition,
            broken,
            config.SELL_THRESHOLD,
            decision.value,
        )

        item.suggested_price = median_price
        item.decision = decision
        item.status = ItemStatus.DECIDED
        return decision
