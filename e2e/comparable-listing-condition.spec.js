// Comparable-listing "brand new" condition scenario (sandbox-igd.2), part
// of the sandbox-634-epic-conventions E2E suite that drives a real browser
// against the ALREADY-DEPLOYED real frontend + backend (Railway). This
// exercises the sandbox-igd.1 backend change (backend/app/pricing.py's
// `_is_new_condition`/`_median_price`, which excludes genuinely-new-
// condition comparable listings from the median-price calculation): here
// we assert the corresponding FRONTEND-visible invariant that no
// comparable-listing entry ever rendered on a terminal item's results page
// displays an unambiguous "brand new" condition label.
//
// IMPORTANT non-determinism note (matching this suite's existing honesty
// conventions -- see upload-journey.spec.js / hint-and-second-item.spec.js
// "What has and hasn't been verified" sections): real Kleinanzeigen search
// results are non-deterministic across runs. sandbox-igd.1 does NOT filter
// "new"-condition listings out of `item.comparable_listings` itself (only
// out of the *median-price calculation* -- ItemResultPage.jsx still
// renders every comparable listing the backend returns, including any
// "new"-labeled ones), so this test's negative assertion below (no
// rendered listing text matches an unambiguous "brand new" marker) is
// checked against whatever comparable listings a real run happens to
// surface. In any SINGLE real run, it is entirely possible -- expected,
// even -- that zero comparable listings are "new"-labeled (or that there
// are zero comparable listings at all), in which case this assertion is
// trivially satisfied without ever having been meaningfully exercised
// against a true "new"-labeled listing. That is expected and does not
// indicate a bug in this test; see the local-fixture verification
// described in this bead's implementation notes for a true positive/
// negative proof of the matching logic itself (not committed here, per
// this suite's established practice -- built and torn down locally
// instead).

import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signInAs } from './helpers/auth.js'
import { waitForTerminalDecisionBadge } from './helpers/decision.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Reuses sandbox-634.3's synthetic drill fixture -- no reason for a new
// fixture photo here, since this scenario only cares about the terminal
// comparable-listings section, not about which specific item gets
// identified.
const FIXTURE_PHOTO_PATH = path.join(
  __dirname,
  'fixtures',
  'bosch-cordless-drill.png'
)

// --- Pure, separately-testable "unambiguous brand-new" text matcher ---
//
// Deliberately mirrors, but is a SEPARATE implementation from,
// backend/app/pricing.py's `_is_new_condition` (see that function's own
// docstring/comment for the reasoning behind its exact marker/exclusion
// sets). This function operates on a comparable listing's full RENDERED
// <li> text (title + price + condition + location all concatenated by
// ItemResultPage.jsx -- see `{listing.condition && `, ${listing.condition}`}`
// in frontend/src/ItemResultPage.jsx), not on an isolated condition
// string, so it uses word-boundary matching rather than the backend's
// exact-string equality (after strip+lowercase) -- but the underlying
// marker/exclusion vocab is intentionally kept in lockstep with the
// backend's `_NEW_CONDITION_VALUES` (minus the more specific
// "originalverpackt (ovp), neu" phrase, which already contains "neu" as
// a matched whole word and so doesn't need its own separate entry here).
//
// DRIFT RISK: because this is a second, independently-maintained copy of
// the same "what counts as unambiguously new" vocabulary, it is possible
// for this list and the backend's `_NEW_CONDITION_VALUES` to drift apart
// over time (e.g. if the backend set is extended and this one isn't
// updated to match). If that's ever noticed, it's worth flagging/fixing
// in both places together.
const NEW_CONDITION_MARKERS = ['neu', 'brandneu', 'new', 'brand new']

// Used-but-excellent-condition phrasing that must NEVER be flagged as
// "brand new" -- mirrors the backend docstring's explicit examples of
// what must stay excluded.
const EXCLUDED_NEW_LOOKALIKE_PHRASES = ['wie neu', 'neuwertig', 'like new', 'as new']

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Builds a case-insensitive whole-word/whole-phrase RegExp for `phrase`
// (internal whitespace, if any, matches one-or-more whitespace chars so
// e.g. "wie neu" also matches "wie  neu" / "wie\nneu").
function wholePhraseRegExp(phrase) {
  const pattern = escapeRegExp(phrase).replace(/ /g, '\\s+')
  return new RegExp(`\\b${pattern}\\b`, 'gi')
}

// Returns true only if `text` contains an unambiguous "brand new /
// unopened / never used" marker as a whole word/phrase (NOT a substring
// match -- e.g. must not fire on "Neuss" or "renewed"). Explicitly does
// NOT flag used-but-excellent phrasing ("wie neu"/"neuwertig"/"like
// new"/"as new") even though some of those phrases contain a marker word
// as their own whole word (e.g. "neu" inside "wie neu") -- those
// exclusion phrases are stripped out of a working copy of the text
// BEFORE the marker check runs, specifically to prevent that false
// positive.
export function isUnambiguousNewConditionLabel(text) {
  if (!text) {
    return false
  }
  let working = text
  for (const phrase of EXCLUDED_NEW_LOOKALIKE_PHRASES) {
    working = working.replace(wholePhraseRegExp(phrase), ' ')
  }
  return NEW_CONDITION_MARKERS.some((marker) => wholePhraseRegExp(marker).test(working))
}

test('no rendered comparable listing shows an unambiguous "brand new" condition label', async ({
  page,
}) => {
  await signInAs(page)

  const photoInput = page.locator('#photo-input')
  await expect(photoInput).toBeVisible()
  await photoInput.setInputFiles(FIXTURE_PHOTO_PATH)

  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  await waitForTerminalDecisionBadge(page, expect)

  // Mirrors upload-journey.spec.js's exact locator approach: walk from the
  // "Comparable listings" <h3> heading to its shared parent <div>, then
  // collect that section's <li> entries (ItemResultPage.jsx always renders
  // the heading once terminal, followed by either a "No comparable
  // listings found." <p> or a <ul> of <li> entries).
  const comparableHeading = page.getByRole('heading', {
    name: /Comparable listings/i,
  })
  await expect(comparableHeading).toBeVisible()
  const comparableSection = comparableHeading.locator('xpath=..')
  const comparableItems = comparableSection.locator('li')
  const comparableCount = await comparableItems.count()

  // Zero comparable listings is a valid, non-failing outcome -- real
  // Kleinanzeigen results vary run to run, and this suite never forces a
  // specific listing count (see upload-journey.spec.js's equivalent
  // comment).
  for (let i = 0; i < comparableCount; i += 1) {
    const itemText = (await comparableItems.nth(i).textContent())?.trim() ?? ''
    // Scope the match to ONLY the portion of the rendered text AFTER the
    // price (i.e. after "EUR"), not the full <li> text. ItemResultPage.jsx
    // always renders `{title} — {price} EUR, {condition}, {location}`, so
    // the title (which precedes "EUR") is real, uncontrolled Kleinanzeigen
    // listing text and very commonly contains marketing language like
    // "NEU" even when the actual scraped `condition` field is "gebraucht"
    // (used) -- backend/app/pricing.py's `_is_new_condition` only ever
    // looks at the structured `condition` field, never the title. Matching
    // against the full text would therefore false-positive on such
    // listings; matching only the post-"EUR" suffix (condition + location)
    // keeps this test aligned with what the backend actually considers.
    const priceMarkerIndex = itemText.indexOf('EUR')
    const conditionAndLocationText =
      priceMarkerIndex === -1 ? itemText : itemText.slice(priceMarkerIndex + 'EUR'.length)
    expect(
      isUnambiguousNewConditionLabel(conditionAndLocationText),
      `comparable listing #${i} rendered an unambiguous "brand new" ` +
        `condition label (should have been excluded from pricing and, per ` +
        `this bead's intent, should not read as brand-new to a user either): ${JSON.stringify(itemText)}`
    ).toBe(false)
  }
})
