"""Baseline-ratchet test for the offline labelled evaluation harness (bead sandbox-8jm.1).

Runs ``tests.eval.run_eval.evaluate`` over ``tests/eval/cases.json`` and
asserts that decision accuracy and the price-in-range rate never regress
below the currently-measured baseline.

DECISION_ACCURACY_FLOOR and PRICE_RANGE_FLOOR below are set to exactly the
values measured at the time this test was written (rounded DOWN to 2
decimal places), NOT to 1.0 -- several cases in cases.json intentionally
document known weaknesses in app/comparable_search.py and app/pricing.py
(see that file's per-case ``description`` fields) and are expected to fail
today. This is a ratchet, not a target: later beads that fix one of those
documented weaknesses MUST raise these floors to match the new, higher
measured value -- never lower them. If a change legitimately regresses
accuracy, that's a real bug to fix, not a floor to relax.
"""

from __future__ import annotations

from tests.eval.run_eval import evaluate, load_cases

# Raised by bead sandbox-8jm.4 (measured: decision_accuracy == 14/14 ==
# 1.0, price_in_range_rate == 9/11 == 0.818181...), rounded down. This bead
# added defekt/Bastler/Ersatzteile exclusion, which fixed
# ``defekt_majority_for_working_item`` (previously the sole decision
# failure and a price failure too).
# Previous baseline (bead sandbox-8jm.3): decision_accuracy == 13/14 ==
# 0.928571..., price_in_range_rate == 8/11 == 0.727272... (0.92 / 0.72).
# Earlier baseline (bead sandbox-8jm.1): decision_accuracy == 11/14 ==
# 0.785714..., price_in_range_rate == 6/11 == 0.545454... (0.78 / 0.54).
DECISION_ACCURACY_FLOOR = 1.0
PRICE_RANGE_FLOOR = 0.81


def test_eval_accuracy_meets_baseline_floor():
    report = evaluate(load_cases())

    assert report.decision_accuracy >= DECISION_ACCURACY_FLOOR, (
        f"Decision accuracy {report.decision_accuracy:.4f} dropped below the "
        f"baseline floor {DECISION_ACCURACY_FLOOR}"
    )
    assert report.price_in_range_rate >= PRICE_RANGE_FLOOR, (
        f"Price-in-range rate {report.price_in_range_rate:.4f} dropped below the "
        f"baseline floor {PRICE_RANGE_FLOOR}"
    )
