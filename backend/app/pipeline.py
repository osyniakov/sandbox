"""End-to-end pipeline orchestration: photo upload -> decision.

Wires together four previously-independent services --
``ItemIdentificationService`` (``app/identification.py``),
``ComparableListingSearchService`` (``app/comparable_search.py``),
``PricingDecisionService`` (``app/pricing.py``), and
``ListingTextService`` (``app/listing_text.py``) -- into a single ordered
pipeline: identify -> search -> decide (-> generate listing text, a
best-effort sub-step of the decide stage, not a gating stage of its
own -- see stage 3 below). This module owns the DB session
lifecycle (each service mutates its ``Item`` argument in place but never
commits, by design -- see each module's own docstring), committing after
every successfully-completed stage so a crash or failure mid-pipeline
leaves the DB in a consistent state: ``Item.status`` always reflects
exactly how far the item got.

Sync-in-request vs. background-task execution
-----------------------------------------------
This is triggered as a **FastAPI ``BackgroundTask``**, scheduled from
``POST /items`` *after* that endpoint's own commit (so the item already
exists with ``status=pending_identification`` before the pipeline touches
it), rather than run synchronously inline inside the upload request.

Reasoning: identification calls a real LLM vision API, and comparable
search calls a scraping library with a *minimum* ~1.5s built-in rate
limit per request, with the search service retrying once on failure
(``_MAX_SEARCH_ATTEMPTS = 2`` in ``app/comparable_search.py``) -- so a
single upload could plausibly take anywhere from a few seconds to tens of
seconds (LLM latency + up to ~3s+ of rate-limited search calls,
compounded by e.g. a slow/retrying LLM call) before all three stages
settle. Blocking the upload HTTP request on all of that would turn a
simple "drop a photo" interaction into a request that can time out in a
browser/reverse proxy/mobile HTTP client, and would make the app feel
broken on a slow connection or a slow day for either external dependency.

Running the pipeline as a background task after the request returns
means: (a) the upload request itself stays fast (just file I/O + one DB
insert, matching its current behavior before this bead), (b) a slow or
flaky external call degrades to "the item sits at an intermediate status
a bit longer", not "the user's upload request hangs or errors out", and
(c) ``GET /items/{id}`` (added by this same bead) gives the client a
natural way to observe progress -- which the bead description explicitly
anticipated ("so a client can poll while the pipeline runs"). The
tradeoff is a little more plumbing (the background task needs its own DB
session, since the request-scoped session is closed once the response is
sent) and no built-in "pipeline finished" push notification -- polling
``GET /items/{id}`` is the intended mechanism, documented below.

Polling contract for ``GET /items/{id}``
-------------------------------------------
``Item.status`` is the single source of truth for pipeline progress.
Clients that want to know when a newly-uploaded item is "done" should
poll ``GET /items/{id}`` and inspect ``status``:

* ``pending_identification`` -- still processing (queued, or the
  identification stage is in flight) OR identification failed and the
  item is stuck for retry. Not distinguishable from "just uploaded,
  hasn't started yet" without a separate retry/attempt counter (there
  isn't one yet) -- keep polling.
* ``pending_search`` -- identification succeeded; still processing
  (search in flight) OR search failed after retries and the item is
  stuck. Keep polling.
* ``pending_decision`` -- search succeeded (including the valid "zero
  comparables found" outcome); the decision stage should follow
  immediately (it has no external dependency and does not fail). In
  practice this is a transient state, but keep polling until ``decided``.
* ``decided`` -- **terminal for this pipeline.** ``suggested_price`` and
  ``decision`` are populated (see ``app/pricing.py``); stop polling.
* ``listed`` / ``given_away`` / ``disposed`` -- also terminal; these are
  post-decision manual-tracking statuses set by later features (see
  ``sandbox-yqf.11``), not by this pipeline. Stop polling.

Note there is currently no explicit "permanently failed" terminal status:
a stage that fails after exhausting its own retries simply leaves the
item parked at that stage's "pending_*" status (see the "Failure vs.
ambiguity/zero-results convention" sections of ``app/identification.py``
and ``app/comparable_search.py``) for a future retry mechanism, rather
than transitioning to some ``failed`` status. A client polling
indefinitely on a genuinely-stuck item would poll forever; a bounded
polling loop (e.g. "give up after N attempts / T seconds and show the
last known status") is a client-side concern, out of scope for this bead.
"""

from __future__ import annotations

import logging

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.comparable_search import ComparableListingSearchService
from app.db import make_session_factory
from app.identification import ItemIdentificationService
from app.listing_text import ListingTextService
from app.models import Item, ItemStatus
from app.pricing import PricingDecisionService

logger = logging.getLogger(__name__)


def run_pipeline(
    item_id: int,
    session: Session,
    *,
    identification_service: ItemIdentificationService | None = None,
    search_service: ComparableListingSearchService | None = None,
    pricing_service: PricingDecisionService | None = None,
    listing_text_service: ListingTextService | None = None,
) -> None:
    """Run identify -> search -> decide for the ``Item`` with id ``item_id``.

    Uses the given, already-open ``session`` for all reads/writes and
    commits it after each successfully-completed stage. Never raises out
    to the caller for pipeline-stage failures (those are reported via
    ``Item.status`` staying at an intermediate value, per each service's
    own documented contract) -- the caller (typically a FastAPI
    ``BackgroundTask``, see module docstring) doesn't need to do anything
    with a return value.

    Stage-by-stage behavior:

    1. **Identification** (mandatory integration requirement #1): call
       ``identify_item(item)``, then commit regardless of outcome so any
       mutated fields persist. If it returns ``False`` (the provider call
       failed), stop here -- ``item.status`` is left at
       ``pending_identification`` by the service itself, and this
       function does not proceed to the search stage.
    2. **Search**: only reached if identification succeeded. Call
       ``search_item(item)``, then commit. If it returns ``False`` (both
       the initial attempt and the one retry failed), stop here --
       ``item.status`` is left at ``pending_search`` by the service
       itself, and this function does not proceed to the decision stage.
       Note a *successful* search with zero comparable listings found is
       not a failure (``search_item`` returns ``True`` and advances
       status to ``pending_decision``) -- the pipeline proceeds to decide
       in that case.
    3. **Decision** (mandatory integration requirement #2): guarded
       explicitly by checking ``item.status == ItemStatus.PENDING_DECISION``
       before calling ``decide_item`` -- belt-and-braces on top of the
       ``search_item`` return-value check above, since
       ``PricingDecisionService.decide_item`` does not itself check
       incoming status (see ``app/pricing.py``'s module docstring) and
       would happily misclassify an item that never actually finished
       searching. Immediately after ``decide_item`` returns (so
       ``item.status`` is already ``decided`` in memory, before this
       stage's commit), unconditionally call
       ``listing_text_service.generate_listing_text(item)`` to populate
       ``suggested_title``/``suggested_description`` -- this is a
       best-effort enhancement, not a gate: the service itself handles
       decision-gating (no-op for ``throw_away``) and never raises, and
       this function does not branch on its return value, so a
       ``False`` result never changes ``item.status`` or halts the
       pipeline. Then commit -- meaning ``suggested_title``/
       ``suggested_description`` land in the SAME commit as
       ``status=decided``, so a client polling ``GET /items/{id}`` never
       observes ``decided`` without the listing text already in its
       final state (when generation succeeds).
    """
    # Service defaults: construct the real, network-calling providers when
    # not explicitly overridden by the caller (e.g. by a test that
    # monkeypatches these). pricing_service has no external dependency (see
    # app/pricing.py's own module docstring).
    identification_service = identification_service or ItemIdentificationService()
    search_service = search_service or ComparableListingSearchService()
    listing_text_service = listing_text_service or ListingTextService()
    pricing_service = pricing_service or PricingDecisionService()

    item = session.get(Item, item_id)
    if item is None:
        logger.error("run_pipeline called with unknown item_id=%s; nothing to do", item_id)
        return

    # --- Stage 1: identification --------------------------------------
    identified = identification_service.identify_item(item)
    # Mandatory requirement #1: commit so identification results (or, on
    # failure, the untouched pending_identification status) persist.
    session.commit()
    if not identified:
        logger.info(
            "Pipeline halted for item id=%s: identification failed, status remains %s",
            item_id,
            item.status.value,
        )
        return

    # --- Stage 2: comparable-listing search -----------------------------
    searched = search_service.search_item(item)
    session.commit()
    if not searched:
        logger.info(
            "Pipeline halted for item id=%s: comparable search failed, status remains %s",
            item_id,
            item.status.value,
        )
        return

    # --- Stage 3: pricing/decision ---------------------------------------
    # Mandatory requirement #2: never call decide_item on an item that
    # hasn't genuinely reached pending_decision.
    if item.status != ItemStatus.PENDING_DECISION:
        logger.error(
            "Pipeline refusing to run the decision stage for item id=%s: "
            "status is %r (expected pending_decision after a successful search)",
            item_id,
            item.status.value,
        )
        return

    pricing_service.decide_item(item)
    # Best-effort listing-text generation, run after decide_item (so
    # item.decision/item.status=decided are already set in memory) and
    # before this stage's commit -- see module docstring and the
    # Stage 3 docstring note above for why this must land in the same
    # commit as the decision. Never gated on the return value: a
    # False result (or a no-op for throw_away/pending) leaves
    # suggested_title/suggested_description as None and does not affect
    # status/decision/suggested_price in any way.
    #
    # Defense-in-depth: ListingTextService.generate_listing_text is
    # documented and tested to never raise (see app/listing_text.py), so
    # this try/except is not covering an expected code path -- it's a
    # second, independent safety net so that a bug in that
    # never-supposed-to-raise contract can't take down the entire
    # pipeline over what should be a non-critical enhancement. No
    # retries, no status changes, no branching on the exception type --
    # just log and continue.
    try:
        listing_text_service.generate_listing_text(item)
    except Exception:
        logger.exception(
            "Listing-text generation raised unexpectedly for item id=%s; continuing without it",
            item_id,
        )
    session.commit()
    logger.info(
        "Pipeline completed for item id=%s: decision=%s suggested_price=%r",
        item_id,
        item.decision.value,
        item.suggested_price,
    )


def run_pipeline_with_new_session(
    item_id: int,
    engine: Engine,
    *,
    identification_service: ItemIdentificationService | None = None,
    search_service: ComparableListingSearchService | None = None,
    pricing_service: PricingDecisionService | None = None,
    listing_text_service: ListingTextService | None = None,
) -> None:
    """Open a fresh session against ``engine`` and run :func:`run_pipeline`.

    Intended for use as a FastAPI ``BackgroundTask`` target: background
    tasks run after the request's own response has been sent, by which
    point the request-scoped session (``Depends(get_session)``) has
    already been closed -- so the pipeline needs its own, independently
    opened and closed session rather than reusing the request's.
    """
    session = make_session_factory(engine)()
    try:
        run_pipeline(
            item_id,
            session,
            identification_service=identification_service,
            search_service=search_service,
            pricing_service=pricing_service,
            listing_text_service=listing_text_service,
        )
    finally:
        session.close()
