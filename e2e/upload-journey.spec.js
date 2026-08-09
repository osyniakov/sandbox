// Primary happy-path E2E scenario (sandbox-634.3): sign in, upload a real
// (synthetic-but-realistic) photo, and let the FULL real pipeline run --
// real Claude vision identification, real Kleinanzeigen comparable search,
// real Claude listing-text generation -- against the real deployed app
// (see playwright.config.js / e2e/README.md). Because the decision (sell /
// give_away / throw_away) is a genuine, non-deterministic result of real
// third-party calls, this test does NOT assume or force a specific
// decision -- it asserts structurally correct UI behavior for WHATEVER
// decision actually comes back, branching its assertions on the real
// result. See "What has and hasn't been verified" at the bottom of this
// file for exactly what could and couldn't be exercised from this sandbox.

import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signInAs } from './helpers/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// A synthetic-but-realistic fixture photo: an 800x600 PNG with a white
// border and an orange rectangle body labeled "Bosch Cordless Drill /
// used, good condition" (generated once via PIL, no real photo could be
// sourced in this sandbox). Real vision models can generally still read
// text rendered into an image, so
// even though this isn't a genuine photograph, it's a plausible stand-in
// that should let the real pipeline produce SOME identification -- this
// test's assertions don't depend on that identification being any
// particular value, only on the pipeline reaching a terminal state.
const FIXTURE_PHOTO_PATH = path.join(
  __dirname,
  'fixtures',
  'bosch-cordless-drill.png'
)

// Matches the exact label text ItemResultPage.jsx's DECISION_INFO renders
// for each terminal decision ("Sell" / "Give Away" / "Throw Away") -- see
// that file's DECISION_INFO map. Deliberately does NOT anchor with ^/$
// since the rendered badge text also includes a leading aria-hidden emoji
// icon character (e.g. "\u{1F4B0} Sell") that a substring match sidesteps
// needing to account for.
const DECISION_LABEL_RE = /Sell|Give Away|Throw Away/

test('uploading a real photo runs the full pipeline and reaches a terminal decision', async ({
  page,
  context,
}) => {
  // Needed up front for the later clipboard-copy assertion (sell/give_away
  // branch) -- granted before any navigation happens, same as the pattern
  // this bead's brief calls for.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  await signInAs(page)

  // frontend/src/UploadPage.jsx renders the file input as
  // `<input id="photo-input" type="file" ...>` under a
  // `<label htmlFor="photo-input">Take or choose a photo</label>` (or
  // "Uploading..." while a request is in flight) -- select it directly by
  // id, which is exact and doesn't depend on the label's current wording.
  const photoInput = page.locator('#photo-input')
  await expect(photoInput).toBeVisible()
  await photoInput.setInputFiles(FIXTURE_PHOTO_PATH)

  // UploadPage.jsx's handleFileChange POSTs to /items and, on success,
  // navigates to `/items/${data.id}` (see its `navigate(...)` call) --
  // this confirms the upload itself succeeded and the app moved on to the
  // item's results page, before we start polling that page for the
  // pipeline's outcome.
  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  // ItemResultPage.jsx polls GET /items/{id} every POLL_INTERVAL_MS while
  // status is non-terminal, rendering a `role="status"` "Still working on
  // this item (status: ...)..." message meanwhile, and -- once terminal --
  // a DIFFERENT `role="status"` badge containing the decision's label
  // ("Sell" / "Give Away" / "Throw Away"). Wait for the terminal badge
  // specifically (not just any `role="status"`, since the non-terminal
  // message is also one) using Playwright's own auto-waiting/polling
  // against the config's generous default expect timeout -- no manual
  // sleep -- since this covers the real pipeline's real latency (Claude
  // vision + Kleinanzeigen search + Claude listing-text generation).
  const decisionBadge = page
    .getByRole('status')
    .filter({ hasText: DECISION_LABEL_RE })
  await expect(decisionBadge).toBeVisible()

  const badgeText = (await decisionBadge.textContent())?.trim() ?? ''
  let decision
  if (/Throw Away/.test(badgeText)) {
    decision = 'throw_away'
  } else if (/Give Away/.test(badgeText)) {
    decision = 'give_away'
  } else if (/Sell/.test(badgeText)) {
    decision = 'sell'
  } else {
    // Should be unreachable given the `.filter()` above already required
    // one of these three substrings to be present -- but fail loudly
    // rather than silently mis-branching if the badge's wording ever
    // changes out from under this regex.
    throw new Error(`Could not classify decision badge text: ${JSON.stringify(badgeText)}`)
  }

  // --- Branch assertions on whichever real decision actually came back ---

  // The "Suggested Kleinanzeigen listing" section (sandbox-dwl.5) is only
  // ever rendered by ItemResultPage.jsx when decision is sell/give_away
  // AND both suggested_title and suggested_description are non-empty
  // (see its conditional render, keyed off `item.suggested_title &&
  // item.suggested_description`). It shares a common parent `<div>` with
  // its own `<h3>Suggested Kleinanzeigen listing</h3>` heading immediately
  // above the title/description rows, in that DOM order -- walk from the
  // heading to that parent rather than depending on any CSS class names.
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

    // CopyButton (ItemResultPage.jsx) renders "Copy title" for the title
    // instance (label="title") and copies `item.suggested_title` via
    // navigator.clipboard.writeText on click. Verify the round trip: click
    // it, then read back the REAL clipboard content and assert it matches
    // the REAL displayed title exactly (not a hardcoded string, since the
    // title itself is real/unpredictable LLM output).
    const copyTitleButton = listingSection.getByRole('button', {
      name: /^Copy title$/i,
    })
    await expect(copyTitleButton).toBeVisible()
    await copyTitleButton.click()

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText()
    )
    expect(clipboardText).toBe(titleText)
  } else {
    // throw_away: the listing-text section must be explicitly ABSENT from
    // the DOM (not merely hidden) -- `.toHaveCount(0)` is the idiom for
    // "this locator matches nothing at all", as opposed to
    // `.not.toBeVisible()` which would also pass for an element that
    // exists but is hidden (not the case here, but `.toHaveCount(0)` is
    // the more precise assertion of the two for a conditionally-rendered
    // React block).
    await expect(listingHeading).toHaveCount(0)
  }

  // --- Comparable listings: real-looking data if any were found ---
  //
  // ItemResultPage.jsx always renders a "Comparable listings" <h3> once
  // terminal, followed by either a "No comparable listings found." <p>, or
  // a <ul> of <li> entries (each with a title link and a price in EUR).
  // Real Kleinanzeigen search results vary run to run, so this only
  // asserts "if any rendered, they look real" -- not a specific count.
  const comparableHeading = page.getByRole('heading', {
    name: /Comparable listings/i,
  })
  await expect(comparableHeading).toBeVisible()
  const comparableSection = comparableHeading.locator('xpath=..')
  const comparableItems = comparableSection.locator('li')
  const comparableCount = await comparableItems.count()

  if (comparableCount > 0) {
    const firstItem = comparableItems.first()
    const firstItemText = (await firstItem.textContent())?.trim() ?? ''
    expect(firstItemText.length).toBeGreaterThan(0)
    // Each <li> renders `<a>{listing.title}</a> — {price} EUR...` -- a
    // visible link with non-empty text is the title; the surrounding text
    // node carries the price, checked via the "EUR" that's always
    // interpolated alongside `listing.price.toFixed(2)`.
    const firstItemLink = firstItem.locator('a')
    await expect(firstItemLink).toBeVisible()
    expect((await firstItemLink.textContent())?.trim().length).toBeGreaterThan(0)
    expect(firstItemText).toMatch(/EUR/)
  }
})

// What has and hasn't been verified for this test (sandbox-634.3)
// -----------------------------------------------------------------
// This sandbox's network egress cannot reach *.up.railway.app at all (the
// same constraint documented in e2e/README.md for sandbox-634.2), so this
// spec has NEVER been run against the real deployed app, and this task
// does not claim it "passes" -- that only happens in sandbox-634.8's real
// Railway run, which will exercise the real upload -> real navigation ->
// real pipeline polling -> real decision end to end for the first time.
//
// What WAS verified locally, against local static HTML fixtures shaped
// like plausible ItemResultPage.jsx DOM (one for a sell/give_away-like
// terminal state with a populated listing section and comparable listings,
// one for a throw_away-like terminal state with the listing section
// entirely absent), using this sandbox's pre-installed Chromium via
// PLAYWRIGHT_CHROMIUM_PATH: that this file's decision-branching logic
// (classifying the badge text into sell/give_away/throw_away), the
// sell/give_away listing-section + title/description + copy-button +
// clipboard-readback assertions, the throw_away listing-section-absence
// assertion, and the comparable-listings assertions are all
// structurally/syntactically sound and exercise the DOM the way intended
// -- i.e. they pass against a fixture shaped like the real "sell" state and
// a fixture shaped like the real "throw_away" state, and fail if the
// listing section is wrongly present/absent for either. This does NOT
// verify the real upload -> navigation -> polling flow itself (the file
// input -> POST /items -> navigate(`/items/:id`) -> real pipeline
// completing), which genuinely cannot be exercised without the real
// backend.
