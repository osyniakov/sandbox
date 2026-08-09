// Hint field + second-independent-upload E2E scenarios (sandbox-634.4)
// against the real deployed app. Two things this bead's brief identified
// as genuinely deterministic/verifiable even though the real vision
// model's specific conclusions are not: (1) the hint field's exact typed
// text is stored and echoed back verbatim on the results page, regardless
// of what the model concludes about the item; (2) a second, independent
// upload reaches SOME terminal decision, and whichever one it is, the UI
// renders it in a structurally correct way. See "What has and hasn't been
// verified" at the bottom of this file for what could and couldn't be
// exercised from this sandbox.

import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signInAs } from './helpers/auth.js'
import {
  assertListingSectionStructure,
  classifyDecisionText,
  waitForTerminalDecisionBadge,
} from './helpers/decision.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Reuses sandbox-634.3's synthetic drill fixture (see that spec's own
// comment for exactly how/why it was generated) -- reusing it here (rather
// than a new photo) is deliberate: the hint text below is written to be
// genuinely accurate for what's depicted in THIS photo, so a real vision
// model reading both the image and the hint shouldn't see any conflict
// between them.
const HINT_FIXTURE_PHOTO_PATH = path.join(
  __dirname,
  'fixtures',
  'bosch-cordless-drill.png'
)

// A synthetic-but-realistic SECOND fixture photo, distinct from the drill
// one, generated once via PIL following the exact same approach as
// bosch-cordless-drill.png (800x600 RGB PNG, white background, a black
// border, a colored rectangle "body", and rendered label text) but styled
// to plausibly read as a low-value/broken item (dull gray body with a
// jagged black "crack" line through it, labeled "Broken Desk Fan / does
// not work") rather than the drill fixture's normal-usable-item look --
// intended to nudge some decision-outcome diversity across this epic's
// real runs, though (per this bead's brief) that's explicitly best-effort,
// not asserted.
const SECOND_FIXTURE_PHOTO_PATH = path.join(
  __dirname,
  'fixtures',
  'broken-desk-fan.png'
)

// Genuinely accurate for HINT_FIXTURE_PHOTO_PATH's depicted/labeled
// content (a Bosch cordless drill, used but functional) -- not a
// hardcoded/generic string, so a real vision model that reads the hint
// alongside the photo shouldn't see it as contradicting what's shown.
const HINT_TEXT =
  'This is a Bosch cordless drill, used but still fully functional.'

test('a hint typed before the photo is stored and echoed back exactly on the results page', async ({
  page,
}) => {
  await signInAs(page)

  // frontend/src/UploadPage.jsx's hint input is
  // `<input id="hint-input" type="text" ...>` under a
  // `<label htmlFor="hint-input">Hint (optional)</label>`, a plain
  // controlled input (`value={hint}` / `onChange={(e) => setHint(...)}`).
  // Its value is only read at upload time, inside handleFileChange's
  // closure over the current `hint` state, at the moment the file input's
  // change event fires and immediately POSTs -- so the hint MUST be typed
  // before the photo is selected, or the upload would already be in
  // flight (or already fired with an empty hint) before the hint value
  // existed. This mirrors the ordering sandbox-iec.5 established for this
  // exact flow.
  const hintInput = page.locator('#hint-input')
  await expect(hintInput).toBeVisible()
  await hintInput.fill(HINT_TEXT)
  await expect(hintInput).toHaveValue(HINT_TEXT)

  // Only now select the photo -- frontend/src/UploadPage.jsx renders the
  // file input as `<input id="photo-input" type="file" ...>`, selecting a
  // file immediately fires handleFileChange, which POSTs to /items
  // (including the hint just typed above) and, on success, navigates to
  // `/items/${data.id}`.
  const photoInput = page.locator('#photo-input')
  await expect(photoInput).toBeVisible()
  await photoInput.setInputFiles(HINT_FIXTURE_PHOTO_PATH)

  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  // Wait for the pipeline to reach a terminal decision (generous real-API
  // timeouts via playwright.config.js, matching sandbox-634.3's pattern)
  // before asserting on the hint display -- per this bead's brief, "after
  // the pipeline completes". (`item.hint` is in fact already present on
  // the very first successful poll response, well before the pipeline
  // reaches a terminal status, since the backend stores the hint at
  // upload time -- but waiting for the terminal badge here keeps this
  // spec's structure/timeout budget consistent with upload-journey.spec.js
  // and confirms the full pipeline run completes successfully with the
  // hint attached, not just that the hint round-trips on an early,
  // possibly-still-processing response.)
  await waitForTerminalDecisionBadge(page, expect)

  // ItemResultPage.jsx renders `{item.hint && <p ...>Your hint:
  // {item.hint}</p>}` -- i.e. a <p> whose full text is the literal
  // "Your hint: " immediately followed by the hint value, no other
  // whitespace. Locate it by that literal prefix (unique on this page --
  // no other rendered text starts with "Your hint:") and assert its full,
  // exact text -- not just a substring/contains check -- to genuinely
  // prove the EXACT typed text reached the backend and came back
  // unmodified, not merely "some hint-shaped text is present".
  const hintParagraph = page.locator('p', { hasText: 'Your hint:' })
  await expect(hintParagraph).toBeVisible()
  await expect(hintParagraph).toHaveText(`Your hint: ${HINT_TEXT}`)
})

test('a second, independent upload (no hint) reaches a terminal decision with structurally correct UI', async ({
  page,
}) => {
  await signInAs(page)

  // No hint this time -- leave `#hint-input` untouched (its default value
  // is the empty string; UploadPage.jsx always appends
  // `formData.append('hint', hint)`, so an empty hint is sent explicitly
  // rather than omitted, which is fine -- ItemResultPage.jsx's
  // `{item.hint && ...}` guard means an empty/falsy hint simply renders no
  // "Your hint: ..." line at all, which this test does not assert on
  // either way).
  const photoInput = page.locator('#photo-input')
  await expect(photoInput).toBeVisible()
  await photoInput.setInputFiles(SECOND_FIXTURE_PHOTO_PATH)

  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  const decisionBadge = await waitForTerminalDecisionBadge(page, expect)
  const badgeText = (await decisionBadge.textContent())?.trim() ?? ''
  const decision = classifyDecisionText(badgeText)

  // Structurally correct UI behavior for WHATEVER decision actually came
  // back -- listing-text section present + non-empty for sell/give_away,
  // explicitly absent for throw_away. Deliberately does not assert which
  // specific decision resulted (per this bead's brief, that's genuinely
  // non-deterministic real-API output this test can't and shouldn't
  // force).
  await assertListingSectionStructure(page, expect, decision)
})

// What has and hasn't been verified for this test (sandbox-634.4)
// -----------------------------------------------------------------
// Same constraint as sandbox-634.2/.3: this sandbox's network egress
// cannot reach *.up.railway.app at all, so this spec has NEVER been run
// against the real deployed app, and this task does not claim it
// "passes" -- that only happens in sandbox-634.8's real Railway run.
//
// What WAS verified locally, using this sandbox's pre-installed Chromium
// via PLAYWRIGHT_CHROMIUM_PATH, against local static HTML fixtures shaped
// like plausible ItemResultPage.jsx DOM (built and then deleted again --
// not part of this commit): the hint-paragraph locator/assertion logic
// above (`page.locator('p', { hasText: 'Your hint:' })` +
// `toHaveText('Your hint: ' + exact text)`) was run against one fixture
// whose hint paragraph's text exactly matched a chosen "typed" hint value
// (passed) and one deliberately-mismatched negative-case fixture whose
// hint paragraph showed a DIFFERENT hint than the "typed" one (correctly
// failed) -- proving the assertion actually discriminates rather than
// passing vacuously. `waitForTerminalDecisionBadge` /
// `classifyDecisionText` / `assertListingSectionStructure`
// (helpers/decision.js) were exercised the same way sandbox-634.3's
// equivalent inline logic was: against sell-shaped, give_away-shaped, and
// throw_away-shaped terminal-state fixtures (all three passed) and a
// throw_away-shaped fixture with the listing section wrongly left present
// (correctly failed). This does NOT verify the real
// upload -> navigation -> polling -> pipeline-completion flow itself,
// including whether the real backend actually stores/echoes the hint
// field the way assumed here, which genuinely cannot be exercised without
// the real backend -- that first happens in sandbox-634.8.
