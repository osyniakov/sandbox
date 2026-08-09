#!/usr/bin/env python3
"""Mint a signed session token for the designated E2E test identity.

Standalone script -- run as a subprocess by ``e2e/helpers/auth.js`` (see
that file's ``mintSessionToken``) rather than imported as a Python module.
This lets the ``e2e/`` Playwright suite sign in against the REAL deployed
backend without a real (headless-unfriendly) Google OAuth flow, and
WITHOUT adding any new backend auth-bypass code: this script mints a
completely ordinary, validly-signed session token by calling the exact
same ``backend/app/auth.py::issue_session_token`` function the backend
itself uses when a user finishes the real Google sign-in flow via
``POST /auth/google``. The backend cannot distinguish a token minted here
from one it issued itself -- both are itsdangerous-signed with the same
``SESSION_SECRET`` and verified the same way by
``app.auth.verify_session_token``.

Why this doesn't need the rest of the backend installed/running
------------------------------------------------------------------
``app/auth.py`` only imports (at module scope): ``os``, ``typing``,
``google.auth.transport.requests``, ``google.oauth2.id_token``, and
``itsdangerous``. It does NOT import anything else from the ``app``
package (not ``app.models``, not ``app.db``, not ``app.main``, ...), and
``backend/app/__init__.py`` is empty, so importing ``app.auth`` alone --
with ``backend/`` added to ``sys.path`` -- does not require the rest of
the backend package to be importable, installed, or running. It DOES,
however, require two third-party packages to be installed for whatever
Python interpreter runs this script:

  - ``itsdangerous`` (used by ``issue_session_token`` itself), and
  - ``google-auth`` WITH its ``requests`` transport extra (i.e.
    ``google-auth[requests]``, matching ``backend/requirements.txt``'s own
    pin) -- ``google.auth.transport.requests`` is imported unconditionally
    at the top of ``app/auth.py`` even though ``issue_session_token``
    itself never calls into it (only ``verify_google_id_token``, which
    this script never calls, does), and that submodule itself raises
    ``ImportError: The requests library is not installed`` at import time
    if the bare ``requests`` package isn't present alongside ``google-auth``
    -- confirmed by direct reproduction: ``google-auth`` without
    ``requests`` still fails the same way ``google-auth`` alone would.

All three are already pinned in ``backend/requirements.txt``. If the
environment that runs this script (e.g. this repo's E2E Docker image,
sandbox-634.7) doesn't already have the full backend's dependencies
installed, it needs at least these three packages available to whichever
``python3`` runs this script.

Usage
-----
Reads ``E2E_SESSION_SECRET`` and ``E2E_TEST_EMAIL`` from the environment
(NOT ``SESSION_SECRET``/a hardcoded email -- this script must consume an
externally-supplied secret and test identity, never invent or hardcode
either) and prints the resulting signed token to stdout, with no trailing
content besides the token and its own trailing newline (so callers like
``e2e/helpers/auth.js`` can just take stdout, stripped of whitespace, as
the token).

Exits non-zero with a message on stderr if either required env var is
missing/empty, or if ``issue_session_token`` itself fails.
"""

from __future__ import annotations

import os
import sys

# Add backend/ (this script's grandparent directory: e2e/helpers/ ->
# e2e/ -> repo root -> backend/) to sys.path so `import app.auth` resolves
# to backend/app/auth.py, without needing the caller to set PYTHONPATH or
# run this script from a particular cwd. Inserted at position 0 so it
# takes priority over any other `app` package that might otherwise shadow
# it on the path.
_BACKEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"
)
sys.path.insert(0, _BACKEND_DIR)

from app.auth import issue_session_token  # noqa: E402 -- see sys.path setup above


def main() -> int:
    secret = os.environ.get("E2E_SESSION_SECRET")
    email = os.environ.get("E2E_TEST_EMAIL")

    if not secret:
        print(
            "E2E_SESSION_SECRET is not set -- this must be the real deployed "
            "backend's actual SESSION_SECRET, supplied externally.",
            file=sys.stderr,
        )
        return 1
    if not email:
        print(
            "E2E_TEST_EMAIL is not set -- this must be an email already "
            "present in the real deployed backend's ALLOWED_EMAILS "
            "whitelist, supplied externally.",
            file=sys.stderr,
        )
        return 1

    # `issue_session_token` reads its signing key from the `SESSION_SECRET`
    # env var (not `E2E_SESSION_SECRET`) -- set it here from the
    # externally-supplied `E2E_SESSION_SECRET` so this script consumes the
    # one env var the orchestrator gives it without requiring a second,
    # duplicate `SESSION_SECRET` to also be set for this subprocess.
    os.environ["SESSION_SECRET"] = secret

    try:
        token = issue_session_token(email)
    except Exception as exc:  # noqa: BLE001 -- surface any failure plainly to stderr
        print(f"issue_session_token failed: {exc}", file=sys.stderr)
        return 1

    print(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
