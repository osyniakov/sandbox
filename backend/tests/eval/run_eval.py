"""Offline labelled evaluation harness for decision accuracy (bead sandbox-8jm.1).

This module measures how often ``app.comparable_search.ComparableListingSearchService``
+ ``app.pricing.PricingDecisionService`` produce the decision (and price
range) a careful human would produce, against a fixed, hand-labelled set of
cases in ``cases.json``. No live network is used: each case supplies its own
canned ``provider_results`` (a mapping of exact query string -> raw listing
dicts), served by ``_FakeProvider`` below.

Labels in ``cases.json`` describe what a careful HUMAN would decide, not
what the current code happens to produce -- several cases are deliberately
designed to document known weaknesses (see that file's ``notes`` field and
each case's ``description``) and are expected to score as "wrong" today.
That's the point: ``backend/tests/test_eval_accuracy.py`` pins the
*currently measured* accuracy as a floor (a "ratchet") so that:

- regressions are caught immediately (the floor fails if accuracy drops), and
- future beads that fix a documented weakness get to (and must) raise the
  floor -- never lower it.

How to run
----------
From the ``backend/`` directory (with dependencies installed)::

    cd backend && python -m tests.eval.run_eval

This prints a per-case table (id, expected decision, actual decision,
median suggested price, pass/fail) followed by overall decision accuracy
and price-in-range rate.

To use this from other code (e.g. ``test_eval_accuracy.py``)::

    from tests.eval.run_eval import evaluate, load_cases

    report = evaluate(load_cases())
    report.decision_accuracy
    report.price_in_range_rate
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.comparable_search import ComparableListingSearchService
from app.models import Item, ItemStatus
from app.pricing import PricingDecisionService

CASES_PATH = Path(__file__).parent / "cases.json"


class _FakeProvider:
    """``ComparableSearchProvider`` backed by a fixed ``{query: [raw dicts]}`` mapping.

    Any query not present in the mapping returns ``[]`` -- a valid,
    successful zero-result response (per ``cases.json``'s case-authoring
    rules), never an error.

    Accepts ``search(query, **kwargs)`` (not just ``search(query)``) so
    later beads can add keyword arguments (e.g. ``exclude=``) to the
    ``ComparableSearchProvider`` protocol without breaking this fake.
    """

    def __init__(self, provider_results: dict[str, list[dict[str, Any]]]) -> None:
        self._provider_results = provider_results

    def search(self, query: str, **kwargs: Any) -> list[dict[str, Any]]:
        return list(self._provider_results.get(query, []))


@dataclass
class CaseResult:
    id: str
    expected_decision: str
    actual_decision: str
    expected_price_range: list[float] | None
    actual_price: float | None
    decision_correct: bool
    price_in_range: bool | None


@dataclass
class EvalReport:
    results: list[CaseResult] = field(default_factory=list)

    @property
    def decision_accuracy(self) -> float:
        if not self.results:
            return 0.0
        correct = sum(1 for r in self.results if r.decision_correct)
        return correct / len(self.results)

    @property
    def price_in_range_rate(self) -> float:
        """Fraction of cases with a non-null ``expected_price_range`` that passed.

        Cases where ``expected_price_range`` is ``null`` (``price_in_range``
        is ``None``) are excluded from both numerator and denominator --
        there is nothing meaningful to score there.
        """
        scored = [r for r in self.results if r.price_in_range is not None]
        if not scored:
            return 0.0
        correct = sum(1 for r in scored if r.price_in_range)
        return correct / len(scored)


def load_cases(path: Path = CASES_PATH) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data["cases"]


def _build_item(case: dict[str, Any]) -> Item:
    item_data = case["item"]
    return Item(
        photo_path="/photos/eval-fixture.jpg",
        status=ItemStatus.PENDING_SEARCH,
        identified_name=item_data.get("identified_name"),
        brand=item_data.get("brand"),
        condition=item_data.get("condition"),
        search_keywords=item_data.get("search_keywords"),
    )


def evaluate(cases: list[dict[str, Any]]) -> EvalReport:
    report = EvalReport()
    for case in cases:
        item = _build_item(case)
        provider = _FakeProvider(case["provider_results"])
        ComparableListingSearchService(provider=provider).search_item(item)
        decision = PricingDecisionService().decide_item(item)

        actual_decision = decision.value
        expected_decision = case["expected_decision"]
        decision_correct = actual_decision == expected_decision

        expected_price_range = case.get("expected_price_range")
        actual_price = item.suggested_price
        price_in_range: bool | None
        if expected_price_range is None:
            price_in_range = None
        else:
            lo, hi = expected_price_range
            price_in_range = actual_price is not None and lo <= actual_price <= hi

        report.results.append(
            CaseResult(
                id=case["id"],
                expected_decision=expected_decision,
                actual_decision=actual_decision,
                expected_price_range=expected_price_range,
                actual_price=actual_price,
                decision_correct=decision_correct,
                price_in_range=price_in_range,
            )
        )
    return report


def _print_report(report: EvalReport) -> None:
    header = f"{'id':<35} {'expected':<12} {'actual':<12} {'median':>8}  {'pass?'}"
    print(header)
    print("-" * len(header))
    for r in report.results:
        decision_mark = "OK" if r.decision_correct else "FAIL"
        if r.price_in_range is None:
            price_mark = "n/a"
        else:
            price_mark = "OK" if r.price_in_range else "FAIL"
        median_str = f"{r.actual_price:.2f}" if r.actual_price is not None else "None"
        print(
            f"{r.id:<35} {r.expected_decision:<12} {r.actual_decision:<12} "
            f"{median_str:>8}  decision={decision_mark} price={price_mark}"
        )
    print("-" * len(header))
    print(f"Decision accuracy:   {report.decision_accuracy:.4f} ({sum(1 for r in report.results if r.decision_correct)}/{len(report.results)})")
    scored = [r for r in report.results if r.price_in_range is not None]
    print(
        f"Price-in-range rate: {report.price_in_range_rate:.4f} "
        f"({sum(1 for r in scored if r.price_in_range)}/{len(scored)})"
    )


if __name__ == "__main__":
    _print_report(evaluate(load_cases()))
