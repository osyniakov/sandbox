// Inventory listing, manual status transition, sign-out, and
// unauthenticated-access E2E scenarios (sandbox-634.5) against the real
// deployed app. Three independent scenarios in this one file:
//
//   1. Upload a real item, wait for it to reach a terminal decision, find
//      it in `/inventory`, and exercise a real manual status transition
//      (`PATCH /items/{id}/status`) against it, asserting the UI reflects
//      the new status afterward.
//   2. Sign out from an authenticated page and assert the app reverts to
//      the sign-in gate -- both immediately (React state) and after a
//      full page reload (proving the session token was actually cleared
//      from localStorage, not just hidden in React state).
//   3. Navigate directly to an authenticated route with no session token
//      at all and assert the sign-in gate is shown instead of the
//      requested page's content.
//
// See "What has and hasn't been verified" at the bottom of this file for
// exactly what could and couldn't be exercised from this sandbox.

import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SESSION_TOKEN_STORAGE_KEY, signInAs } from './helpers/auth.js'
import { classifyDecisionText, waitForTerminalDecisionBadge } from './helpers/decision.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Reuses sandbox-634.3's synthetic drill fixture (see that spec's own
// comment for exactly how/why it was generated) -- there's nothing about
// this scenario that needs a different photo.
const FIXTURE_PHOTO_PATH = path.join(__dirname, 'fixtures', 'bosch-cordless-drill.png')

// Which manual transition (`PATCH /items/{id}/status` target) this test
// exercises for whatever real `decision` the uploaded item actually
// lands on. Note this is a semantic/representative choice, NOT one the
// backend actually enforces: backend/app/main.py's MANUAL_STATUS_TRANSITIONS
// state machine keys its allowed-next-statuses purely off `Item.status`
// (not `Item.decision`) -- and backend/app/pricing.py's
// `compute_decision` sets `item.status = ItemStatus.DECIDED` for EVERY
// decision (sell, give_away, and throw_away alike). So once an item is
// terminal, `MANUAL_STATUS_TRANSITIONS[DECIDED]` (`listed`, `given_away`,
// `disposed`) is identically available regardless of which decision it
// got -- there's no decision-gated subset to pick from. This map instead
// picks whichever one of those three is the most natural real-world
// action for that decision (list a "sell" item, mark a "give_away" item
// given away, dispose of a "throw_away" item), purely to keep this test's
// UI action meaningful; any of the three would equally be accepted by
// the real backend for a `decided` item.
const DECISION_TO_TARGET_STATUS = {
  sell: 'listed',
  give_away: 'given_away',
  throw_away: 'disposed',
}

// Mirrors InventoryPage.jsx's own STATUS_ACTION_LABELS map (the visible
// text of each manual-transition button) and STATUS_LABELS map (the
// visible "Status: ..." text after a transition) -- kept here as regexes
// rather than importing the JSX (this is a plain Node/Playwright context,
// not a React one) since InventoryPage.jsx doesn't export either map
// separately from the component.
const STATUS_ACTION_LABEL_RE = {
  listed: /^Mark as listed on Kleinanzeigen$/,
  given_away: /^Mark as given away$/,
  disposed: /^Mark as disposed$/,
}

const STATUS_DISPLAY_LABEL = {
  listed: 'Listed',
  given_away: 'Given away',
  disposed: 'Disposed',
}

test('an uploaded item appears in /inventory and a manual status transition updates its displayed status', async ({
  page,
}) => {
  await signInAs(page)

  // Same upload flow as sandbox-634.3/.4: select the fixture photo via
  // UploadPage.jsx's `#photo-input`, which POSTs to /items and navigates
  // to `/items/${data.id}` on success.
  const photoInput = page.locator('#photo-input')
  await expect(photoInput).toBeVisible()
  await photoInput.setInputFiles(FIXTURE_PHOTO_PATH)
  await expect(page).toHaveURL(/\/items\/[^/]+$/)

  // Extract the real item id from the URL -- needed below to
  // unambiguously find THIS item's row in the inventory list, since the
  // shared E2E test identity may have other items from earlier runs of
  // this suite (sandbox-634.3/.4/this file's own uploads) sitting in the
  // same inventory.
  const itemUrl = new URL(page.url())
  const itemIdMatch = itemUrl.pathname.match(/\/items\/([^/]+)$/)
  if (!itemIdMatch) {
    throw new Error(`Could not extract item id from URL: ${itemUrl.pathname}`)
  }
  const itemId = itemIdMatch[1]

  // Wait for the real pipeline to reach a terminal decision (generous
  // real-API timeouts via playwright.config.js) -- manual status
  // transitions only become valid once the item is `decided` (see the
  // comment on DECISION_TO_TARGET_STATUS above), so this must happen
  // before navigating to /inventory and looking for transition buttons.
  const decisionBadge = await waitForTerminalDecisionBadge(page, expect)
  const badgeText = (await decisionBadge.textContent())?.trim() ?? ''
  const decision = classifyDecisionText(badgeText)
  const targetStatus = DECISION_TO_TARGET_STATUS[decision]

  // ItemResultPage.jsx always renders a "View basement inventory" link
  // (`<Link to="/inventory">`) once the item has loaded, outside any
  // terminal-only conditional -- navigate via it rather than a raw
  // `page.goto('/inventory')` so this exercises the app's own
  // client-side routing, same as a real user would use.
  await page.getByRole('link', { name: /view basement inventory/i }).click()
  await expect(page).toHaveURL(/\/inventory$/)

  // InventoryPage.jsx renders each item as an `<li>` containing a
  // `<Link to={`/items/${item.id}`}>` -- which react-router renders as a
  // real `<a href="/items/{id}">` -- so locating by that href
  // unambiguously finds THIS item's row regardless of its
  // `identified_name` (real, unpredictable LLM output) or how many other
  // items are in the list.
  const itemRow = page.locator('li').filter({ has: page.locator(`a[href="/items/${itemId}"]`) })
  await expect(itemRow).toBeVisible()

  // The manual-transition button for `targetStatus`, scoped to this
  // item's row specifically (InventoryPage.jsx renders one such button
  // per entry in `item.valid_next_statuses`, and a `decided` item's
  // `valid_next_statuses` is `['disposed', 'given_away', 'listed']` --
  // see backend/app/main.py's MANUAL_STATUS_TRANSITIONS -- so all three
  // targets' buttons are expected to be present before this click).
  const transitionButton = itemRow.getByRole('button', {
    name: STATUS_ACTION_LABEL_RE[targetStatus],
  })
  await expect(transitionButton).toBeVisible()
  await transitionButton.click()

  // handleAdvance (InventoryPage.jsx) PATCHes /items/{id}/status and, on
  // success, replaces this item in `items` state with the backend's
  // freshly-serialized response -- which re-renders this row's
  // "Status: ..." text with the new status AND its transition buttons
  // with the new `valid_next_statuses` (per MANUAL_STATUS_TRANSITIONS,
  // moving OFF the status just reached always drops that exact button,
  // e.g. `listed -> given_away, disposed`, never back to `listed`
  // itself) -- assert both effects, not just the status text, since the
  // button's disappearance is the more precise proof that the DOM
  // actually re-rendered from a genuinely updated item rather than, say,
  // a stale click handler leaving old text in place.
  await expect(itemRow.getByText(`Status: ${STATUS_DISPLAY_LABEL[targetStatus]}`)).toBeVisible()
  await expect(
    itemRow.getByRole('button', { name: STATUS_ACTION_LABEL_RE[targetStatus] })
  ).toHaveCount(0)
})

test('signing out reverts to the sign-in gate and survives a page reload', async ({ page }) => {
  await signInAs(page)

  // UploadPage.jsx's "View basement inventory" link -- land on
  // /inventory specifically (rather than staying on `/`) since it has
  // its own unambiguous heading ("Basement Inventory") to assert on
  // before AND after sign-out, unlike `/` (UploadPage.jsx) and the
  // sign-in gate (SignInPage.jsx), which both render an identical
  // "Basement Declutter" <h1> and so can't be told apart by that text
  // alone (see smoke.spec.js's same observation).
  await page.getByRole('link', { name: /view basement inventory/i }).click()
  await expect(page).toHaveURL(/\/inventory$/)

  const inventoryHeading = page.getByRole('heading', { name: /^Basement Inventory$/ })
  const signedInText = page.getByText(/^Signed in as /)
  const signOutButton = page.getByRole('button', { name: /^Sign out$/ })
  // SignInPage.jsx's own distinguishing copy -- not rendered by any
  // authenticated page, so its ABSENCE here is exactly what proves the
  // authenticated app (not the sign-in gate) is what's currently shown.
  const signInGateText = page.getByText(/sign in with your google account/i)

  await expect(inventoryHeading).toBeVisible()
  await expect(signedInText).toBeVisible()
  await expect(signOutButton).toBeVisible()
  await expect(signInGateText).toHaveCount(0)

  await signOutButton.click()

  // AuthContext.jsx's `signOut()` clears the stored session token from
  // localStorage and flips `isAuthenticated`/`email` back to
  // false/null, which App.jsx's AuthGate reacts to by rendering
  // SignInPage instead of the routed app -- assert the sign-in gate's
  // own copy is now visible, AND (explicitly, not just "some other
  // thing is visible") that the previously-visible authenticated
  // content is now entirely ABSENT from the DOM, not merely hidden.
  await expect(signInGateText).toBeVisible()
  await expect(inventoryHeading).toHaveCount(0)
  await expect(signedInText).toHaveCount(0)
  await expect(signOutButton).toHaveCount(0)

  // THE core proof that the session token was actually cleared from
  // localStorage (not just hidden in React state): read it straight back
  // out of the real browser storage via `page.evaluate`, immediately,
  // with no reload/navigation involved yet -- reuses helpers/auth.js's
  // own `SESSION_TOKEN_STORAGE_KEY` export (itself parsed straight out
  // of frontend/src/api.js's real source, see that helper) rather than
  // hardcoding a second, possibly-drifting copy of the key name here.
  // (Verified locally that this exact check -- on its own, before any
  // reload -- correctly FAILS against a deliberately-buggy fixture whose
  // "sign out" only flips in-memory UI state without ever calling
  // `localStorage.removeItem`, confirming it genuinely discriminates.)
  const storedToken = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    SESSION_TOKEN_STORAGE_KEY
  )
  expect(storedToken).toBeNull()

  // IMPORTANT harness wrinkle, found via this bead's own local
  // verification (not obvious from reading helpers/auth.js alone):
  // signInAs() above registered a `page.context().addInitScript(...)`
  // that unconditionally re-writes the ORIGINAL minted token into
  // localStorage on the START of every subsequent navigation in this
  // context (that's how it gets the token in place before the app's own
  // first-load scripts run) -- including a plain `page.reload()`. Since
  // `POST /auth/logout` is a stateless no-op server-side (see
  // AuthContext.jsx's own comment on `signOut()`), that original token
  // is still cryptographically valid, so a bare reload here would
  // silently get re-authenticated by signInAs's own init script BEFORE
  // AuthContext.jsx's mount-time check ever runs, regardless of whether
  // the real `signOut()` above worked correctly -- a FALSE reload-test
  // failure against a genuinely-working app, confirmed locally by
  // reproducing it (the exact assertions below, run without the extra
  // addInitScript that follows this comment, fail even against a fixture
  // whose sign-out demonstrably clears localStorage).
  //
  // Playwright runs context-level init scripts in registration order on
  // each navigation, and offers no way to remove/disable one already
  // added (only a `Disposable.dispose()` handle captured at the time of
  // registration, which signInAs -- a separate, already-implemented
  // helper this bead doesn't modify -- doesn't expose). Registering a
  // SECOND init script here, added after signInAs's, runs after it on
  // every future navigation and removes the token again right after
  // signInAs's script re-adds it -- neutralizing the re-injection so the
  // reload below can complete without signInAs's own harness artifact
  // getting in the way.
  //
  // Consequence worth being explicit about: because this neutralizing
  // script unconditionally clears the token before every subsequent
  // navigation, the reload assertion below can no longer, by itself,
  // independently prove "the real signOut() cleared localStorage" --
  // that claim is already fully and directly established by the
  // `storedToken` check above, which involves no addInitScript at all
  // and (per the verified-locally note above) genuinely fails when
  // signOut() doesn't clear the token. What the reload assertion below
  // DOES still meaningfully check, given a real navigation with a
  // genuinely-empty localStorage: that AuthContext.jsx's mount-time
  // re-derivation (`localStorage.getItem(...)` -> `isAuthenticated`)
  // actually runs and actually renders the sign-in gate, rather than
  // some OTHER latent mechanism (a stale cache, a service worker, some
  // other storage the app might start relying on) resurrecting the
  // authenticated view across a reload independent of localStorage.
  await page.context().addInitScript(
    (key) => {
      window.localStorage.removeItem(key)
    },
    SESSION_TOKEN_STORAGE_KEY
  )

  await page.reload()
  await expect(signInGateText).toBeVisible()
  await expect(inventoryHeading).toHaveCount(0)
  await expect(signedInText).toHaveCount(0)
})

test('navigating directly to an authenticated route with no session token shows the sign-in gate', async ({
  page,
}) => {
  // Deliberately does NOT call signInAs() -- Playwright gives every test
  // its own fresh, isolated BrowserContext (hence fresh, empty
  // localStorage) by default via the `page` fixture, so there is no
  // session token present at all here, same as a brand-new visitor.
  const signInGateText = page.getByText(/sign in with your google account/i)
  const inventoryHeading = page.getByRole('heading', { name: /^Basement Inventory$/ })
  const itemHeading = page.getByRole('heading', { name: /^Item #/ })

  // frontend/Dockerfile.railway serves the built SPA via `serve -s dist`
  // (single/SPA mode: any path, including deep ones, is served
  // `index.html`), and App.jsx's `AuthGate` decides what to render
  // BEFORE `<Routes>` even runs -- so a direct, full-page navigation to
  // `/inventory` should still resolve to the compiled app, which itself
  // shows the sign-in gate rather than InventoryPage, since there's no
  // token to authenticate with.
  await page.goto('/inventory')
  await expect(signInGateText).toBeVisible()
  await expect(inventoryHeading).toHaveCount(0)

  // Same for a direct item-results deep link -- the id doesn't need to
  // correspond to a real item, since AuthGate blocks before
  // ItemResultPage.jsx's own `GET /items/{id}` fetch would ever run.
  await page.goto('/items/999999999')
  await expect(signInGateText).toBeVisible()
  await expect(itemHeading).toHaveCount(0)
})

// What has and hasn't been verified for this test (sandbox-634.5)
// -----------------------------------------------------------------
// Same constraint as sandbox-634.2/.3/.4: this sandbox's network egress
// cannot reach *.up.railway.app at all, so this spec has NEVER been run
// against the real deployed app, and this task does not claim it
// "passes" -- that only happens in sandbox-634.8's real Railway run,
// which is the first time the real upload -> real inventory list ->
// real PATCH /items/{id}/status -> real sign-out/localStorage-clearing ->
// real direct-navigation-while-unauthenticated flows in this file are
// actually exercised end to end.
//
// What WAS verified locally: this file's own locator/assertion logic
// (copied verbatim into a temporary, NOT-committed spec file) was run for
// real through the actual Playwright Test runner (`npx playwright test`,
// not just an ad-hoc script -- an earlier attempt at hand-rolling
// assertions with `@playwright/test`'s `expect` outside the real test
// runner produced spurious `toBeVisible()` timeouts against DOM that
// `locator.isVisible()` and `locator.count()` simultaneously reported as
// present/visible, i.e. that shortcut is unreliable and was abandoned in
// favor of the real runner) via this sandbox's pre-installed Chromium
// (`PLAYWRIGHT_CHROMIUM_PATH`, launched through a temporary Playwright
// config pointed at a local `python3 -m http.server`), against local
// static HTML fixtures (built and then deleted again -- not part of this
// commit) shaped like plausible InventoryPage.jsx / SignInPage.jsx / an
// authenticated shell DOM:
//   - The item-row-by-href-scoping + transition-button-click +
//     post-click "Status: ..." text + button-disappearance assertions
//     (first test above) were run against a fixture whose DOM mimicked
//     InventoryPage.jsx's real markup for a `decided` item with all
//     three transition buttons, with an inline script that -- on
//     button click -- mutated the DOM the same way a real successful
//     `PATCH /items/{id}/status` response would (new "Status: ..." text,
//     the clicked button replaced by the new valid-next-statuses set):
//     passed, and left an untouched second item row's status text
//     unchanged (proving the href-based row scoping genuinely isolates
//     one item, not just "the first list item"). A deliberately-broken
//     negative-case fixture, where the click handler updates the status
//     text but leaves the old button in place (simulating a UI that
//     didn't actually re-render from a fresh server response), correctly
//     failed the button-disappearance assertion -- proving that
//     assertion discriminates rather than passing vacuously.
//   - The sign-out scenario's assertions (second test above) were run
//     against a small local static site (served over plain HTTP, not
//     `file://`, so localStorage genuinely persists across a real
//     reload within one origin the way it would for the real deployed
//     app): an "authenticated shell" page (inventory heading, "Signed in
//     as", a working Sign out button) that, structurally, only ever puts
//     ONE view's markup in the DOM at a time (matching
//     InventoryPage.jsx/SignInPage.jsx never being mounted
//     simultaneously -- an earlier fixture draft that merely toggled a
//     `hidden` attribute on both was caught and fixed by this same local
//     verification, since `toHaveCount(0)` correctly does NOT treat
//     `hidden`-but-present as absent). The Sign out button both swapped
//     in the sign-in gate's markup AND removed a mock session-token
//     localStorage key (under the same key name
//     `SESSION_TOKEN_STORAGE_KEY` resolves to) via an inline script
//     mirroring AuthContext.jsx's real `signOut()`; the immediate
//     post-click `storedToken` check (no reload involved) passed against
//     this fixture, and correctly FAILED against a deliberately-buggy
//     variant whose "sign out" only flips in-memory UI state without
//     ever calling `localStorage.removeItem` -- confirming that specific
//     check is the one that genuinely discriminates "really cleared" vs.
//     "only looks cleared". The subsequent reload (with the neutralizing
//     second `addInitScript` in place, see below) then correctly showed
//     the sign-in gate again against the well-behaved fixture too.
//   - This same local verification surfaced a real, non-obvious harness
//     interaction that's now handled directly in the sign-out test above
//     (see its inline comments): helpers/auth.js's signInAs() registers
//     a context-level `addInitScript` that re-injects the SAME
//     originally-minted (still cryptographically valid, since `POST
//     /auth/logout` is a stateless no-op) token on every subsequent
//     navigation in that context, including a bare `page.reload()` --
//     which, left unhandled, silently re-authenticates on reload
//     regardless of whether the real `signOut()` genuinely cleared
//     localStorage, i.e. produces a FALSE reload-assertion failure
//     against a correctly-working real app. Reproduced locally: the
//     exact reload assertions, run without the neutralizing second
//     `addInitScript`, failed even against the well-behaved fixture.
//     Adding that second `addInitScript` (registered after signInAs's,
//     so it runs after it on every future navigation and removes the
//     token again) fixed the false failure -- but, checked locally, ALSO
//     means the reload assertion can no longer by itself distinguish the
//     well-behaved fixture from the buggy one (the second `addInitScript`
//     unconditionally clears the token before every subsequent
//     navigation regardless of what the fixture's own sign-out did, so
//     both fixtures show the sign-in gate again after reload once it's
//     in place). That's why the spec's comments frame the immediate
//     `storedToken` check as the actual proof of "really cleared", and
//     the reload check as a secondary confirmation that AuthContext.jsx's
//     mount-time re-derivation itself behaves correctly given a genuinely
//     empty localStorage -- not a second independent proof of the same
//     claim the direct check already establishes.
//   - The unauthenticated-direct-navigation scenario's assertions
//     (third test above) reduce to the same sign-in-gate-text-present /
//     authenticated-heading-absent checks already exercised by the
//     sign-out fixture above, so no separate fixture was needed for it.
//
// This does NOT verify: the real upload -> pipeline -> terminal-decision
// flow itself (covered by sandbox-634.3/.4's own equivalent caveats);
// that the real deployed frontend's static server genuinely serves
// `index.html` (rather than a bare 404) for deep paths like `/inventory`
// and `/items/999999999` on a direct/full-page navigation (this relies
// on `frontend/Dockerfile.railway`'s `serve -s dist` -s/"single" flag
// doing what it's documented to do, which could not be exercised without
// the real deployed frontend); or that `PATCH /items/{id}/status`
// genuinely round-trips through the real backend and database. All of
// that is first exercised for real in sandbox-634.8.
