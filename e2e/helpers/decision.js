// Shared decision-badge / listing-structure logic for ItemResultPage.jsx
// (sandbox-634 epic). Factored out of upload-journey.spec.js's inline
// logic (sandbox-634.3) so hint-and-second-item.spec.js (sandbox-634.4)
// doesn't have to duplicate it -- upload-journey.spec.js itself is
// deliberately left untouched (already implemented/reviewed by an earlier
// bead) rather than retrofitted to import from here, so some of this
// logic's shape still exists twice in the repo (here, and inline in
// upload-journey.spec.js); this file at least stops that duplication from
// growing with every future scenario spec.
//
// Every export here takes Playwright's `expect` as an explicit parameter
// rather than importing it itself -- that keeps this module runnable both
// from real `*.spec.js` files (which get `expect` from `@playwright/test`'s
// fixtures) and from ad-hoc verification scripts that construct their own
// `expect` some other way, without this module needing to know which.

// Matches the exact label text ItemResultPage.jsx's DECISION_INFO renders
// for each terminal decision ("Sell" / "Give Away" / "Throw Away") -- see
// that file's DECISION_INFO map. Deliberately does NOT anchor with ^/$
// since the rendered badge text also includes a leading aria-hidden emoji
// icon character (e.g. "\u{1F4B0} Sell") that a substring match sidesteps
// needing to account for.
export const DECISION_LABEL_RE = /Sell|Give Away|Throw Away/

// ItemResultPage.jsx polls GET /items/{id} every POLL_INTERVAL_MS while
// status is non-terminal, rendering a `role="status"` "Still working on
// this item (status: ...)..." message meanwhile, and -- once terminal -- a
// DIFFERENT `role="status"` badge containing the decision's label ("Sell" /
// "Give Away" / "Throw Away"). This waits for that terminal badge
// specifically (not just any `role="status"`, since the non-terminal
// message is also one) using Playwright's own auto-waiting/polling against
// the caller's configured expect timeout -- no manual sleep -- and returns
// its Locator.
export function terminalDecisionBadge(page) {
  return page.getByRole('status').filter({ hasText: DECISION_LABEL_RE })
}

export async function waitForTerminalDecisionBadge(page, expect) {
  const decisionBadge = terminalDecisionBadge(page)
  await expect(decisionBadge).toBeVisible()
  return decisionBadge
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

// Asserts structurally correct rendering of the "Suggested Kleinanzeigen
// listing" section (sandbox-dwl.5) for whichever `decision` actually came
// back, WITHOUT asserting anything about the specific decision value
// itself or the listing text's content beyond non-emptiness:
//
//   - sell / give_away: the "Suggested Kleinanzeigen listing" <h3> and its
//     sibling title/description <p> rows must be present, and both the
//     title and description text must be non-empty.
//   - throw_away (or anything else): that same <h3> must be entirely
//     ABSENT from the DOM (`.toHaveCount(0)`, not just hidden) -- the
//     idiom for "this locator matches nothing at all", which is the
//     correct assertion for a conditionally-rendered React block that
//     either mounts or doesn't.
//
// Mirrors ItemResultPage.jsx's real conditional render: the section is
// only ever rendered when decision is sell/give_away AND both
// suggested_title and suggested_description are non-empty; it shares a
// common parent `<div>` with its own `<h3>Suggested Kleinanzeigen
// listing</h3>` heading immediately above the title/description rows, in
// that DOM order -- walk from the heading to that parent rather than
// depending on any CSS class names.
export async function assertListingSectionStructure(page, expect, decision) {
  const listingHeading = page.getByRole('heading', {
    name: /Suggested Kleinanzeigen listing/i,
  })

  if (decision === 'sell' || decision === 'give_away') {
    await expect(listingHeading).toBeVisible()
    const listingSection = listingHeading.locator('xpath=..')

    // JSX order inside listingSection is: h3, then a title row (<p> +
    // "Copy title" button), then a description row (<p> + "Copy
    // description" button) -- so the first <p> descendant is the title,
    // the second is the description.
    const listingParagraphs = listingSection.locator('p')
    const titleText = (await listingParagraphs.nth(0).textContent())?.trim() ?? ''
    const descriptionText = (await listingParagraphs.nth(1).textContent())?.trim() ?? ''
    expect(titleText.length).toBeGreaterThan(0)
    expect(descriptionText.length).toBeGreaterThan(0)
    return { listingHeading, listingSection, titleText, descriptionText }
  }

  await expect(listingHeading).toHaveCount(0)
  return { listingHeading, listingSection: null, titleText: null, descriptionText: null }
}
