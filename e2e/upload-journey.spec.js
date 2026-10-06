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
import {
  assertListingSectionStructure,
  reportOutcome,
  waitForTerminalOutcome,
} from './helpers/decision.js'

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

test('uploading a real photo runs the full pipeline and reaches a terminal outcome', async ({
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
  await page.getByRole('button', { name: /upload \d+ photos?/i }).click()

  // Selecting the file only adds it to the photo tray; the "Upload 1 photo"
  // click above triggers UploadPage.jsx's handleSubmit, which POSTs to /items and, on success,
  // navigates to `/items/${data.id}` (see its `navigate(...)` call) --
  // this confirms the upload itself succeeded and the app moved on to the
  // item's results page, before we start polling that page for the
  // pipeline's outcome.
  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  // Wait (single auto-wait, generous real-API timeout from the config) for
  // either the decision badge or the pipeline-failure alert; any other
  // alert (e.g. loadError) fails the test. See helpers/decision.js.
  const outcome = await waitForTerminalOutcome(page, expect)
  if (outcome.kind === 'failed') {
    // identification_failed / search_failed is a tolerated real-API outcome;
    // the helper already verified the exact message and that no badge or
    // listing is rendered. No comparable-listings section exists either.
    reportOutcome(test.info(), `pipeline ended in ${outcome.status}`)
    return
  }

  // Listing section: required (and structurally checked) for sell/give_away
  // when generation succeeded, reported-but-tolerated when it didn't,
  // absent for throw_away.
  const { listingPresent, listingSection, titleText } = await assertListingSectionStructure(
    page,
    expect,
    outcome.decision,
    test.info()
  )

  if (listingPresent) {
    // CopyButton (ItemResultPage.jsx) renders "Copy title" for the title
    // instance and copies `item.suggested_title` via
    // navigator.clipboard.writeText on click. Read back the REAL clipboard
    // and compare to the REAL displayed title (real LLM output).
    const copyTitleButton = listingSection.getByRole('button', {
      name: /^Copy title$/i,
    })
    await expect(copyTitleButton).toBeVisible()
    await copyTitleButton.click()

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText()
    )
    expect(clipboardText).toBe(titleText)
  }

  // --- Comparable listings: real-looking data if any were found ---
  //
  // ItemResultPage.jsx always renders a "Comparable listings" <h3> for a
  // decided item (not for failed ones, handled above), followed by either
  // a "No comparable listings found." <p>, or a <ul> of <li> entries (each
  // with a title link and a formatPrice-style price such as "€45" or "€45.50").
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
    // Each <li> renders `<a>{listing.title}</a>`, a price span formatted
    // via formatPrice (e.g. "€45", "€45.50"), then a condition/location
    // span -- a visible link with non-empty text is the title; the price
    // is checked via the "€" followed by a digit.
    const firstItemLink = firstItem.locator('a')
    await expect(firstItemLink).toBeVisible()
    expect((await firstItemLink.textContent())?.trim().length).toBeGreaterThan(0)
    expect(firstItemText).toMatch(/€\s?\d/)
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
