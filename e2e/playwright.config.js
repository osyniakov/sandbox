// Playwright config for the E2E suite (sandbox-634 epic). This drives a
// real browser against the ALREADY-DEPLOYED real frontend + backend
// (Railway) -- real Google-auth-bypass sign-in (see helpers/auth.js), real
// Claude vision/listing-text generation, and real Kleinanzeigen search all
// happen for real against the real backend, exactly as for a real user. No
// local backend/frontend processes are started by this config, or by
// `npm run test:e2e` -- see e2e/README.md.
//
// Required env vars
// ------------------
//   E2E_FRONTEND_URL    Base URL of the deployed frontend to test against,
//                        e.g. https://<app>.up.railway.app. No default --
//                        must be explicitly supplied; there is no "local"
//                        instance to fall back to.
//   E2E_SESSION_SECRET   The real deployed backend's actual SESSION_SECRET.
//                        Consumed by helpers/mint_token.py (via
//                        helpers/auth.js's signInAs) to mint a validly
//                        signed session token -- must exactly match the
//                        real backend's configured SESSION_SECRET, or the
//                        minted token will fail validation against the
//                        real GET /auth/me. Not read directly by this
//                        config file, only by the auth helper at the point
//                        a test actually calls signInAs().
//   E2E_TEST_EMAIL       The designated E2E test identity's email. Must
//                        already be present in the real deployed backend's
//                        ALLOWED_EMAILS whitelist. Also not read directly
//                        by this file.
//
// Optional env vars
// ------------------
//   PLAYWRIGHT_CHROMIUM_PATH   Path to a Chromium executable to launch
//                        instead of Playwright's own bundled/auto-resolved
//                        one (useful for e.g. this repo's sandbox, which
//                        has a preinstalled browser at a fixed path).
//                        Falls back to Playwright's normal default
//                        resolution if unset -- no sandbox-specific path
//                        is hardcoded here.
//   E2E_TEST_TIMEOUT_MS         Per-test timeout in ms. Default 120000 (2
//                        minutes).
//   E2E_EXPECT_TIMEOUT_MS       Default polling timeout in ms for
//                        `expect(locator).toBeVisible()` and similar.
//                        Default 90000 (90s).
//   E2E_NAVIGATION_TIMEOUT_MS   Timeout in ms for page.goto()/navigation
//                        waits. Default 90000 (90s).
//   E2E_ACTION_TIMEOUT_MS       Timeout in ms for individual Playwright
//                        actions (click, fill, setInputFiles, ...).
//                        Default 30000 (30s) -- these don't themselves wait
//                        on the real Claude/Kleinanzeigen pipeline (that's
//                        what the expect-timeout above is for), so a
//                        shorter default is reasonable here, but it's still
//                        overridable.
//
// All four timeout defaults above are deliberately generous, not tuned for
// a fast local response: real Claude vision + real Kleinanzeigen search
// (which has a documented ~1.5s minimum delay plus retries -- see
// backend/app/comparable_search.py) + real Claude listing-text generation
// can plausibly take tens of seconds per item.

import { defineConfig, devices } from '@playwright/test'

const frontendUrl = process.env.E2E_FRONTEND_URL
if (!frontendUrl) {
  throw new Error(
    'E2E_FRONTEND_URL is not set. This suite runs against the real ' +
      'deployed frontend and has no local fallback -- set it to the ' +
      'deployed frontend URL, e.g. https://<app>.up.railway.app. See ' +
      'e2e/README.md.'
  )
}

// Parses an env var as a positive integer, falling back to `defaultValue`
// when unset/empty. Throws a clear error (rather than silently producing
// NaN, which Playwright would then reject with a much less obvious
// message) if the value is set but not a valid integer.
function envIntMs(name, defaultValue) {
  const raw = process.env[name]
  if (!raw) {
    return defaultValue
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `${name}=${JSON.stringify(raw)} is not a valid positive integer ` +
        '(milliseconds).'
    )
  }
  return parsed
}

const testTimeoutMs = envIntMs('E2E_TEST_TIMEOUT_MS', 120_000)
const expectTimeoutMs = envIntMs('E2E_EXPECT_TIMEOUT_MS', 90_000)
const navigationTimeoutMs = envIntMs('E2E_NAVIGATION_TIMEOUT_MS', 90_000)
const actionTimeoutMs = envIntMs('E2E_ACTION_TIMEOUT_MS', 30_000)

export default defineConfig({
  testDir: '.',
  timeout: testTimeoutMs,
  expect: {
    timeout: expectTimeoutMs,
  },
  // These E2E tests exercise real, shared external state (a real backend,
  // real Kleinanzeigen search) via one shared test identity -- run serially
  // rather than in parallel workers to avoid tests stepping on each other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: frontendUrl,
    navigationTimeout: navigationTimeoutMs,
    actionTimeout: actionTimeoutMs,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
})
