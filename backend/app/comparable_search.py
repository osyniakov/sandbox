"""Kleinanzeigen comparable-listings search service.

Given an :class:`~app.models.Item` that has already been identified (see
``app/identification.py``, which populates ``Item.search_keywords`` and
advances ``Item.status`` to ``pending_search``), this module searches
Kleinanzeigen for comparable listings and turns the results into
:class:`~app.models.ComparableListing` rows attached to the item, then
advances ``Item.status`` to ``pending_decision``.

This module is a *service*, not an HTTP endpoint -- wiring it into a
FastAPI route (and deciding when/how DB sessions get committed) is the job
of the pipeline-orchestration bead. Callers are expected to pass in an
already-loaded ``Item`` ORM instance, call
``ComparableListingSearchService().search_item(item)``, and then persist
the (mutated in place) item themselves (e.g. ``session.commit()``). This
mirrors the convention established by ``ItemIdentificationService`` in
``app/identification.py``.

Access method
-------------
Per the spike doc (``docs/kleinanzeigen-access.md``, bead
``sandbox-yqf.1``), this module talks to Kleinanzeigen through the
``kleinanzeigen-api`` PyPI package, which wraps the same unofficial
mobile-app JSON API (``api.kleinanzeigen.de``) that the official Android
app uses. It is not headless-browser automation and not raw HTML
scraping. That doc also carries an explicit legal/ToS caveat (Kleinanzeigen's
stated ToS forbid automated access; this is used read-only, at low,
personal-use volume, with the library's default rate limiting left
untouched) -- see the doc for the full risk discussion.

Two decisions from that spike's review, both implemented here and NOT to be
changed without revisiting the spike doc:

1. **sort_type = "DATE_DESCENDING"** (newest listings first), not
   ``"PRICE_ASCENDING"``. Sorting comparables by price-ascending biases a
   downstream median/suggested-price calculation low, since only the
   cheapest listings would ever be fetched when ``pages`` is kept small.
2. **location policy: nationwide (``location=None``).** ``Item`` currently
   has no location/postcode field, so there is no per-item location to
   search near. Rather than inventing one, this module always passes
   ``location=None`` to the underlying library, which (per its own
   docstring) searches all of Germany. This also sidesteps the library's
   documented failure mode where an *unresolvable* location string raises
   ``ValueError`` -- since we never pass a location string, that path is
   never hit in normal operation, but ``KleinanzeigenAPIProvider.search``
   still defensively catches ``ValueError`` (and any other exception) from
   the underlying call and converts it into a graceful
   :class:`ComparableSearchError`, in case a location is ever configured
   later.

Rate limiting
-------------
``KleinanzeigenAPIProvider`` constructs the underlying ``KleinanzeigenAPI``
client with its documented defaults (``rate_limit=1.5`` seconds between
requests plus jitter). Per the spike doc's guardrails, this module does not
lower or disable that rate limit, does not use the library's "frontier"
fast-watch mode, and does not use ``iter_new_ads()`` / any polling loop --
this app performs one-shot searches triggered by user action, not
continuous monitoring. ``pages`` is kept at 1 by default (a "handful of
searches per declutter session", not exhaustive/bulk scraping).

Failure vs. zero-results convention
------------------------------------
Mirrors the failure/ambiguity convention in ``app/identification.py``, but
the two outcomes that matter here are different:

1. **The call itself failed** (network error, timeout, non-2xx response, an
   unresolvable location, a response that can't be parsed, etc.). A
   provider signals this by raising :class:`ComparableSearchError` (or any
   other exception) out of ``search()``. The service retries **once**, and
   if the retry also fails, logs the error and sets ``Item.status`` to the
   terminal ``search_failed`` status. No exception ever propagates out of
   ``ComparableListingSearchService.search_item``.
2. **The call succeeded but found nothing** (a valid, well-formed empty
   result set -- e.g. a very obscure item, or an overly-specific keyword
   combination). This is *not* an error: it's useful signal for the
   downstream decision engine (bead ``sandbox-yqf.8``), which can treat
   "zero comparables found" as an input toward e.g. a throw-away/give-away
   recommendation. See "Query-loosening on zero results" below for what
   happens *before* we accept a zero-results outcome as final. Once
   accepted, the service returns an empty list of ``ComparableListing``
   rows and still advances ``Item.status`` to ``pending_decision``.

Query-loosening on zero results (bead sandbox-yqf.15)
-------------------------------------------------------
``app/identification.py``'s vision prompt asks for "2-5 short strings
suitable as search terms" -- i.e. independent *alternative* queries a
human might type one at a time, not a set of terms meant to be ANDed
together. But the most specific, most likely-to-match query is still the
fully-joined one, so that's tried first: ``_build_query_attempts`` builds
an ordered list of candidate queries, most specific first:

1. All keywords joined with spaces (``" ".join(keywords)``, same as the
   pre-sandbox-yqf.15 behavior and same as ``_build_query``).
2. If (and only if) that returns a **valid, zero-result** response, each
   keyword *individually*, in the order identification produced them
   (skipping any keyword identical to the already-tried joined query,
   e.g. when there's only one keyword). This -- rather than progressively
   trimming trailing keywords off the joined string -- was chosen because
   it matches how the keywords were actually generated (independent
   candidate terms), and because a query like "ikea schreibtischlampe
   lampe schreibtisch" trimmed to "ikea schreibtischlampe lampe" is still
   an AND of three terms and not meaningfully looser than the original.

The candidate-query list is capped at ``_MAX_QUERY_ATTEMPTS`` (currently
4: the joined query plus up to 3 individual keywords) so a long
``search_keywords`` list can never turn into an unbounded number of live
search calls. The service stops as soon as any candidate query returns
one or more results -- it does not keep searching for "better" results
once it has *some*.

**How this interacts with the existing failure-retry-once mechanism**
(``_MAX_SEARCH_ATTEMPTS`` / ``_search_with_retry``, below): these are two
independent, orthogonal retry axes and are not multiplied together.
``_search_with_retry`` is called once per *candidate query* in the
loosening sequence, and it alone owns "retry on hard failure" -- exactly
as before this bead, a single candidate query gets at most one failure
retry (``_MAX_SEARCH_ATTEMPTS = 2`` live calls total for that query). If
a candidate query comes back as a **hard failure** even after its own
retry, ``search_item`` does **not** treat that as "zero results, try a
looser query" -- it aborts the whole search immediately and returns
``False`` (``Item.status`` set to the terminal ``search_failed`` status),
exactly like the pre-existing single-query failure behavior (modulo the
new terminal status this bead introduces). Rationale: a definitive failure (e.g. the
provider/network is actually down) is very likely to fail again on the
next candidate query too, so treating it as a cue to loosen the query
would just burn more rate-limited calls without a realistic chance of
success, and would blur "the API is down" together with "the API is
fine but this item is genuinely obscure". Only a *successful* call that
returns zero results advances the loosening sequence; only an
*unsuccessful* call (exhausted its own retry) aborts the whole item.

This bounds the worst-case number of live provider calls per item at
``_MAX_QUERY_ATTEMPTS * _MAX_SEARCH_ATTEMPTS`` (4 * 2 = 8: every
candidate query hits one transient failure before succeeding with zero
results) -- never unbounded, and the module's existing rate limiting
(see "Rate limiting" above) is left untouched and still applies to every
one of those calls, since they all still go through the same
``ComparableSearchProvider.search`` / ``_search_with_retry`` path.

Excluding defekt/Bastler/Ersatzteile listings (bead sandbox-8jm.4)
--------------------------------------------------------------------
Per ``docs/kleinanzeigen-access.md`` section 4 step 2: "use ``exclude=[...]``
to filter obvious noise terms (e.g. "defekt", "bastler", "ersatzteile") if
the item is meant to be working." This module implements that as follows:

1. ``search_item`` determines whether the item's OWN condition is broken,
   reusing ``app.pricing.is_broken_condition`` (the same strip+lower ==
   "broken" normalization ``PricingDecisionService`` uses) rather than
   duplicating that logic or importing a private name across modules.
2. When the item is **not** broken, every candidate query in this item's
   query-loosening sequence is called with
   ``exclude=list(_BROKEN_LISTING_TERMS)`` (``("defekt", "bastler",
   "ersatzteile")``). When the item **is** broken, ``exclude=None`` is
   passed instead -- a defekt/Bastler/Ersatzteile listing IS a genuine
   comparable for a broken item, so it must not be excluded in that case.
3. ``KleinanzeigenAPIProvider.search`` forwards ``exclude`` to the
   underlying ``client.search`` call only when it's truthy, so calls made
   without it (e.g. for a broken item, or by any caller that never passes
   it) remain byte-identical to pre-sandbox-8jm.4 behavior. The installed
   ``kleinanzeigen-api`` 0.4.0's ``client.search`` accepts ``exclude`` as
   ``str | list[str] | None`` (normalized internally via its own
   ``_as_terms`` helper into lowercased terms, matched against title AND
   description) -- a ``list[str]`` is passed here.
4. Because the underlying library's ``exclude=`` filtering behavior is
   observed from the library's source but not independently verified
   end-to-end against the live API from this sandbox (kleinanzeigen.de is
   blocked by the sandbox's egress policy -- see "Manual smoke test"
   below), this module does NOT rely on it alone: for non-broken items,
   ``search_item`` also applies its own defensive post-filter
   (``_filter_broken_listing_titles``) to every raw result, dropping any
   listing whose ``title`` (casefolded) contains "defekt", "bastler", or
   "ersatzteile" as a substring -- BEFORE deciding whether that candidate
   query returned any usable results. If every result for a query is
   dropped by this filter, that query is treated exactly like a genuine
   zero-result response, and the existing query-loosening sequence (see
   above) continues to the next, looser candidate query.

Relevance-gating single-keyword fallback results (bead sandbox-8jm.5)
-----------------------------------------------------------------------
The individual-keyword fallback queries described above (attempt 2+ in
``_build_query_attempts``) are independent single terms, which can be much
less specific than the fully-joined query -- most notably when the
fallback keyword is just the item's brand name (e.g. "Bosch"), which
surfaces every Bosch-branded listing on the site (a dishwasher, a mixer,
an iron, ...) with no relationship to the actual item at all. This module
addresses that in two layers:

1. ``_build_query_attempts`` now accepts an optional ``brand: str | None``
   (default ``None``, so existing call sites/tests are unaffected). Any
   individual-keyword fallback candidate whose casefolded, stripped text
   equals the casefolded, stripped ``brand`` is skipped entirely -- it is
   never turned into a live search call. The fully-joined query (attempt
   1) is always kept regardless of ``brand``, since AND-ing the brand
   together with the rest of the identified name is exactly the specific,
   on-topic query we want.
2. For fallback candidates that DO get searched (attempt 2+), ``search_item``
   applies ``_is_relevant`` (see its docstring for the token-overlap
   algorithm) to each raw result's ``title``, dropping any result judged
   irrelevant to ``Item.identified_name``. This is applied AFTER the
   broken-title post-filter and BEFORE the zero-results/loosening decision:
   if every result for a fallback candidate is dropped, that candidate is
   treated exactly like a genuine zero-result response and the existing
   query-loosening sequence continues to the next, looser candidate query.
   This gate is intentionally never applied to the fully-joined query's
   results (attempt 1) -- that query is specific enough (all identification
   keywords ANDed together) that we trust whatever it returns.
   ``_is_relevant`` is deliberately conservative: when ``Item.identified_name``
   is missing, or has no tokens left after dropping short (<3 char) and
   brand-only tokens, it returns ``True`` (cannot judge -- do not filter)
   rather than guessing.

Manual smoke test against the LIVE Kleinanzeigen site
-------------------------------------------------------
All automated tests in ``tests/test_comparable_search.py`` use fixtures /
fake providers -- no real network calls are made and no live scraping
happens in CI. To manually verify this module still works against the
real, live ``api.kleinanzeigen.de`` (this cannot be run inside this
sandbox: kleinanzeigen.de / adevinta.com are blocked by the sandbox's
egress policy per the spike doc, so this must be run from an unrestricted
environment by whoever picks this up):

1. From ``backend/``, create/activate a venv and install dependencies:
   ``pip install -r requirements.txt`` (this pulls in ``kleinanzeigen-api``
   and its ``curl-cffi`` dependency).
2. Run a short one-off script -- do NOT add this as an automated pytest
   test, it hits the real network:

   .. code-block:: bash

       python3 -c "
       from app.comparable_search import KleinanzeigenAPIProvider
       provider = KleinanzeigenAPIProvider()
       results = provider.search('ikea schreibtischlampe')
       print(f'{len(results)} raw results')
       for r in results[:5]:
           print(r)
       "

3. Confirm a handful of listings come back, each as a dict with non-empty
   ``title``/``url``, a numeric (or ``None``) ``price``, and a German
   ``location`` (city) -- ``condition`` may legitimately be ``None`` for
   listings that don't set a "Zustand" attribute.
4. Confirm the call takes at least ~1.5s (library rate limiting engaging),
   not an instant response -- and that it does NOT hammer the endpoint
   with rapid repeated requests if you loop it.
5. Try an intentionally nonsense query (e.g. ``"zzzqqqxxxnonsense123"``) and
   confirm an empty list comes back rather than an exception.
6. Exercise the full service against a throwaway in-memory ``Item``:

   .. code-block:: bash

       python3 -c "
       from app.comparable_search import ComparableListingSearchService
       from app.models import Item, ItemStatus
       item = Item(photo_path='/tmp/x.jpg', status=ItemStatus.PENDING_SEARCH,
                   search_keywords=['ikea', 'schreibtischlampe'])
       ok = ComparableListingSearchService().search_item(item)
       print(ok, item.status, len(item.comparable_listings))
       for cl in item.comparable_listings[:3]:
           print(cl.title, cl.price, cl.url, cl.condition, cl.location)
       "

7. Keep this to a handful of manual runs, not a loop -- see
   ``docs/kleinanzeigen-access.md`` for the request-volume guardrails
   (personal/occasional use only).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Protocol, runtime_checkable

from app.models import ComparableListing, Item, ItemStatus
from app.pricing import is_broken_condition

logger = logging.getLogger(__name__)

# See module docstring "Two decisions from that spike's review" -- do not
# change either of these without revisiting docs/kleinanzeigen-access.md.
DEFAULT_SORT_TYPE = "DATE_DESCENDING"
DEFAULT_LOCATION = None  # None == search all of Germany (nationwide policy)

# Keep result volume modest per the spike doc's guardrails ("a handful of
# searches per declutter session, not bulk/scheduled scraping").
DEFAULT_PAGES = 1

# How many times the service will call the provider for a single *candidate
# query* before giving up on that query (1 initial attempt + 1 retry == 2
# total calls). See module docstring "Query-loosening on zero results" for
# how this interacts with the separate query-loosening retry axis.
_MAX_SEARCH_ATTEMPTS = 2

# Maximum number of distinct candidate queries tried per item (the
# fully-joined query plus progressively looser individual-keyword
# fallbacks), before accepting a zero-results outcome as final. See module
# docstring "Query-loosening on zero results".
_MAX_QUERY_ATTEMPTS = 4

# Attribute-dict label markers (case-insensitive substring match) used to
# find the "condition" attribute in a Listing's `attributes` dict. The
# underlying API returns *localized* attribute labels (German, e.g.
# "Zustand"), not a fixed key, so we match loosely rather than relying on
# an exact key.
_CONDITION_LABEL_MARKERS = ("zustand", "condition")

# Kleinanzeigen listing-title terms that mark a listing as broken/for-parts
# rather than a genuine working comparable -- "defekt" (defective/broken),
# "Bastler" (tinkerer/fixer-upper -- i.e. sold as-is for someone to repair),
# "Ersatzteile" (spare parts / parts-only). Per docs/kleinanzeigen-access.md
# section 4 step 2, these are excluded from comparable searches for items
# whose OWN condition is not itself broken, since a working item should not
# have its price benchmarked against junk/for-parts listings. See "Excluding
# defekt/Bastler/Ersatzteile listings" below for how this is used.
_BROKEN_LISTING_TERMS = ("defekt", "bastler", "ersatzteile")


class ComparableSearchError(Exception):
    """Raised by a ``ComparableSearchProvider`` when the underlying call fails.

    Covers network errors, timeouts, non-success API responses, unresolvable
    search arguments (e.g. a bad location), and responses that can't be
    parsed into the expected structure.
    """


@runtime_checkable
class ComparableSearchProvider(Protocol):
    """Interface for anything that can search for comparable listings.

    Implementations should raise (``ComparableSearchError`` or any other
    exception) on outright call failure rather than returning a sentinel
    value -- ``ComparableListingSearchService`` distinguishes "call failed"
    from "call succeeded with zero results" precisely via whether an
    exception was raised (see module docstring).
    """

    def search(self, query: str, exclude: list[str] | None = None) -> list[dict[str, Any]]:
        """Return raw listing dicts for ``query``, or raise on failure.

        ``exclude``, when provided, is a list of terms the provider should
        attempt to exclude from results (see "Excluding defekt/Bastler/
        Ersatzteile listings" in the module docstring). Implementations are
        not required to actually exclude anything -- ``search_item`` applies
        its own defensive title-based post-filter regardless, since the
        underlying provider's exclude semantics can't be relied on alone.

        Expected (but not strictly required) keys per dict: ``title``,
        ``price``, ``url``, ``condition``, ``location``. An empty list is a
        valid, successful return value meaning "no comparables found".
        """
        ...


class KleinanzeigenAPIProvider:
    """Default ``ComparableSearchProvider``, backed by the ``kleinanzeigen-api`` package.

    The underlying ``KleinanzeigenAPI`` client is created lazily (on first
    ``search()`` call, not at construction time) so importing/instantiating
    this class never requires the package to make any network calls or read
    environment credentials at import/construction time -- tests inject a
    fake ``client`` instead and never touch the real network.
    """

    def __init__(
        self,
        client: Any | None = None,
        sort_type: str = DEFAULT_SORT_TYPE,
        location: str | int | None = DEFAULT_LOCATION,
        distance_km: int | None = None,
        pages: int = DEFAULT_PAGES,
    ) -> None:
        self._client = client
        self._sort_type = sort_type
        self._location = location
        self._distance_km = distance_km
        self._pages = pages

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        # Imported lazily so the package is only required at runtime, and
        # so constructing this provider never requires network access.
        from kleinanzeigen_api import KleinanzeigenAPI

        # Deliberately use the library's own defaults for rate_limit /
        # max_retries -- see module docstring "Rate limiting". Do not pass
        # a lower rate_limit here.
        self._client = KleinanzeigenAPI()
        return self._client

    def search(self, query: str, exclude: list[str] | None = None) -> list[dict[str, Any]]:
        client = self._get_client()
        search_kwargs: dict[str, Any] = dict(
            location=self._location,
            q=query,
            sort_type=self._sort_type,
            pages=self._pages,
            distance_km=self._distance_km,
        )
        # Only pass `exclude` through when it's truthy, so calls without it
        # remain byte-identical to pre-sandbox-8jm.4 behavior (verified
        # against the installed kleinanzeigen-api 0.4.0: `client.search`
        # accepts `exclude` as a `str | list[str] | None`, normalizing via
        # its own `_as_terms` helper -- a list of str is passed here).
        if exclude:
            search_kwargs["exclude"] = exclude
        try:
            listings = client.search(**search_kwargs)
        except Exception as exc:
            # Covers, at minimum: ValueError (unresolvable location/bad
            # args -- see "location policy" in the module docstring) and
            # RuntimeError (network errors / non-2xx responses / exhausted
            # internal retries, as raised by kleinanzeigen_api.client).
            # Converted uniformly so callers never see a raw ValueError
            # escape from this method.
            raise ComparableSearchError(
                f"Kleinanzeigen search call failed for query={query!r}: {exc}"
            ) from exc

        return [_listing_to_raw(listing) for listing in listings]


def _listing_to_raw(listing: Any) -> dict[str, Any]:
    """Convert a ``kleinanzeigen_api.Listing`` (or listing-like object) into a raw dict."""
    attributes = getattr(listing, "attributes", None) or {}
    return {
        "title": getattr(listing, "title", None),
        "price": getattr(listing, "price", None),
        "url": getattr(listing, "url", None),
        "condition": _extract_condition(attributes),
        "location": getattr(listing, "city", None),
        "price_type": _extract_price_type(listing),
        "is_wanted": _extract_is_wanted(listing),
    }


def _extract_price_type(listing: Any) -> str | None:
    """Extract ``price_type`` from a listing, verbatim (stripped), or ``None``.

    The real ``kleinanzeigen_api.Listing.price_type`` (0.4.0) is a plain
    string copied raw from the API's "price-type" field -- real observed
    values are "SPECIFIED_AMOUNT", "PLEASE_CONTACT" (VB) and "FREE".
    "FIXED"/"NEGOTIABLE"/"GIVE_AWAY" are only create-ad *input* aliases and
    are never expected here. Handled defensively anyway: a plain str, an
    object exposing ``.value`` (enum-like), missing/None, or an
    empty/whitespace-only string all fall back to (or resolve into) verbatim
    stripped text, or ``None``. Aliases are never translated -- stored as-is.
    """
    raw_value = getattr(listing, "price_type", None)
    if raw_value is None:
        return None
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        return stripped or None
    value = getattr(raw_value, "value", None)
    if value is None:
        value = getattr(raw_value, "name", None)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _extract_is_wanted(listing: Any) -> bool | None:
    """Extract a wanted-ad signal from a listing, if the library exposes one.

    The installed ``kleinanzeigen_api`` 0.4.0 ``Listing`` dataclass has no
    ad-type field at all (``ad_type``/``adType`` only exist as *search/create*
    parameters, never as an attribute on a returned ``Listing`` instance).
    Defensively checked anyway in case a future version (or a listing-like
    object from elsewhere) adds one; returns ``None`` when no such field is
    present, so downstream code cannot mistake "unknown" for "not wanted".
    """
    for attr_name in ("ad_type", "adType"):
        if hasattr(listing, attr_name):
            raw_value = getattr(listing, attr_name)
            if raw_value is None:
                return None
            value = getattr(raw_value, "value", raw_value)
            if isinstance(value, str):
                return value.strip().upper() == "WANTED"
            return None
    return None


def _extract_condition(attributes: dict[str, Any]) -> str | None:
    for label, value in attributes.items():
        if not isinstance(label, str):
            continue
        if any(marker in label.lower() for marker in _CONDITION_LABEL_MARKERS):
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _build_query(keywords: list[str] | None) -> str:
    if not keywords:
        return ""
    cleaned = [kw.strip() for kw in keywords if isinstance(kw, str) and kw.strip()]
    return " ".join(cleaned)


def _build_query_attempts(keywords: list[str] | None, brand: str | None = None) -> list[str]:
    """Return the ordered list of candidate queries to try, most specific first.

    Attempt 1 is the fully-joined query (identical to ``_build_query`` --
    all keywords ANDed together, the pre-sandbox-yqf.15 behavior) -- this is
    always kept, regardless of ``brand``. Attempts 2+ are each remaining
    keyword tried *individually*, in order, skipping any keyword that's
    identical to a query already in the list (e.g. when there's only one
    keyword, so the joined query and that keyword alone are the same
    string -- retrying the identical query would be pointless), and (bead
    sandbox-8jm.5) also skipping any keyword whose casefolded, stripped text
    equals the casefolded, stripped ``brand`` -- a lone brand name (e.g.
    "Bosch") as a fallback query is almost guaranteed to surface completely
    unrelated same-brand products (a Bosch dishwasher, mixer, iron, ...)
    rather than anything comparable to the actual item, so it's not worth
    the live call. ``brand=None`` (the default, used by all existing call
    sites) disables this skip entirely, leaving pre-sandbox-8jm.5 behavior
    unchanged. Capped at ``_MAX_QUERY_ATTEMPTS`` total candidate queries
    (brand-skipped keywords don't count against this cap, since they're
    never added). See module docstring "Query-loosening on zero results"
    for the full rationale, and "Relevance-gating single-keyword fallback
    results" for the brand-skip rationale.

    Returns an empty list if there are no usable keywords at all (mirrors
    ``_build_query`` returning ``""`` in that case).
    """
    cleaned = [kw.strip() for kw in (keywords or []) if isinstance(kw, str) and kw.strip()]
    if not cleaned:
        return []

    casefolded_brand = brand.strip().casefold() if isinstance(brand, str) and brand.strip() else None

    attempts = [" ".join(cleaned)]
    for kw in cleaned:
        if len(attempts) >= _MAX_QUERY_ATTEMPTS:
            break
        if kw in attempts:
            continue
        if casefolded_brand is not None and kw.casefold() == casefolded_brand:
            logger.info(
                "Skipping brand-only fallback keyword %r (matches item brand %r)",
                kw,
                brand,
            )
            continue
        attempts.append(kw)
    return attempts


def _filter_broken_listing_titles(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Defensively drop raw results whose title contains a broken-listing term.

    See module docstring "Excluding defekt/Bastler/Ersatzteile listings".
    The underlying ``kleinanzeigen-api`` library's ``exclude=`` semantics
    are unverified from the outside (we can't be sure it's actually being
    applied server-side, or applied only to the title vs. also the
    description, etc.), so this is applied unconditionally as a defensive
    backstop for non-broken items, regardless of whether ``exclude`` was
    also passed to the provider. Matching is a case-folded substring check
    against the title only (not description -- raw dicts here don't carry
    one), mirroring how ``_BROKEN_LISTING_TERMS`` terms actually appear in
    real Kleinanzeigen titles (e.g. "Kaffeemaschine defekt, fuer Bastler").
    A missing/non-string title is never dropped by this filter (existing
    downstream skip-on-missing-title logic in ``_parse_listings`` already
    handles that case).
    """
    filtered: list[dict[str, Any]] = []
    for raw in raw_results:
        title = raw.get("title")
        if isinstance(title, str) and any(
            term in title.casefold() for term in _BROKEN_LISTING_TERMS
        ):
            logger.debug("Dropping broken-listing-term title raw=%r", raw)
            continue
        filtered.append(raw)
    return filtered


def _is_relevant(title: str, identified_name: str | None, brand: str | None) -> bool:
    r"""Return whether ``title`` plausibly refers to the same kind of item as ``identified_name``.

    See module docstring "Relevance-gating single-keyword fallback results"
    (bead sandbox-8jm.5). Builds a set of "name tokens" from
    ``identified_name``: casefolded, split on runs of non-alphanumeric
    characters (Unicode-aware, via ``re.split(r"[\W_]+", ...)``, so umlauts
    and ``ß`` stay inside a token instead of splitting it -- e.g.
    "Kaffeemühle" tokenizes as ["kaffeemühle"], not ["kaffeem", "hle"]),
    keeping only tokens of length >= 3 (drops short/noise
    tokens like "gr", "18", "v") that are not equal to the casefolded,
    stripped ``brand`` (a brand token alone tells us nothing about whether
    a *specific* listing is relevant -- that's the whole reason this gate
    exists).

    A title is relevant if ANY name token is a substring of the casefolded
    title -- checked in one direction only (name token inside title, e.g.
    token "akkuschrauber" matches title "Akkuschrauber-Set 18V"); the
    reverse (title token inside a name token) is deliberately NOT checked,
    since a long, precise ``identified_name`` token should not be
    considered "matched" merely because a short, generic title word happens
    to be a substring of it.

    If there are no usable name tokens at all (``identified_name`` is
    ``None``/empty, or every token was dropped as too short or brand-only),
    this returns ``True`` -- there's nothing to judge relevance against, so
    the gate must not filter anything out in that case.
    """
    if not identified_name:
        return True

    casefolded_brand = brand.strip().casefold() if isinstance(brand, str) and brand.strip() else None

    raw_tokens = re.split(r"[\W_]+", identified_name.casefold())
    name_tokens = [
        token
        for token in raw_tokens
        if len(token) >= 3 and token != casefolded_brand
    ]
    if not name_tokens:
        return True

    casefolded_title = title.casefold()
    return any(token in casefolded_title for token in name_tokens)


def _parse_listings(raw_results: list[dict[str, Any]]) -> list[ComparableListing]:
    """Turn raw listing dicts into ``ComparableListing`` ORM objects.

    Listings missing a usable title, url, or numeric price are skipped
    (logged at debug level) rather than raising, since ``ComparableListing``
    requires those columns to be non-null -- a single malformed upstream
    result shouldn't take down the whole search.
    """
    listings: list[ComparableListing] = []
    for raw in raw_results:
        title = raw.get("title")
        title = title.strip() if isinstance(title, str) else ""
        url = raw.get("url")
        url = url.strip() if isinstance(url, str) else ""
        price = raw.get("price")

        if not title or not url or price is None:
            logger.debug("Skipping unusable comparable listing raw=%r", raw)
            continue

        try:
            price_value = float(price)
        except (TypeError, ValueError):
            logger.debug("Skipping comparable listing with non-numeric price raw=%r", raw)
            continue

        raw_condition = raw.get("condition")
        condition = (
            raw_condition.strip() if isinstance(raw_condition, str) and raw_condition.strip() else None
        )
        raw_location = raw.get("location")
        location = (
            raw_location.strip() if isinstance(raw_location, str) and raw_location.strip() else None
        )
        raw_price_type = raw.get("price_type")
        price_type = (
            raw_price_type.strip() if isinstance(raw_price_type, str) and raw_price_type.strip() else None
        )

        listings.append(
            ComparableListing(
                title=title,
                price=price_value,
                url=url,
                condition=condition,
                location=location,
                price_type=price_type,
            )
        )
    return listings


class ComparableListingSearchService:
    """Orchestrates searching Kleinanzeigen for an ``Item``'s comparable listings.

    Pure business logic: does not touch a DB session, does not commit -- it
    mutates the passed-in ``Item`` instance's ``comparable_listings``
    relationship and ``status`` in place. The caller (the pipeline, in a
    later bead) owns the session lifecycle and decides when to commit --
    this mirrors ``ItemIdentificationService`` in ``app/identification.py``.
    """

    def __init__(self, provider: ComparableSearchProvider | None = None) -> None:
        self._provider = provider or KleinanzeigenAPIProvider()

    def search_item(self, item: Item) -> bool:
        """Search comparable listings for ``item`` and update it in place.

        Returns ``True`` if the search succeeded (including the valid
        "zero comparables found" outcome), in which case
        ``item.comparable_listings`` is (re)populated and ``item.status``
        advances to ``pending_decision``. Returns ``False`` if any
        candidate query's underlying provider call failed on both its
        initial attempt and its one retry, in which case ``item.status``
        is set to the terminal ``search_failed`` status -- see module
        docstring "Query-loosening on zero results" for exactly how the
        query-loosening and failure-retry axes interact.

        Never raises: provider failures are caught, logged via the
        standard ``logging`` module, and reported through the return value
        rather than propagating.
        """
        query_attempts = _build_query_attempts(item.search_keywords, brand=item.brand)
        item_id = getattr(item, "id", None)
        # Reuse pricing's condition normalization (see module docstring
        # "Excluding defekt/Bastler/Ersatzteile listings") -- an item whose
        # own condition is NOT broken should not have junk/for-parts
        # listings polluting its comparable search; a genuinely broken item
        # should, since those listings ARE comparable to it.
        broken = is_broken_condition(item.condition)
        exclude = None if broken else list(_BROKEN_LISTING_TERMS)

        if not query_attempts:
            # No usable keywords to search with (e.g. identification fell
            # back to nothing usable). Not the provider's fault, and not a
            # reason to halt the pipeline -- treat as "zero comparables
            # found" so the decision engine still has something to act on.
            logger.warning(
                "No usable search keywords for item id=%s; treating as zero comparable results",
                item_id,
            )
            item.comparable_listings = []
            item.search_query_used = None
            item.status = ItemStatus.PENDING_DECISION
            return True

        raw_results: list[dict[str, Any]] = []
        for attempt_num, query in enumerate(query_attempts, start=1):
            raw_results = self._search_with_retry(query, item_id=item_id, exclude=exclude)
            if raw_results is None:
                # This candidate query failed outright (exhausted its own
                # failure-retry) -- abort the whole search rather than
                # treating the failure as a cue to try a looser query. See
                # module docstring "Query-loosening on zero results". Still
                # record the failing query for debug context, matching the
                # search_failed error message the frontend already shows
                # (sandbox-khm.2).
                item.search_query_used = query
                item.status = ItemStatus.SEARCH_FAILED
                return False
            if not broken:
                # Defensive backstop regardless of whether the provider
                # actually honored `exclude` -- see module docstring
                # "Excluding defekt/Bastler/Ersatzteile listings". Applied
                # BEFORE deciding whether this query returned results, so an
                # all-junk result set is treated as zero results and the
                # loosening sequence continues, exactly like a genuine
                # zero-result response.
                raw_results = _filter_broken_listing_titles(raw_results)
            if attempt_num >= 2:
                # Relevance-gate individual-keyword fallback candidates only
                # (never the fully-joined query's results) -- see module
                # docstring "Relevance-gating single-keyword fallback
                # results". Applied AFTER the broken-title post-filter and
                # BEFORE the zero-results/loosening decision below, so an
                # all-irrelevant result set is treated exactly like a
                # genuine zero-result response and the loosening sequence
                # continues to the next, looser candidate query.
                before_count = len(raw_results)
                raw_results = [
                    raw
                    for raw in raw_results
                    if not isinstance(raw.get("title"), str)
                    or _is_relevant(raw["title"], item.identified_name, item.brand)
                ]
                dropped_count = before_count - len(raw_results)
                if dropped_count:
                    logger.info(
                        "Dropped %d/%d fallback result(s) for item id=%s query=%r "
                        "(attempt %d/%d) as irrelevant to identified_name=%r",
                        dropped_count,
                        before_count,
                        item_id,
                        query,
                        attempt_num,
                        len(query_attempts),
                        item.identified_name,
                    )
            if raw_results:
                # Found at least one result -- stop loosening immediately,
                # don't keep searching for a "better" result set.
                break
            logger.info(
                "Comparable-listing search for item id=%s query=%r (attempt %d/%d) "
                "returned zero results%s",
                item_id,
                query,
                attempt_num,
                len(query_attempts),
                "; trying a looser query" if attempt_num < len(query_attempts) else "; giving up, zero results",
            )

        # ``query`` retains the loop variable's last-assigned value here,
        # whether the loop exited via `break` on a successful (non-empty)
        # result -- in which case it's the query that actually found
        # something -- or ran to completion after every candidate query
        # returned zero results -- in which case it's the last (loosest)
        # query tried. Both cases are exactly what a user wants to see:
        # "this is the query that was searched". Python's `for` loop does
        # not create a new scope, so the loop variable is simply still
        # bound to its final value here (this is standard, guaranteed
        # Python behavior, not implementation-specific).
        item.search_query_used = query
        item.comparable_listings = _parse_listings(raw_results)
        item.status = ItemStatus.PENDING_DECISION
        return True

    def _search_with_retry(
        self, query: str, item_id: Any, exclude: list[str] | None = None
    ) -> list[dict[str, Any]] | None:
        """Call the provider, retrying once on failure. Returns ``None`` if both attempts fail."""
        last_exc: Exception | None = None
        for attempt in range(1, _MAX_SEARCH_ATTEMPTS + 1):
            try:
                return self._provider.search(query, exclude=exclude)
            except Exception as exc:
                last_exc = exc
                logger.exception(
                    "Comparable-listing search failed (attempt %d/%d) for item id=%s query=%r",
                    attempt,
                    _MAX_SEARCH_ATTEMPTS,
                    item_id,
                    query,
                )
        logger.error(
            "Comparable-listing search exhausted all %d attempts for item id=%s query=%r; "
            "giving up, caller will mark item as search_failed. Last error: %s",
            _MAX_SEARCH_ATTEMPTS,
            item_id,
            query,
            last_exc,
        )
        return None
