# E2E test suite (sandbox-634 epic)

Playwright suite that drives a real browser against the
**already-deployed real frontend + backend** (Railway) -- real Google-auth-
bypass sign-in (see `helpers/auth.js`), real Claude vision/listing-text
generation, and real Kleinanzeigen search all happen for real against the
real backend, exactly as for a real user. This suite never starts a local
backend/frontend process and never adds backend auth-bypass code; instead
it signs in by minting an ordinary, validly-signed session token for a
pre-designated test identity (see "Auth" below).

## Setup

```sh
cd e2e
npm install
npx playwright install chromium   # only needed if not using PLAYWRIGHT_CHROMIUM_PATH
```

## Running

```sh
npm run test:e2e
```

## Required environment variables

| Var | Meaning |
| --- | --- |
| `E2E_FRONTEND_URL` | Base URL of the deployed frontend to test against, e.g. `https://<app>.up.railway.app`. No default -- must be explicitly supplied. |
| `E2E_SESSION_SECRET` | The real deployed backend's actual `SESSION_SECRET` value. Used by `helpers/mint_token.py` to mint a validly-signed session token for the test identity below. Must exactly match the real backend's configured `SESSION_SECRET`, or the token will fail validation against the real `GET /auth/me`. |
| `E2E_TEST_EMAIL` | The designated E2E test identity's email. Must already be present in the real deployed backend's `ALLOWED_EMAILS` whitelist. |

Obtaining `E2E_SESSION_SECRET` and ensuring `E2E_TEST_EMAIL` is
whitelisted is **out of scope for this suite** -- it consumes both,
supplied externally (e.g. by whoever runs the suite, pulling the real
value from the Railway service's configured environment). It never
invents, guesses, or hardcodes either.

## Optional environment variables (timeouts / local browser path)

| Var | Meaning | Default |
| --- | --- | --- |
| `PLAYWRIGHT_CHROMIUM_PATH` | Path to a Chromium executable to launch instead of Playwright's own bundled/auto-resolved one. | unset -- falls back to Playwright's normal default resolution |
| `E2E_TEST_TIMEOUT_MS` | Per-test timeout, in ms. | `180000` (3 min) |
| `E2E_EXPECT_TIMEOUT_MS` | Default polling timeout for `expect(locator).toBeVisible()` and similar, in ms. | `150000` (150s) |
| `E2E_NAVIGATION_TIMEOUT_MS` | Timeout for `page.goto()`/navigation waits, in ms. | `90000` (90s) |
| `E2E_ACTION_TIMEOUT_MS` | Timeout for individual Playwright actions (click, fill, ...), in ms. | `30000` (30s) |

The timeout defaults above are deliberately generous: real Claude vision +
real Kleinanzeigen search (which has a documented ~1.5s minimum delay plus
retries -- see `backend/app/comparable_search.py`) + real Claude
listing-text generation can plausibly take tens of seconds per item.

## Auth: how sign-in works without real Google OAuth

Real Google Sign-In can't be driven headlessly, and this suite
deliberately does not add any backend auth-bypass code. Instead:

1. `helpers/mint_token.py` is a standalone Python script that imports
   `backend/app/auth.py`'s `issue_session_token` directly (with
   `backend/` added to `sys.path` at runtime -- no install/cwd
   requirements beyond having `backend/`'s dependencies available; see
   the script's own docstring for exactly which two packages
   (`itsdangerous`, `google-auth`) it needs importable and why). It reads
   `E2E_SESSION_SECRET`/`E2E_TEST_EMAIL` from the environment and prints
   the resulting signed token to stdout. This is a completely ordinary
   session token -- the same function, with the same secret, that the
   real backend uses when a user finishes the real `POST /auth/google`
   exchange; the backend cannot distinguish one minted here from one it
   issued itself.
2. `helpers/auth.js`'s `signInAs(page)` shells out to that script to get a
   token, reads `SESSION_TOKEN_STORAGE_KEY`'s exact value directly out of
   `frontend/src/api.js`'s source (never a hardcoded duplicate that could
   drift), injects the token into the browser context's `localStorage`
   under that key via `context.addInitScript` (so it's present before any
   of the app's own scripts run), then navigates to `E2E_FRONTEND_URL`.
3. The frontend's own `AuthContext.jsx` then validates that token against
   the real `GET /auth/me` on mount, exactly as it would for a token
   obtained through the real sign-in flow -- so a broken/mismatched
   secret or a non-whitelisted email surfaces as a normal sign-in
   failure (the sign-in gate stays visible), not a special code path.

## What has and hasn't been verified for this harness (sandbox-634.2)

This sandbox's network egress cannot reach `*.up.railway.app` at all, so
the suite has never been run against the *real deployed app* from here --
that only happens in sandbox-634.8. Short of that, everything reachable
from inside this sandbox has been exercised for real, not just inspected:
`helpers/mint_token.py` mints a token (pure Python, `itsdangerous` +
`google-auth[requests]`, no network needed) that round-trips correctly
through `verify_session_token` given a matching secret, and fails clearly
when the required env vars are missing. `smoke.spec.js` itself has been
run, unmodified, with Playwright's real browser (via the sandbox's
pre-installed Chromium and `PLAYWRIGHT_CHROMIUM_PATH`) against local
static fixtures shaped like the real UploadPage and SignInPage DOM: it
passes against the UploadPage-shaped fixture and correctly fails against
the SignInPage-shaped one, confirming the assertions aren't vacuous. What
remains unverifiable until sandbox-634.8's real run: that `E2E_SESSION_SECRET`
matches the deployed backend's actual `SESSION_SECRET`, that `E2E_TEST_EMAIL`
is really on the deployed backend's `ALLOWED_EMAILS`, and that the real
SPA's mount-time auth flow behaves the same as the fixtures within the
configured timeouts.
