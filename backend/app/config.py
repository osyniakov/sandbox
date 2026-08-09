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
