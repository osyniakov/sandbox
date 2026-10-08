"""Google Sign-In verification and session tokens.

This module is the authentication core: it verifies Google-issued ID
tokens (proving the caller actually authenticated with Google and owns
the associated verified email) and issues/verifies our own signed
session tokens so the frontend doesn't need to re-send the Google ID
token on every request. Any verified Google account may sign in; there
is no email whitelist. The lowercased email is the user's identity.

Fail-closed by design
----------------------
- ``GOOGLE_CLIENT_ID`` unset/empty -> we have no audience to verify
  the token against -> :func:`verify_google_id_token` always raises
  :class:`AuthError`.
- ``SESSION_SECRET`` unset/empty -> signing tokens with no secret
  would be insecure, so :func:`issue_session_token` raises
  ``RuntimeError`` at call time (a hard misconfiguration, not a
  soft-fail case).

Env vars, all read lazily (at call time, not at import time) so a
redeployed env var change takes effect on a normal restart -- matching
the ``os.environ.get(...)`` read-at-call-time convention used elsewhere
in this codebase (e.g. ``app.db._default_db_path``):

- ``GOOGLE_CLIENT_ID``: OAuth 2.0 client ID that Google ID tokens must
  have been issued for (checked via the ``aud`` claim).
- ``ALLOWED_EMAILS``: optional; NOT a sign-in allowlist. Only its first
  entry names the owner of legacy (pre-multi-tenancy) data, claimed by
  ``app.db_migrate`` / the owner_email migration.
- ``SESSION_SECRET``: secret key used to sign/verify our own session
  tokens.

Google ID tokens are additionally checked for an explicit issuer
(``iss`` must be ``accounts.google.com`` or
``https://accounts.google.com``) by this module itself, rather than
relying solely on google-auth's internal check.
"""

from __future__ import annotations

import os
from typing import Any, Callable

import google.auth.transport.requests
import google.oauth2.id_token
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

# Session tokens are valid for 7 days from issuance (in seconds).
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

# Salt passed to itsdangerous -- scopes signatures to this specific use
# case so a token issued for a different purpose (were this secret ever
# reused elsewhere) can't be replayed here.
_SESSION_SALT = "app.auth.session"

# The only issuers Google ID tokens may carry. Checked explicitly (exact
# match) in addition to whatever ``verify_fn`` does internally.
_GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})


class AuthError(Exception):
    """Raised when Google ID token verification fails.

    Covers a malformed/invalid/expired/signature-invalid token, an
    unverified or missing email, and missing ``GOOGLE_CLIENT_ID``
    configuration (see module docstring "Fail-closed by design").
    """


def _parse_allowed_emails(raw: str | None) -> list[str]:
    """Parse the ``ALLOWED_EMAILS`` env var into a lowercased email list.

    No longer a sign-in allowlist: used only to find the legacy-data
    owner (first entry). Kept for ``app.db_migrate`` and the
    ``b7a2c4d9e1f3`` migration.

    Mirrors ``app.main._parse_allowed_origins``'s comma-separated,
    strip-whitespace parsing convention. ``ALLOWED_EMAILS`` no longer
    gates sign-in; it is parsed only so its first entry can be used as
    the owner of pre-multi-tenancy items. Every entry is lowercased to
    match the lowercased owner emails stored on items, and the result
    is an empty list when ``raw`` is ``None``/empty/blank-only (no
    legacy owner configured).
    """
    if not raw:
        return []
    return [entry.strip().lower() for entry in raw.split(",") if entry.strip()]


def verify_google_id_token(
    id_token_str: str,
    verify_fn: Callable[..., dict[str, Any]] | None = None,
) -> str:
    """Verify a Google-issued ID token and return the verified email.

    Verifies the token's signature (against Google's public keys),
    expiry, and ``aud`` claim (must match ``GOOGLE_CLIENT_ID``) via
    ``verify_fn`` (defaults to the real
    ``google.oauth2.id_token.verify_oauth2_token``), then additionally
    requires:

    - the payload's ``iss`` claim to be exactly ``accounts.google.com``
      or ``https://accounts.google.com`` (explicit issuer check).
    - ``GOOGLE_CLIENT_ID`` to be configured (non-empty) -- otherwise
      there is no audience to verify against, so this always raises.
    - the verified payload's ``email_verified`` claim to be exactly
      ``True``.
    - a non-empty ``email`` claim.

    There is no email allowlist: any verified Google account passes.

    ``verify_fn`` is injectable so tests can supply a fake that returns
    a canned payload dict without making a real network call to Google;
    it is called as ``verify_fn(id_token_str, request, audience=client_id)``
    matching the real function's signature.

    Returns the verified email, stripped and lowercased. Raises :class:`AuthError`
    for any failure -- malformed/invalid/expired/bad-signature token
    (whatever ``verify_fn`` raises is caught broadly and re-raised as
    ``AuthError``, matching this codebase's
    ``app.identification.IdentificationError`` pattern of wrapping
    underlying provider failures), or unverified/missing email.
    """
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise AuthError("GOOGLE_CLIENT_ID is not configured; cannot verify ID tokens")

    if verify_fn is None:
        verify_fn = google.oauth2.id_token.verify_oauth2_token
        request = google.auth.transport.requests.Request()
    else:
        request = None

    try:
        payload = verify_fn(id_token_str, request, audience=client_id)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        raise AuthError(f"Google ID token verification failed: {exc}") from exc

    iss = payload.get("iss")
    if not isinstance(iss, str) or iss not in _GOOGLE_ISSUERS:
        raise AuthError("Google ID token has an unexpected issuer (iss claim)")

    if payload.get("email_verified") is not True:
        raise AuthError("Google ID token's email_verified claim is not True")

    email = payload.get("email")
    if not isinstance(email, str) or not email:
        raise AuthError("Google ID token payload has no email claim")
    email = email.strip().lower()
    if not email:
        raise AuthError("Google ID token payload has no email claim")

    return email


def issue_session_token(email: str) -> str:
    """Sign and return a session token encoding ``email``.

    Uses ``itsdangerous.URLSafeTimedSerializer`` (which embeds an
    issued-at timestamp itself, used by ``verify_session_token`` for
    expiry) keyed by ``SESSION_SECRET``, read from the environment at
    call time (see module docstring).

    Raises ``RuntimeError`` if ``SESSION_SECRET`` is unset/empty --
    signing tokens with no secret would be insecure, so this is a hard
    misconfiguration error rather than a soft-fail case.
    """
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise RuntimeError("SESSION_SECRET is not configured; cannot issue session tokens")

    serializer = URLSafeTimedSerializer(secret, salt=_SESSION_SALT)
    return serializer.dumps({"email": email})


def verify_session_token(token: str) -> str | None:
    """Verify a session token and return the email it encodes, or ``None``.

    Returns ``None`` on ANY failure -- expired (older than
    ``SESSION_MAX_AGE_SECONDS``), tampered, malformed, or signed with a
    different/unset ``SESSION_SECRET`` -- rather than raising. Callers
    treat ``None`` as "not authenticated". This matches the
    "predictable value vs. exception" pattern used elsewhere in this
    codebase (e.g. ``app.identification._is_low_confidence`` returning
    a plain ``bool`` rather than raising).
    """
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        return None

    serializer = URLSafeTimedSerializer(secret, salt=_SESSION_SALT)
    try:
        payload = serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    except Exception:  # noqa: BLE001 - any other deserialization failure -> not authenticated
        return None

    if not isinstance(payload, dict):
        return None
    email = payload.get("email")
    if not isinstance(email, str) or not email:
        return None
    return email
