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

Excluding defekt/Bastler/Ersatzteile listings (bead sandbox-8jm.4, revised sandbox-0as)
------------------------------------------------------------------------------------------
Per ``docs/kleinanzeigen-access.md`` section 4 step 2: "use ``exclude=[...]``
to filter obvious noise terms (e.g. "defekt", "bastler", "ersatzteile") if
the item is meant to be working." This module originally (bead sandbox-8jm.4)
implemented that by passing ``exclude=list(_BROKEN_LISTING_TERMS)`` to the
provider for non-broken items, on top of its own local title post-filter as
a defensive backstop. Bead sandbox-0as removed the ``exclude=`` pass-through
entirely, because it made things *worse*, not better:

* The installed ``kleinanzeigen-api`` 0.4.0 applies ``exclude=`` **client-
  side**, as a plain case-insensitive substring match against the listing
  title **and its full description** (see ``kleinanzeigen_api/client.py``:
  ``_as_terms`` ~l.89 normalizes the terms, ``_excluded`` ~l.98-103 checks
  title+description, applied at ~l.573) -- it silently drops the listing
  from the result set entirely, after the fixed number of pages has been
  fetched, so a filtered-out listing is never replaced by another one.
* German sellers routinely write phrases like "nicht defekt" (not broken),
  "kein Bastlerartikel" (not a fixer-upper item), "defektfrei" (defect-
  free), or mention "Ersatzteile" only to say they're *included* with a
  fully working item -- in the item's *description*, which this module
  never even sees (raw listing dicts here carry no description field). A
  plain substring match cannot tell these apart from a genuinely broken
  listing, so passing ``exclude=`` silently threw away perfectly good
  comparables, which lowers result counts, biases the resulting median
  price, and triggers unnecessary query-loosening -- entirely invisibly to
  this module, since it never even receives the filtered-out listings to
  reason about.

This module now implements the intent of that guardrail differently:

1. ``search_item`` determines whether the item's OWN condition is broken,
   reusing ``app.pricing.is_broken_condition`` (the same strip+lower ==
   "broken" normalization ``PricingDecisionService`` uses) rather than
   duplicating that logic or importing a private name across modules.
2. ``search_item`` / ``_search_with_retry`` never pass ``exclude=`` to the
   provider at all, for every item regardless of its own condition -- every
   candidate query in the query-loosening sequence is searched without it.
   (``ComparableSearchProvider.search`` and ``KleinanzeigenAPIProvider.search``
   still accept an optional ``exclude`` parameter, forwarded to the
   underlying client only when truthy, purely so other/external callers of
   a provider keep working -- see those methods' docstrings.)
3. When the item is **not** broken, ``search_item`` instead applies its own
   negation-aware post-filter (``_filter_broken_listing_titles``) to every
   raw result's ``title`` (the only field available here -- raw dicts carry
   no description), BEFORE deciding whether that candidate query returned
   any usable results. When the item **is** broken, this filter is skipped
   entirely -- a defekt/Bastler/Ersatzteile listing IS a genuine comparable
   for a broken item, so it must not be excluded in that case. If every
   result for a query is dropped by this filter, that query is treated
   exactly like a genuine zero-result response, and the existing query-
   loosening sequence (see above) continues to the next, looser candidate
   query.
4. ``_filter_broken_listing_titles`` negation logic: the casefolded title is
   tokenized with ``re.findall(r"\\w+", ...)`` (Unicode-aware, so umlauts
   stay inside a token). A title is dropped as "broken" if and only if at
   least one token *contains* a term from ``_BROKEN_LISTING_TERMS``
   ("defekt", "bastler", "ersatzteile") as a substring, AND that particular
   occurrence is not negated. An occurrence is negated when EITHER (a) the
   containing token has "frei" immediately after the term within the same
   token (e.g. "defektfrei"), OR (b) either of the up-to-two tokens
   immediately preceding it is one of a small German negation-word set
   ("nicht", "kein", "keine", "keinen", "keiner", "ohne"). If ANY
   non-negated occurrence exists anywhere in the title, the whole title is
   dropped -- e.g. "Nicht defekt, aber Ersatzteile fehlen" is still dropped,
   because "ersatzteile" there is unnegated, even though "defekt" is
   negated. This is a **local, look-behind-only** heuristic, not a real
   parser: negation words that appear *after* the term (e.g. "defekt? nicht
   wirklich") are not recognized and the title is (incorrectly, but
   conservatively) treated as broken -- a known, accepted limitation, since
   erring toward dropping an ambiguous title is safer than erring toward
   keeping a possibly-broken one.
5. Because this filter only ever sees the title (never the description,
   which this module doesn't fetch), it cannot fully replace what a
   description-aware ``exclude=`` *could* have done for the (now-removed)
   description side. That tradeoff was judged worthwhile given the false-
   negative cost documented above (see bead sandbox-0as for the full
   discussion and human sign-off).

Relevance-gating single-keyword fallback results (bead sandbox-8jm.5, extended sandbox-182)
-----------------------------------------------------------------------------------------------
The individual-keyword fallback queries described above (attempt 2+ in
``_build_query_attempts``) are independent single terms, which can be much
less specific than the fully-joined query -- most notably when the
fallback keyword is just the item's brand name (e.g. "Bosch"), which
surfaces every Bosch-branded listing on the site (a dishwasher, a mixer,
an iron, ...) with no relationship to the actual item at all. This module
addresses that in two layers:

1. ``_build_query_attempts`` now accepts an optional ``brand: str | None``
   (default ``None``, so existing call sites/tests are unaffected). Any
   individual-keyword fallback candidate whose folded tokens (see
   ``_fold``/``_brand_tokens`` below) are ALL also tokens of ``brand`` is
   skipped entirely -- it is never turned into a live search call (e.g.
   brand "Black & Decker" skips fallback keywords "black & decker" and
   "Black+Decker", but keeps "black & decker akkuschrauber", which has a
   non-brand token). The fully-joined query (attempt 1) is always kept
   regardless of ``brand``, since AND-ing the brand together with the rest
   of the identified name is exactly the specific, on-topic query we want.
2. For fallback candidates that DO get searched (attempt 2+), ``search_item``
   applies ``_is_relevant`` (see its docstring for the full algorithm) to
   each raw result's ``title``, dropping any result judged irrelevant to
   ``Item.identified_name``. This is applied AFTER the broken-title
   post-filter and BEFORE the zero-results/loosening decision: if every
   result for a fallback candidate is dropped, that candidate is treated
   exactly like a genuine zero-result response and the existing
   query-loosening sequence continues to the next, looser candidate query.
   This gate is intentionally never applied to the fully-joined query's
   results (attempt 1) -- that query is specific enough (all identification
   keywords ANDed together) that we trust whatever it returns.
   ``_is_relevant`` is deliberately conservative: when ``Item.identified_name``
   is missing, or has no tokens left after dropping short (<3 char) and
   brand-only tokens (in either fold mode), it returns ``True`` (cannot
   judge -- do not filter) rather than guessing.

**German spelling-variant tolerance (bead sandbox-182).** Kleinanzeigen
sellers spell the same item inconsistently -- compound words split with a
hyphen or space ("Akku-Schrauber" vs "Akkuschrauber"), plurals ("Laufschuhe"
vs "Laufschuh"), and umlauts written out two different ASCII-safe ways
("Kaffeemuehle"/digraph vs "Kaffeemuhle"/diaeresis-dropped) or not
ASCII-safe at all ("Kaffeemühle"). A plain casefolded-substring check (the
original bead sandbox-8jm.5 algorithm) missed all of these. ``_is_relevant``
now handles them via three building blocks, applied per name token in each
of two umlaut-fold modes (``_FOLD_MODES = ("digraph", "plain")`` -- see
``_fold``'s docstring for exactly what each mode maps):

* ``_compact`` folds *and* strips every remaining non-alphanumeric
  character from the title being matched against, so hyphen/space-split
  compounds collapse to one word (e.g. "Akku-Schrauber 18V" ->
  "akkuschrauber18v") and still match a name token written as a single
  word.
* ``_destem`` strips a single trailing plural-ish German suffix
  ("en"/"e"/"n"/"s", tried in that order) from name tokens of length >= 5,
  when the resulting stem is still >= 4 characters, and that stem (not the
  original token) becomes the matching unit -- e.g. "Schreibtischlampen"
  matches "Schreibtischlampe" via shared stem "schreibtischlamp".
* ``_brand_tokens`` splits ``brand`` into its own folded tokens (per fold
  mode) rather than comparing it to the name as one string, so a
  multi-word brand like "Black & Decker" is excluded from the name's
  tokens (and from the keyword-skip check above) regardless of how either
  string is punctuated.

A title is relevant if ANY name token/stem matches the title, in EITHER
fold mode -- checked mode-consistently, never mixing a "digraph"-folded
token against a "plain"-folded title. Two further guards (bead
sandbox-3ht) curb false positives from short units and from dropping
umlauts too aggressively:

* **Plain-mode length floor.** A token only participates in "plain"
  (diaeresis-dropped) fold-mode matching if its plain-folded length is
  >= ``_MIN_PLAIN_MODE_TOKEN_LEN`` (5). Below that, dropping the umlaut
  collides with unrelated words too often (e.g. "Tür" -> "tur" would
  otherwise match "Turnschuhe"/"Natur"; "Bär" -> "bar" would match
  "Barhocker"; "Säge" -> "sage" would match "Massage"). Such short tokens
  are still checked in "digraph" mode, where the umlaut is spelled out
  (e.g. "Tür" -> "tuer") rather than dropped, so this collision problem
  does not arise there.
* **Word-boundary rule for short units.** The matching unit (stem, if
  ``_destem`` produced one, else the token) is checked against the title
  differently depending on its length. Units of length >=
  ``_MIN_SUBSTRING_UNIT_LEN`` (5) keep the original rule: matched as a
  substring of the title after ``_compact`` folds it and strips all
  remaining non-alphanumeric characters (e.g. "Akku-Schrauber 18V" ->
  "akkuschrauber18v"). Units shorter than that are instead checked as a
  whole word: the title is folded but NOT compacted, split into words the
  same way ``identified_name`` is, and the unit must match a word's END --
  the word equals the unit, or the unit plus one of ``_PLURAL_SUFFIXES``
  ("e"/"en"/"n"/"s"). This is what makes "Tür" match "Haustür" (word
  "haustuer" ends with "tuer") and "Karten" match "Spielkarten" (stem
  "kart" + "en"), while rejecting "Tür" against "Tastatur" and "Karten"
  against "Kartoffelschäler" -- neither of which has a title *word ending
  in* the unit.

Known, accepted limitations (see ``_destem``'s docstring): this is a
fixed-suffix heuristic, not real German morphology. It does not handle
umlaut-vowel-change plurals ("Mutter"/"Mütter") or letter-insertion
variants ("Fön"/"Föhn" -- an "h"-insertion is neither an umlaut-fold nor a
suffix difference, so that pair still does not match; see
``test_is_relevant_umlaut_h_insertion_known_limitation``). For units of
length >= ``_MIN_SUBSTRING_UNIT_LEN``, the compact-title substring rule
can still cross word boundaries after compaction (e.g. "Reifen" ~ "Reife
Tomaten" once space-stripped). For units shorter than that, only a
word-END match counts, so a short unit that is merely a compound-START
match in the title (e.g. "Hose" vs "Hosenträger") is no longer accepted --
an intentional trade for far fewer false positives.

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
import os
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

# Bundled Kleinanzeigen app-distribution Basic-auth values from the official
# Android client (not personal secrets). Kleinanzeigen rotates these; when
# requests start failing with 401/403, override via env / backend/.env:
# APP_USER, APP_PASSWORD, APP_VERSION.
DEFAULT_APP_USER = "android"
DEFAULT_APP_PASSWORD = "TaR60pEttY"
DEFAULT_APP_VERSION = "2026.23.1"


def _env_value(*names: str) -> str | None:
    """First non-blank env var among ``names`` (stripped), read at call time."""
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return None


def _resolve_kleinanzeigen_credentials() -> tuple[str, str, str]:
    """Return ``(user, password, app_version)`` for ``KleinanzeigenAPI``.

    Order: ``APP_*`` env -> the library's ``KLEINANZEIGEN_BASIC_USER`` /
    ``KLEINANZEIGEN_BASIC_PW`` (user/password only) -> bundled defaults.
    Blank/whitespace-only values count as unset. Never log the password.
    """
    user = _env_value("APP_USER", "KLEINANZEIGEN_BASIC_USER") or DEFAULT_APP_USER
    password = _env_value("APP_PASSWORD", "KLEINANZEIGEN_BASIC_PW") or DEFAULT_APP_PASSWORD
    version = _env_value("APP_VERSION") or DEFAULT_APP_VERSION
    return user, password, version

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
        attempt to exclude from results. Implementations are not required to
        actually exclude anything. Kept on this protocol (and on
        ``KleinanzeigenAPIProvider.search``) purely so external callers of a
        ``ComparableSearchProvider`` keep working -- but note that
        ``ComparableListingSearchService`` deliberately never passes it (see
        "Excluding defekt/Bastler/Ersatzteile listings" in the module
        docstring for why): the underlying ``kleinanzeigen-api`` library
        applies ``exclude=`` client-side as a plain substring match against
        the listing title *and its full description*, which silently drops
        good, working listings whose description merely mentions a broken-
        listing term in a negated way (e.g. "nicht defekt", "kein
        Bastlerartikel") -- and does so before the service ever sees them,
        so no local post-filter can recover them. The service instead relies
        solely on its own negation-aware title post-filter
        (``_filter_broken_listing_titles``), which only ever sees (and only
        ever needs to reason about) the title.

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
        user, password, version = _resolve_kleinanzeigen_credentials()
        self._client = KleinanzeigenAPI(
            basic_user=user, basic_pw=password, app_version=version
        )
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
        # NOTE (bead sandbox-0as): `ComparableListingSearchService` never
        # passes `exclude` to this method any more -- see the
        # `ComparableSearchProvider.search` docstring above for why. This
        # parameter and its forwarding are kept only so other/external
        # callers of this provider keep working.
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
            message = f"Kleinanzeigen search call failed for query={query!r}: {exc}"
            # Match the kleinanzeigen_api client's own 401/403 signature
            # ("<status> from API — Basic-auth credentials likely rotated")
            # rather than a bare "401"/"403" anywhere in the text, so a
            # query/URL that merely contains those digits can't trip the hint.
            if re.search(r"\b40[13] from API\b", str(exc)):
                message += (
                    " -- credentials may be rotated/rejected: set fresh APP_USER, "
                    "APP_PASSWORD and APP_VERSION in the deployment env (Railway "
                    "service variables, or backend/.env locally; see "
                    "docs/kleinanzeigen-access.md)"
                )
                logger.warning(message)
            raise ComparableSearchError(message) from exc

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
    sandbox-8jm.5, extended by sandbox-182) also skipping any keyword whose
    folded tokens (see ``_fold``/``_brand_tokens``) are ALL also tokens of
    ``brand`` -- a lone brand name (e.g. "Bosch", or a multi-word brand
    like "Black & Decker" typed as "black & decker" or "Black+Decker") as a
    fallback query is almost guaranteed to surface completely unrelated
    same-brand products (a Bosch dishwasher, mixer, iron, ...) rather than
    anything comparable to the actual item, so it's not worth the live
    call. A keyword that mixes in even one non-brand token (e.g. "black &
    decker akkuschrauber") is kept, since it's no longer brand-only.
    ``brand=None`` (the default, used by all existing call sites) disables
    this skip entirely, leaving pre-sandbox-8jm.5 behavior unchanged.
    Capped at ``_MAX_QUERY_ATTEMPTS`` total candidate queries (brand-skipped
    keywords don't count against this cap, since they're never added). See
    module docstring "Query-loosening on zero results" for the full
    rationale, and "Relevance-gating single-keyword fallback results" for
    the brand-skip rationale.

    Returns an empty list if there are no usable keywords at all (mirrors
    ``_build_query`` returning ``""`` in that case).
    """
    cleaned = [kw.strip() for kw in (keywords or []) if isinstance(kw, str) and kw.strip()]
    if not cleaned:
        return []

    # Arbitrary but consistent fold mode: since both `kw` and `brand` below
    # are folded the same way before comparing, the digraph/plain choice
    # cannot itself change the outcome (see ``_fold`` docstring).
    brand_tokens = _brand_tokens(brand, "digraph")

    attempts = [" ".join(cleaned)]
    for kw in cleaned:
        if len(attempts) >= _MAX_QUERY_ATTEMPTS:
            break
        if kw in attempts:
            continue
        if brand_tokens:
            kw_tokens = [token for token in re.split(r"[\W_]+", _fold(kw, "digraph")) if token]
            if kw_tokens and all(token in brand_tokens for token in kw_tokens):
                logger.info(
                    "Skipping brand-only fallback keyword %r (all tokens match item brand %r)",
                    kw,
                    brand,
                )
                continue
        attempts.append(kw)
    return attempts


# Negation words that, when found in either of the (up to) two tokens
# immediately preceding a broken-listing-term occurrence, mark that specific
# occurrence as negated (see ``_filter_broken_listing_titles`` /
# ``_title_is_broken``).
_NEGATION_WORDS = frozenset({"nicht", "kein", "keine", "keinen", "keiner", "ohne"})

# Look-behind window (in tokens) checked for a negation word before a
# broken-listing-term occurrence.
_NEGATION_WINDOW = 2


def _title_is_broken(title: str) -> bool:
    r"""Return whether ``title`` should be treated as a broken/for-parts listing.

    Negation-aware: see module docstring "Excluding defekt/Bastler/
    Ersatzteile listings" point 4 for the full algorithm and its known
    limitation (negation words placed *after* the term are not recognized).
    Tokenizes the casefolded title with ``re.findall(r"\w+", ...)``
    (Unicode-aware, so umlauts/``ß`` stay inside a token).
    """
    tokens = re.findall(r"\w+", title.casefold())
    for index, token in enumerate(tokens):
        for term in _BROKEN_LISTING_TERMS:
            if term not in token:
                continue
            # (a) "<term>frei" within the same token, e.g. "defektfrei".
            term_index = token.find(term)
            if token[term_index + len(term) :].startswith("frei"):
                continue
            # (b) a negation word in either of the up-to-2 preceding tokens.
            window_start = max(0, index - _NEGATION_WINDOW)
            preceding = tokens[window_start:index]
            if any(word in _NEGATION_WORDS for word in preceding):
                continue
            # Found a non-negated broken-listing-term occurrence.
            return True
    return False


def _filter_broken_listing_titles(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Defensively drop raw results whose title is judged a broken listing.

    See module docstring "Excluding defekt/Bastler/Ersatzteile listings" for
    the full negation-aware algorithm (``_title_is_broken``). This is the
    module's *only* defense against broken/for-parts listings now (the
    provider is never asked to ``exclude=`` anything -- see that docstring
    section for why). A missing/non-string title is never dropped by this
    filter (existing downstream skip-on-missing-title logic in
    ``_parse_listings`` already handles that case).
    """
    filtered: list[dict[str, Any]] = []
    for raw in raw_results:
        title = raw.get("title")
        if isinstance(title, str) and _title_is_broken(title):
            logger.debug("Dropping broken-listing-term title raw=%r", raw)
            continue
        filtered.append(raw)
    return filtered


# The two umlaut-folding conventions applied by ``_fold`` (see its
# docstring) -- both are tried for every relevance check (bead
# sandbox-182), since German sellers spell umlauts inconsistently and this
# module has no way to know in advance which convention a given listing
# title will use.
_FOLD_MODES = ("digraph", "plain")

# Minimum length (of the whole, un-stemmed, folded token) for that token to
# participate in "plain" (diaeresis-dropped) fold-mode matching at all (bead
# sandbox-3ht). Below this length, dropping the umlaut collides with too
# many unrelated German words (e.g. "Tür" -> "tur", "Bär" -> "bar", "Säge"
# -> "sage") to be trustworthy as a match signal. Short tokens are still
# checked in "digraph" mode, where the umlaut is spelled out instead of
# dropped, which does not have the same collision problem.
_MIN_PLAIN_MODE_TOKEN_LEN = 5

# Minimum length of the matching unit (stem, if one was derived, else the
# raw token) for the compact-title substring rule to apply (bead
# sandbox-3ht). Below this length, a bare substring check is too prone to
# matching inside an unrelated, longer word (e.g. "karten" ~ "Kartoffel"),
# so short units instead require a whole-word match (see
# ``_PLURAL_SUFFIXES`` and ``_is_relevant``).
_MIN_SUBSTRING_UNIT_LEN = 5

# Suffixes tried, in addition to the bare needle, when word-boundary
# matching a short (< ``_MIN_SUBSTRING_UNIT_LEN``) matching unit against a
# title word (bead sandbox-3ht). Mirrors the plural-ish suffixes
# ``_destem`` strips, plus the empty string for an exact match.
_PLURAL_SUFFIXES = ("", "e", "en", "n", "s")


def _fold(text: str, mode: str) -> str:
    """Casefold ``text`` and normalize German umlauts per ``mode``.

    ``str.casefold()`` already maps ``"ß"`` -> ``"ss"`` (handled once here,
    identically for both modes -- see ``test_is_relevant_sharp_s_token_still_matches``).
    The two umlaut conventions:

    * ``"digraph"``: ae/oe/ue (the standard German transliteration used
      e.g. in URLs and by keyboards without umlaut keys that spell them
      out) -- ``"Mühle"`` -> ``"muehle"``.
    * ``"plain"``: the diaeresis is simply dropped -- ``"Mühle"`` ->
      ``"muhle"`` -- for sellers who type the base vowel instead.

    Both conventions are common in real Kleinanzeigen listing titles, and
    neither reliably predicts the other, so both are tried (see
    ``_is_relevant``) rather than picking one.
    """
    folded = text.casefold()
    if mode == "digraph":
        return folded.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    if mode == "plain":
        return folded.replace("ä", "a").replace("ö", "o").replace("ü", "u")
    raise ValueError(f"Unknown fold mode: {mode!r}")


def _compact(text: str, mode: str) -> str:
    """Fold ``text`` per ``mode`` (see ``_fold``) and strip all non-alphanumeric characters.

    Collapses e.g. ``"Akku-Schrauber 18V"`` -> ``"akkuschrauber18v"``, so
    hyphen/space-split compound spellings (``"Akku-Schrauber"`` vs
    ``"Akkuschrauber"``) still match as a plain substring against a name
    token that was written as one word. Uses the same Unicode-aware
    ``[\\W_]+`` character class as the rest of this module's tokenizing
    helpers.
    """
    return re.sub(r"[\W_]+", "", _fold(text, mode))


def _brand_tokens(brand: str | None, mode: str) -> set[str]:
    """Return the set of ``_fold``-ed, non-empty whitespace/punctuation-split tokens making up ``brand``.

    E.g. ``brand="Black & Decker"`` -> ``{"black", "decker"}`` (the ``"&"``
    contributes no token). Returns an empty set for a missing/blank
    ``brand``.
    """
    if not isinstance(brand, str) or not brand.strip():
        return set()
    return {token for token in re.split(r"[\W_]+", _fold(brand, mode)) if token}


def _destem(token: str) -> str | None:
    """Strip a single trailing German plural-ish suffix from ``token``, if plausible.

    Only ever called for tokens of length >= 5. Tries ``"en"``, then
    ``"e"``, then ``"n"``, then ``"s"`` (the most common German
    noun-plural/case endings), stopping at the first suffix whose removal
    leaves a stem of length >= 4 (short stems are too noise-prone to trust
    as a substring-match anchor). Returns ``None`` if no suffix qualifies,
    in which case the caller falls back to matching the token unmodified.

    The stem is, by construction, a substring of both the singular and
    that suffix's plural spelling, so matching on it lets e.g. name token
    "laufschuhe" match title word "laufschuh" and vice versa. This is a
    crude heuristic, not real German morphology -- see the module docstring
    "Relevance-gating single-keyword fallback results" for known
    limitations (e.g. it does not handle umlaut-vowel-change plurals like
    "Mutter"/"Mütter", or insertions like "Fön"/"Föhn").
    """
    for suffix in ("en", "e", "n", "s"):
        if token.endswith(suffix):
            stem = token[: -len(suffix)]
            if len(stem) >= 4:
                return stem
    return None


def _is_relevant(title: str, identified_name: str | None, brand: str | None) -> bool:
    r"""Return whether ``title`` plausibly refers to the same kind of item as ``identified_name``.

    See module docstring "Relevance-gating single-keyword fallback results"
    (beads sandbox-8jm.5, sandbox-182). For each of the two umlaut-folding
    modes in ``_FOLD_MODES`` (``"digraph"`` and ``"plain"`` -- see
    ``_fold``):

    1. ``identified_name`` is folded and split on runs of non-alphanumeric
       characters (Unicode-aware, via ``re.split(r"[\W_]+", ...)``, so
       umlauts and ``ß`` stay inside a token instead of splitting it),
       keeping only tokens of length >= 3 (drops short/noise tokens like
       "gr", "18", "v") that are not one of ``brand``'s own folded,
       whitespace/punctuation-split tokens (see ``_brand_tokens`` -- a
       brand token alone tells us nothing about whether a *specific*
       listing is relevant, and this also lets a multi-word brand like
       "Black & Decker" be excluded token-by-token regardless of how it's
       punctuated in either string).
    1b. A surviving token only participates in "plain" fold-mode matching
       if its plain-folded length is >= ``_MIN_PLAIN_MODE_TOKEN_LEN`` (bead
       sandbox-3ht). Below that length, dropping the umlaut diaeresis
       collides with too many unrelated words (e.g. "Tür" -> "tur", "Bär"
       -> "bar", "Säge" -> "sage") to trust as a match signal. The token is
       unaffected in "digraph" mode, where the umlaut is spelled out
       rather than dropped and this collision problem does not arise, so
       short tokens are still checked there.
    2. Each surviving token of length >= 5 is passed through ``_destem``
       (see its docstring), which strips a single trailing German
       plural-ish suffix when that leaves a still-substantial stem. When a
       stem is produced, the stem (not the original token) is used as the
       matching unit for that token -- this makes e.g. name token
       "Laufschuhe" match title word "Laufschuh" and vice versa. Tokens
       that don't qualify for stemming are matched as-is.
    3. ``title`` is folded (same mode). Two different rules are then used
       to check the matching unit (stem, if one was derived, else the
       token) against ``title``, depending on the unit's length (bead
       sandbox-3ht):

       * If the unit is >= ``_MIN_SUBSTRING_UNIT_LEN`` characters, ``title``
         is additionally compacted (see ``_compact``, which strips all
         remaining non-alphanumeric characters) so that e.g.
         "Akku-Schrauber 18V" becomes "akkuschrauber18v" and still matches
         a one-word name unit -- and the unit is checked as a substring of
         that compacted title.
       * If the unit is shorter than ``_MIN_SUBSTRING_UNIT_LEN``, a bare
         substring check is too easy to satisfy by accident inside an
         unrelated, longer word (e.g. "karten" ~ "Kartoffelschäler",
         "rollen" ~ "Roller"). Instead, ``title`` is folded but NOT
         compacted, split into words the same way ``identified_name`` was
         (``re.split(r"[\W_]+", ...)``), and the unit must match a whole
         word: some word must equal the unit, or equal the unit plus one
         of ``_PLURAL_SUFFIXES`` ("e"/"en"/"n"/"s") -- checked via
         ``word.endswith(unit + suffix)``, which also covers exact
         equality (empty suffix). Only a word-END match counts, so a short
         unit matching merely the START of a longer compound (e.g. "Hose"
         at the start of "Hosenträger") is deliberately NOT accepted.

    A title is relevant if ANY name token/stem, in EITHER fold mode
    (checked mode-consistently -- a token/stem folded one way is only
    checked against the title folded the *same* way), matches per the
    length-appropriate rule above -- checked in one direction only (name
    unit matched against title); the reverse (title word matched against a
    name unit) is deliberately NOT checked, since a long, precise
    ``identified_name`` token should not be considered "matched" merely
    because a short, generic title word happens to be a substring of it.

    If there are no usable name tokens at all, in either mode
    (``identified_name`` is ``None``/empty, or every token was dropped as
    too short, brand-only, or -- in "plain" mode only -- too short to
    trust umlaut-dropping for), this returns ``True`` -- there's nothing to
    judge relevance against, so the gate must not filter anything out in
    that case. Note a token that is too short only for "plain" mode still
    has its "digraph"-mode entry, so this fallback only triggers when a
    token has no usable entry in either mode.

    Known limitations (accepted, not fixed by this gate): the plural
    stemming in ``_destem`` is a crude fixed-suffix heuristic, not real
    German morphology -- it does not handle umlaut-vowel-change plurals
    (e.g. "Mutter"/"Mütter") or letter-insertion spelling variants (e.g.
    "Fön"/"Föhn" -- an "h"-insertion, not an umlaut-folding or suffix
    difference, so it is out of scope for both ``_fold`` and ``_destem``
    and this pair still does not match). For matching units of length >=
    ``_MIN_SUBSTRING_UNIT_LEN``, the compact-title substring rule can still
    cross word boundaries after compaction (e.g. "Reifen" ~ "Reife
    Tomaten" once space-stripped) -- this is unchanged/accepted. For units
    shorter than that, the word-boundary rule only accepts a match at the
    END of a title word, so a short unit that is only a compound-START
    match in the title (e.g. "Hose" vs "Hosenträger") is no longer
    accepted -- this is an intentional new limitation traded for far fewer
    false positives (bead sandbox-3ht).
    """
    if not identified_name:
        return True

    match_units: list[tuple[str, str]] = []
    for mode in _FOLD_MODES:
        folded_name = _fold(identified_name, mode)
        raw_tokens = re.split(r"[\W_]+", folded_name)
        brand_tokens = _brand_tokens(brand, mode)
        for token in raw_tokens:
            if len(token) < 3 or token in brand_tokens:
                continue
            if mode == "plain" and len(token) < _MIN_PLAIN_MODE_TOKEN_LEN:
                continue
            stem = _destem(token) if len(token) >= 5 else None
            match_units.append((mode, stem or token))

    if not match_units:
        return True

    compact_titles = {mode: _compact(title, mode) for mode in _FOLD_MODES}
    title_words = {mode: re.split(r"[\W_]+", _fold(title, mode)) for mode in _FOLD_MODES}

    for mode, unit in match_units:
        if len(unit) >= _MIN_SUBSTRING_UNIT_LEN:
            if unit in compact_titles[mode]:
                return True
        else:
            for word in title_words[mode]:
                if any(word.endswith(unit + suffix) for suffix in _PLURAL_SUFFIXES):
                    return True
    return False


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
        # should, since those listings ARE comparable to it. This service no
        # longer passes `exclude=` to the provider at all (see module
        # docstring) -- it relies solely on the negation-aware local
        # post-filter below.
        broken = is_broken_condition(item.condition)

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
            raw_results = self._search_with_retry(query, item_id=item_id)
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
                # Negation-aware title filter; the provider is deliberately
                # not given `exclude` -- see module docstring
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
        self, query: str, item_id: Any
    ) -> list[dict[str, Any]] | None:
        """Call the provider, retrying once on failure. Returns ``None`` if both attempts fail.

        Deliberately never passes ``exclude=`` -- see module docstring
        "Excluding defekt/Bastler/Ersatzteile listings" for why this service
        relies solely on ``_filter_broken_listing_titles`` instead.
        """
        last_exc: Exception | None = None
        for attempt in range(1, _MAX_SEARCH_ATTEMPTS + 1):
            try:
                return self._provider.search(query)
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
