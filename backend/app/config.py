"""Central place for app-wide tunable configuration values.

Deliberately a plain module of module-level constants (not a
``pydantic-settings``/``BaseSettings`` class, not environment-variable
driven) because this app is single-user/local with a handful of knobs so
far -- see ``app/db.py`` and ``app/models.py`` for the same
"simplest thing that works for a personal local app" philosophy applied
to persistence. If/when this app grows real per-deployment configuration
needs (e.g. multiple environments, secrets), this is the place to
introduce something like ``pydantic-settings`` -- not before.

Values here are read by ``app/pricing.py`` (bead ``sandbox-yqf.8``) at
call time (module-level attribute access, not copied into defaults at
import time elsewhere), so tests can monkeypatch e.g.
``app.config.SELL_THRESHOLD`` and have the decision engine pick up the
change immediately.
"""

from __future__ import annotations

# Minimum median comparable-listing price (EUR) at which an item is
# recommended for `sell` rather than `give_away`.
#
# THIS IS A PLACEHOLDER (per the project epic's flagged assumption #2):
# EUR10 was picked as a plausible "not worth the hassle of listing/
# meeting a buyer for less than this" cutoff, not from any real data.
# Expect to revisit/tune this once the app has been used for a while.
SELL_THRESHOLD: float = 10.0

# Minimum comparable-listing price (EUR) below which a listing is excluded
# from the pricing median (see ``app.pricing.is_usable_comparable``).
#
# THIS IS A PLACEHOLDER, same convention as ``SELL_THRESHOLD`` above: EUR2
# was picked as a plausible floor below which a listed price is almost
# certainly a placeholder/typo (e.g. a "VB" listing that still had to put
# some nonzero number in the price field) rather than a genuine asking
# price, not derived from any real data. Expect to revisit/tune this once
# the app has been used for a while.
MIN_COMPARABLE_PRICE: float = 2.0

# Minimum number of *usable* comparable listings (per
# ``app.pricing.is_usable_comparable``) required for a decision to be
# tagged ``Item.decision_confidence == "high"``. Below this count the
# decision is still made (the median/decision logic is unchanged) but is
# flagged ``"low"`` since it rests on too little market evidence.
#
# THIS IS A PLACEHOLDER, same convention as ``SELL_THRESHOLD``/
# ``MIN_COMPARABLE_PRICE`` above: 3 was picked as a plausible "at least a
# few independent data points" floor, not derived from any real data.
# Expect to revisit/tune this once the app has been used for a while.
MIN_COMPARABLES_FOR_CONFIDENCE: int = 3
