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

# Raised by bead sandbox-0as (measured: decision_accuracy == 16/16 == 1.0,
# price_in_range_rate == 11/12 == 0.916666...), rounded down. This bead
# stopped forwarding `exclude=` to the kleinanzeigen-api provider (it was
# applying a plain substring match against title+description, silently
# dropping good negated listings like "nicht defekt") and made the local
# `_filter_broken_listing_titles` negation-aware instead. Added a new case,
# ``negated_broken_terms_stay_included`` (working item whose comparables use
# "nicht defekt" / "kein Bastlerartikel" / "defektfrei" phrasing plus one
# genuinely broken listing), which the pre-sandbox-0as code got wrong
# (measured on the same cases.json against pre-sandbox-0as code:
# decision_accuracy == 15/16 == 0.9375, price_in_range_rate == 10/12 ==
# 0.833333... -- the negated listings were all dropped, leaving zero
# comparables and a throw_away decision).
# Previous baseline (bead sandbox-8jm.5): decision_accuracy == 15/15 ==
# 1.0, price_in_range_rate == 10/11 == 0.909090... (1.0 / 0.90).
# Earlier baseline (bead sandbox-8jm.4): decision_accuracy == 14/14 ==
# 1.0, price_in_range_rate == 9/11 == 0.818181... (1.0 / 0.81).
# Earlier baseline (bead sandbox-8jm.3): decision_accuracy == 13/14 ==
# 0.928571..., price_in_range_rate == 8/11 == 0.727272... (0.92 / 0.72).
# Earlier baseline (bead sandbox-8jm.1): decision_accuracy == 11/14 ==
# 0.785714..., price_in_range_rate == 6/11 == 0.545454... (0.78 / 0.54).
#
# Raised by bead sandbox-182 (German spelling-variant tolerance in
# ``_is_relevant``/``_build_query_attempts`` -- umlaut digraph/plain
# folding, hyphen/space-split compound compaction, plural stemming, and
# per-token multi-word brand exclusion). Added two new cases, both measured
# WRONG on pre-sandbox-182 code (decision_accuracy 16/18 == 0.8889,
# price_in_range_rate 11/14 == 0.7857..., confidence_accuracy 13/14 ==
# 0.9286... on the same cases.json): ``fallback_spelling_variants_accepted``
# (the plain casefolded-substring gate rejected all 4 differently-spelled
# comparables, leaving zero comparables -> throw_away instead of sell) and
# ``multiword_brand_fallback_skipped`` (the differently-punctuated
# brand-only keyword "Black+Decker" isn't an exact string match of "Black &
# Decker", so pre-sandbox-182's whole-string brand comparison neither
# skipped it as a fallback query nor excluded its tokens from the relevance
# gate, wrongly pricing the item off unrelated Black & Decker appliance
# junk -> give_away instead of sell). Measured on sandbox-182 code:
# decision_accuracy == 18/18 == 1.0, price_in_range_rate == 13/14 ==
# 0.928571..., confidence_accuracy == 14/14 == 1.0.
#
# Raised by bead sandbox-3ht (relevance gate: plain-mode length floor for
# umlaut-folded tokens, plus a word-boundary rule -- title word must END
# with the matching unit -- for short (< 5 char) matching units, instead of
# a bare compact-title substring check). Added one new case,
# ``short_umlaut_word_no_false_match`` (name "Tür" against a mix of 3
# unrelated titles that merely contain "tur"/"tuer" as a substring and 3
# genuinely relevant door listings), measured WRONG on pre-sandbox-3ht code
# (on the same cases.json: decision_accuracy 19/19 == 1.0 unaffected --
# "sell" was still the right call either way -- but price_in_range_rate
# 13/15 == 0.8667, since the 3 unrelated, low-priced listings weren't
# filtered out and dragged the median from ~55 down to 27, outside the
# expected [30, 80] range). Measured on sandbox-3ht code: decision_accuracy
# == 19/19 == 1.0, price_in_range_rate == 14/15 == 0.933333...,
# confidence_accuracy == 15/15 == 1.0.
DECISION_ACCURACY_FLOOR = 1.0
PRICE_RANGE_FLOOR = 0.93

# Added by bead sandbox-8jm.6 (``Item.decision_confidence``, measured:
# confidence_accuracy == 11/11 == 1.0 across the cases that carry an
# ``expected_confidence`` label -- see ``cases.json``; cases documenting
# other known weaknesses deliberately don't carry that label yet). Same
# ratchet convention as the two floors above: later beads may raise this
# (e.g. by labelling more cases) but must never lower it.
# Still 1.0 after bead sandbox-0as's new labelled case (measured: 12/12).
# Still 1.0 after bead sandbox-182's two new labelled cases (measured: 14/14).
# Still 1.0 after bead sandbox-3ht's new labelled case (measured: 15/15).
CONFIDENCE_ACCURACY_FLOOR = 1.0


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
    assert report.confidence_accuracy >= CONFIDENCE_ACCURACY_FLOOR, (
        f"Confidence accuracy {report.confidence_accuracy:.4f} dropped below the "
        f"baseline floor {CONFIDENCE_ACCURACY_FLOOR}"
    )
