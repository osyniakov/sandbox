"""Deterministic stub providers for Playwright/E2E pipeline testing.

This module exists **only** to let an end-to-end test drive the real
``run_pipeline``/``run_pipeline_with_new_session`` orchestration (see
``app/pipeline.py``) against a real, running backend process WITHOUT ever
making a real network call to Anthropic's API or to Kleinanzeigen. It is
gated entirely behind the ``E2E_STUB_PROVIDERS`` environment variable
(checked in ``app/pipeline.py``, see ``_e2e_stub_providers_enabled()``
there): when that env var is unset (the default -- including on Railway's
real backend/frontend services), this module is never imported at all
(``app/pipeline.py`` only imports it inside the branch gated on that env
var), so it has zero cost/risk to normal operation.

Design: per-scenario configuration via env vars, read at *call* time
------------------------------------------------------------------------
Each fake provider below reads its output from a small set of env vars at
call time (not at construction/import time). This lets a Playwright test
set exactly the env vars it needs (e.g. ``E2E_STUB_IDENTIFIED_NAME``,
``E2E_STUB_COMPARABLE_PRICES``) *before starting the backend process* for
that test scenario, without needing any per-request configuration channel
through the running server -- the backend process itself IS the
configuration surface. Sensible hardcoded defaults are used for any env
var a given test doesn't bother setting.

The three fakes
----------------
- ``FakeIdentificationProvider`` (implements
  ``app.identification.IdentificationProvider``): returns a name/category/
  condition from ``E2E_STUB_IDENTIFIED_NAME`` / ``E2E_STUB_CATEGORY`` /
  ``E2E_STUB_CONDITION`` (defaulting to "Test Item"/"misc"/"good"). Also
  honors the item's ``user_hint`` (if present) by appending
  ``f"hint:{hint}"`` to ``search_keywords``, so a hint-related E2E test can
  assert the hint was actually used.
- ``FakeComparableSearchProvider`` (implements
  ``app.comparable_search.ComparableSearchProvider``): returns a fixed
  number of deterministic comparable listings whose prices come from
  ``E2E_STUB_COMPARABLE_PRICES`` (comma-separated floats, e.g. "5,8,9"),
  defaulting to ``DEFAULT_COMPARABLE_PRICES``. These prices are what
  ultimately drive the SELL vs. GIVE_AWAY decision, via the existing,
  UNCHANGED ``app.config.SELL_THRESHOLD`` logic in ``app/pricing.py`` --
  this module makes no pricing decisions itself.
- ``FakeListingTextProvider`` (implements
  ``app.listing_text.ListingTextProvider``): always returns the same
  fixed, non-empty German title/description. Not configurable per-test --
  no known E2E scenario needs that; it just needs to exist and be
  non-empty so the frontend has something real to display/copy in
  SELL/GIVE_AWAY scenarios.
"""

from __future__ import annotations

import os
from typing import Any

# --- Env var names (single source of truth for E2E test authors) ----------
ENV_STUB_IDENTIFIED_NAME = "E2E_STUB_IDENTIFIED_NAME"
ENV_STUB_CATEGORY = "E2E_STUB_CATEGORY"
ENV_STUB_CONDITION = "E2E_STUB_CONDITION"
ENV_STUB_COMPARABLE_PRICES = "E2E_STUB_COMPARABLE_PRICES"

# --- Defaults used when a given env var isn't set --------------------------
DEFAULT_IDENTIFIED_NAME = "Test Item"
DEFAULT_CATEGORY = "misc"
DEFAULT_CONDITION = "good"
DEFAULT_COMPARABLE_PRICES: tuple[float, ...] = (12.0, 18.0, 25.0)

DEFAULT_LISTING_TITLE = "Gebrauchter Testartikel, gut erhalten"
DEFAULT_LISTING_DESCRIPTION = (
    "Dies ist ein Testartikel fuer automatisierte End-to-End-Tests. Der "
    "Artikel ist in ordentlichem Zustand und wird hier ausschliesslich zu "
    "Testzwecken beschrieben."
)


class FakeIdentificationProvider:
    """Deterministic, env-var-configurable ``IdentificationProvider`` stub.

    See module docstring. Never touches the network; never raises.
    """

    def identify(self, photo_path: str, hint: str | None = None) -> dict[str, Any]:
        name = os.environ.get(ENV_STUB_IDENTIFIED_NAME) or DEFAULT_IDENTIFIED_NAME
        category = os.environ.get(ENV_STUB_CATEGORY) or DEFAULT_CATEGORY
        condition = os.environ.get(ENV_STUB_CONDITION) or DEFAULT_CONDITION

        keywords = [name, category]
        if hint:
            # Echo the hint into search_keywords in a detectable way (a
            # fixed "hint:" prefix) so a hint-related E2E test can assert
            # the hint actually reached the identification result.
            keywords.append(f"hint:{hint}")

        return {
            "name": name,
            "category": category,
            "brand": None,
            "condition": condition,
            "search_keywords": keywords,
            "confidence": "high",
        }


def _stub_comparable_prices() -> list[float]:
    """Parse ``E2E_STUB_COMPARABLE_PRICES`` into a list of floats.

    Falls back to ``DEFAULT_COMPARABLE_PRICES`` if the env var is unset,
    empty, or contains no parseable numbers.
    """
    raw = os.environ.get(ENV_STUB_COMPARABLE_PRICES)
    if not raw or not raw.strip():
        return list(DEFAULT_COMPARABLE_PRICES)

    prices: list[float] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            prices.append(float(chunk))
        except ValueError:
            continue
    return prices or list(DEFAULT_COMPARABLE_PRICES)


class FakeComparableSearchProvider:
    """Deterministic, env-var-configurable ``ComparableSearchProvider`` stub.

    See module docstring. Never touches the network; never raises. Ignores
    ``query`` -- every call returns the same configured set of listings,
    regardless of which candidate query ``ComparableListingSearchService``
    is currently trying (see ``app/comparable_search.py``'s query-loosening
    logic, which is unaffected by this stub since the first call always
    succeeds with a non-empty result).
    """

    def search(self, query: str) -> list[dict[str, Any]]:
        prices = _stub_comparable_prices()
        return [
            {
                "title": f"E2E stub comparable listing #{index + 1}",
                "price": price,
                "url": f"https://example.invalid/e2e-stub-listing-{index + 1}",
                "condition": "good",
                "location": "Berlin",
            }
            for index, price in enumerate(prices)
        ]


class FakeListingTextProvider:
    """Fixed, non-empty German ``ListingTextProvider`` stub.

    See module docstring. Never touches the network; never raises.
    """

    def generate(self, item_info: dict[str, Any]) -> dict[str, Any]:
        return {
            "title": DEFAULT_LISTING_TITLE,
            "description": DEFAULT_LISTING_DESCRIPTION,
        }
