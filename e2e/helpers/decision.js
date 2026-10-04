// Shared terminal-outcome / listing-structure logic for ItemResultPage.jsx
// (sandbox-634 epic). Factored out of upload-journey.spec.js's inline logic
// (sandbox-634.3) and now used by every real-deployment spec that waits for
// an uploaded item's pipeline to finish (sandbox-tu2/sandbox-7fa).
//
// Every export here takes Playwright's `expect` as an explicit parameter
// rather than importing it itself -- that keeps this module runnable both
// from real `*.spec.js` files (which get `expect` from `@playwright/test`'s
// fixtures) and from ad-hoc verification scripts that construct their own
// `expect` some other way, without this module needing to know which.

// Matches the exact label text ItemResultPage.jsx's DECISION_INFO renders
// for each terminal decision ("Sell" / "Give Away" / "Throw Away") -- see
// that file's DECISION_INFO map. Deliberately does NOT anchor with ^/$
// since the pill also contains an inline-SVG icon; a substring match keeps
// this independent of any icon or decoration markup.
export const DECISION_LABEL_RE = /Sell|Give Away|Throw Away/

// ItemResultPage.jsx polls GET /items/{id} every POLL_INTERVAL_MS while
// status is non-terminal, rendering a `role="status"` processing card
// ("Working on it..." plus a step list) meanwhile, and -- once terminal -- a
// DIFFERENT `role="status"` decision pill containing the decision's label
// ("Sell" / "Give Away" / "Throw Away"). This Locator targets that terminal
// pill specifically (not just any `role="status"`, since the processing
// card is also one).
export function terminalDecisionBadge(page) {
  return page.getByRole('status').filter({ hasText: DECISION_LABEL_RE })
}

// Classifies a decision badge's trimmed textContent into
// 'sell' | 'give_away' | 'throw_away'. Throws (rather than returning
// undefined) if none of the three substrings are present -- should be
// unreachable for text that already matched DECISION_LABEL_RE, but fails
// loudly rather than silently mis-branching if the badge's wording ever
// changes out from under this.
export function classifyDecisionText(badgeText) {
  if (/Throw Away/.test(badgeText)) {
    return 'throw_away'
  }
  if (/Give Away/.test(badgeText)) {
    return 'give_away'
  }
  if (/Sell/.test(badgeText)) {
    return 'sell'
  }
  throw new Error(`Could not classify decision badge text: ${JSON.stringify(badgeText)}`)
}

// Exact copy of ItemResultPage.jsx's FAILURE_MESSAGES (the <p> text inside
// the `role="alert"` block rendered for item.status identification_failed /
// search_failed). MUST be kept in sync with frontend/src/ItemResultPage.jsx.
export const FAILURE_MESSAGES = {
  identification_failed:
    "We couldn't identify this item from the photo. Try a clearer or different photo.",
  search_failed:
    "We identified the item but couldn't find comparable listings right now. Try again later.",
}

function normalizeText(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

// Records a tolerated, non-happy-path outcome so it is visible both in the
// Playwright report (annotation) and in plain run logs (Railway) without
// failing the test. `testInfo` is `test.info()` from the calling spec.
export function reportOutcome(testInfo, description) {
  testInfo.annotations.push({ type: 'outcome', description })
  console.log(`[e2e outcome] ${testInfo.title}: ${description}`)
}

// Waits (one Playwright auto-wait, within the configured expect timeout, no
// manual sleeps) for the item's terminal state: EITHER the decision badge
// OR a `role="alert"` block. An alert whose text exactly equals one of
// FAILURE_MESSAGES is the tolerated "pipeline failed" outcome; ANY OTHER
// alert (e.g. ItemResultPage's `loadError` -- fetch failure / 404 / auth)
// makes this throw with the alert's text. If neither ever appears the
// expect timeout fails the test as before.
//
// Returns { kind: 'decision', decision, badge } or
// { kind: 'failed', status, message }.
export async function waitForTerminalOutcome(page, expect) {
  const badge = terminalDecisionBadge(page)
  const anyAlert = page.getByRole('alert')
  await expect(badge.or(anyAlert).first()).toBeVisible()

  if ((await badge.count()) > 0) {
    // A decision badge must never coexist with any alert (e.g. a failure
    // message), otherwise the page is in an inconsistent state.
    await expect(anyAlert).toHaveCount(0)
    const badgeText = (await badge.first().textContent())?.trim() ?? ''
    return { kind: 'decision', decision: classifyDecisionText(badgeText), badge: badge.first() }
  }

  const alertTexts = (await anyAlert.allTextContents()).map(normalizeText)
  for (const [status, message] of Object.entries(FAILURE_MESSAGES)) {
    if (alertTexts.includes(message)) {
      // A failed item must render neither a decision badge nor a listing.
      await expect(badge).toHaveCount(0)
      await expect(listingHeadingLocator(page)).toHaveCount(0)
      return { kind: 'failed', status, message }
    }
  }
  throw new Error(
    `Unexpected role="alert" on item results page (not a pipeline-failure message): ${JSON.stringify(alertTexts)}`
  )
}

function listingHeadingLocator(page) {
  return page.getByRole('heading', { name: /Suggested Kleinanzeigen listing/i })
}

// Asserts structurally correct rendering of the "Suggested Kleinanzeigen
// listing" section (sandbox-dwl.5) for whichever `decision` actually came
// back, WITHOUT asserting the decision value or the listing text's content
// beyond non-emptiness:
//
//   - sell / give_away: ItemResultPage.jsx renders the section only when
//     suggested_title AND suggested_description are both non-empty, so a
//     sell/give_away decision whose listing-text generation failed
//     legitimately has NO listing section. If the heading is present: its
//     sibling title/description <p> rows must be non-empty. If absent:
//     reported via reportOutcome (not a failure) and `listingPresent:
//     false` is returned.
//   - throw_away (or anything else): the <h3> must be entirely ABSENT
//     (`.toHaveCount(0)`).
//
// Returns { listingPresent, listingHeading, listingSection, titleText,
// descriptionText } (the last three null when no listing).
export async function assertListingSectionStructure(page, expect, decision, testInfo) {
  const listingHeading = listingHeadingLocator(page)

  if (decision === 'sell' || decision === 'give_away') {
    // The listing section renders in the same React render as the decision
    // badge (both are gated on the same terminal item state), so once the
    // badge is visible a single count() is authoritative -- no extra wait.
    if ((await listingHeading.count()) === 0) {
      const description = `${decision} decision reached without generated listing text`
      if (testInfo) {
        reportOutcome(testInfo, description)
      } else {
        console.log(`[e2e outcome] ${description}`)
      }
      return { listingPresent: false, listingHeading, listingSection: null, titleText: null, descriptionText: null }
    }

    await expect(listingHeading).toBeVisible()
    const listingSection = listingHeading.locator('xpath=..')

    // The heading's parent is the listing card, which holds the heading,
    // the "Open Kleinanzeigen" link, then a title row (<p> + "Copy title"
    // button) and a description row (<p> + "Copy description" button).
    // Row labels ("Title"/"Description") are <span>s, so the first <p>
    // descendant is the title and the second is the description.
    const listingParagraphs = listingSection.locator('p')
    const titleText = (await listingParagraphs.nth(0).textContent())?.trim() ?? ''
    const descriptionText = (await listingParagraphs.nth(1).textContent())?.trim() ?? ''
    expect(titleText.length).toBeGreaterThan(0)
    expect(descriptionText.length).toBeGreaterThan(0)
    return { listingPresent: true, listingHeading, listingSection, titleText, descriptionText }
  }

  await expect(listingHeading).toHaveCount(0)
  return { listingPresent: false, listingHeading, listingSection: null, titleText: null, descriptionText: null }
}
