// Auth helper for the E2E suite (sandbox-634 epic): signs in as the
// designated E2E test identity against the REAL deployed backend, WITHOUT
// driving the real (headless-unfriendly) Google OAuth flow and WITHOUT any
// new backend auth-bypass code. It does this by minting a completely
// ordinary, validly-signed session token (via helpers/mint_token.py, which
// calls the real backend/app/auth.py::issue_session_token) and injecting it
// into localStorage before the app loads -- indistinguishable to the
// backend from a token issued through the real POST /auth/google exchange.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Reads SESSION_TOKEN_STORAGE_KEY's exact string value straight out of
// frontend/src/api.js's source, rather than hardcoding a second copy here
// that could silently drift out of sync with the real value.
//
// We deliberately do NOT `import` frontend/src/api.js directly here: that
// module references Vite-only `import.meta.env.*` at module scope (for
// API_BASE_URL/GOOGLE_CLIENT_ID), which throws under plain Node (outside a
// Vite build, `import.meta.env` is undefined, so `import.meta.env.FOO`
// throws a TypeError) before evaluation ever reaches the
// SESSION_TOKEN_STORAGE_KEY line. Reading the file as text and extracting
// the literal via regex sidesteps that entirely while still reading the
// real, current value rather than duplicating it.
function readSessionTokenStorageKey() {
  const apiJsPath = path.join(REPO_ROOT, 'frontend', 'src', 'api.js')
  const source = fs.readFileSync(apiJsPath, 'utf-8')
  const match = source.match(
    /export const SESSION_TOKEN_STORAGE_KEY\s*=\s*'([^']+)'/
  )
  if (!match) {
    throw new Error(
      `Could not find "export const SESSION_TOKEN_STORAGE_KEY = '...'" in ` +
        `${apiJsPath} -- has its declaration format changed? Update the ` +
        'regex in e2e/helpers/auth.js to match.'
    )
  }
  return match[1]
}

export const SESSION_TOKEN_STORAGE_KEY = readSessionTokenStorageKey()

// Mints a session token for the designated E2E test identity by shelling
// out to helpers/mint_token.py (a standalone Python script -- see that
// file's docstring for exactly why it doesn't need the rest of the backend
// installed, and what it DOES need: itsdangerous + google-auth importable
// by whichever `python3` runs it). Reads E2E_SESSION_SECRET/E2E_TEST_EMAIL
// from the current process's environment and passes them through
// unchanged; never invents or hardcodes either.
function mintSessionToken() {
  const required = ['E2E_SESSION_SECRET', 'E2E_TEST_EMAIL']
  const missing = required.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `signInAs() requires ${missing.join(' and ')} to be set in the ` +
        "environment (the real deployed backend's actual SESSION_SECRET, " +
        'and an email already present in its ALLOWED_EMAILS whitelist -- ' +
        "see e2e/README.md). The orchestrator supplies these; this helper " +
        'only consumes them.'
    )
  }

  const scriptPath = path.join(__dirname, 'mint_token.py')
  let stdout
  try {
    stdout = execFileSync('python3', [scriptPath], {
      env: process.env,
      encoding: 'utf-8',
    })
  } catch (err) {
    // execFileSync throws on non-zero exit; mint_token.py writes a
    // descriptive message to stderr in that case (missing env vars,
    // issue_session_token failing, etc) -- surface it rather than just the
    // generic "Command failed" message.
    const stderr = err.stderr ? String(err.stderr).trim() : ''
    throw new Error(
      `helpers/mint_token.py failed to mint a session token` +
        (stderr ? `: ${stderr}` : ` (${err.message})`)
    )
  }

  const token = stdout.trim()
  if (!token) {
    throw new Error(
      'helpers/mint_token.py produced empty output instead of a token'
    )
  }
  return token
}

// Signs in as the designated E2E test identity: mints a session token (see
// mintSessionToken above), injects it into `page`'s browser context's
// localStorage under SESSION_TOKEN_STORAGE_KEY via `context.addInitScript`
// -- which runs before ANY of the app's own scripts on every subsequent
// document load in this context, so the token is already present by the
// time frontend/src/AuthContext.jsx's mount-time check
// (`localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)`) runs -- and then
// navigates to the app's root (resolved against playwright.config.js's
// `baseURL`, i.e. E2E_FRONTEND_URL).
//
// Must be called before any other navigation the test cares about seeing
// the signed-in state (addInitScript only affects documents loaded AFTER
// it's registered, not the current one, if the page had already navigated
// elsewhere first).
//
// No email parameter: this harness only ever signs in as the one
// designated E2E test identity (E2E_TEST_EMAIL), not an arbitrary email --
// see the bead description for why (the identity must be present on the
// real backend's ALLOWED_EMAILS whitelist ahead of time).
export async function signInAs(page) {
  const token = mintSessionToken()

  await page.context().addInitScript(
    ({ storageKey, tokenValue }) => {
      window.localStorage.setItem(storageKey, tokenValue)
    },
    { storageKey: SESSION_TOKEN_STORAGE_KEY, tokenValue: token }
  )

  await page.goto('/')
}
