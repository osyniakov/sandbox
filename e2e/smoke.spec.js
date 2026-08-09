// Harness-verification smoke test (sandbox-634.2). This is deliberately
// minimal: it exists to prove the whole harness -- Playwright pointed at
// the real deployed frontend (playwright.config.js), and the
// token-injection sign-in bypass (helpers/auth.js) -- actually works
// end-to-end against the real deployed app, before later beads
// (sandbox-634.3/.4/.5) build real upload/inventory/hint scenarios on top
// of it. Deeper scenarios belong in those beads, not here.

import { expect, test } from '@playwright/test'
import { signInAs } from './helpers/auth.js'

test('signed-in E2E test identity sees the upload page, not the sign-in gate', async ({
  page,
}) => {
  await signInAs(page)

  // frontend/src/AuthContext.jsx validates the injected token against the
  // real `GET /auth/me` on mount before deciding what to render, and only
  // then flips `isLoading` to false -- so these assertions only pass if
  // the minted token is genuinely valid against the real backend (i.e.
  // E2E_SESSION_SECRET really matches the deployed backend's
  // SESSION_SECRET, and E2E_TEST_EMAIL is really on its ALLOWED_EMAILS
  // whitelist). Poll generously (playwright.config.js's
  // E2E_EXPECT_TIMEOUT_MS-controlled default) since that round trip, plus
  // the app's own "Loading..." state, takes a moment.

  // The upload page (frontend/src/UploadPage.jsx) renders a "Take or
  // choose a photo" file input and a "Sign out" control that the sign-in
  // gate (frontend/src/SignInPage.jsx) never renders -- assert on those
  // rather than the "Basement Declutter" <h1>, which BOTH pages render
  // and so can't distinguish between them.
  await expect(page.getByLabel(/take or choose a photo/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()

  // Belt-and-suspenders: explicitly assert the sign-in gate's own
  // distinguishing copy is NOT present, i.e. the sign-in gate itself is
  // not what's shown.
  await expect(
    page.getByText(/sign in with your google account/i)
  ).toHaveCount(0)
})
