"""Google Sign-In verification, email whitelist, and session tokens.

This module is the authentication core: it verifies Google-issued ID
tokens (proving the caller actually authenticated with Google and owns
the associated email), checks the resulting email against an
operator-controlled whitelist (``ALLOWED_EMAILS``), and issues/verifies
our own signed session tokens so the frontend doesn't need to re-send
the Google ID token on every request.

Fail-closed by design
----------------------
Every piece of this module treats "unconfigured" as "deny", not
"allow":

- ``ALLOWED_EMAILS`` unset/empty -> the whitelist is empty -> no email
  can pass -> :func:`verify_google_id_token` always raises
  :class:`AuthError`. There is no sensible non-empty default for a
  security whitelist (unlike e.g. ``ALLOWED_ORIGINS`` in ``app.main``,
  which has a known-safe localhost default).
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
- ``ALLOWED_EMAILS``: comma-separated whitelist of emails allowed to
  sign in, matched case-insensitively.
- ``SESSION_SECRET``: secret key used to sign/verify our own session
  tokens.
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


class AuthError(Exception):
    """Raised when Google ID token verification / whitelist checking fails.

    Covers a malformed/invalid/expired/signature-invalid token, an
    unverified email, an email not on the ``ALLOWED_EMAILS`` whitelist,
    and missing ``GOOGLE_CLIENT_ID``/``ALLOWED_EMAILS`` configuration
    (see module docstring "Fail-closed by design").
    """


def _parse_allowed_emails(raw: str | None) -> list[str]:
    """Parse the ``ALLOWED_EMAILS`` env var into a lowercased email whitelist.

    Mirrors ``app.main._parse_allowed_origins``'s comma-separated,
    strip-whitespace parsing convention, with two deliberate
    differences suited to a security whitelist rather than a CORS
    origin list:

    - Every entry is lowercased, since email whitelist matching must be
      case-insensitive (mail providers treat the local part as
      case-sensitive in theory, but in practice -- and per Google
      Sign-In behavior -- comparing case-insensitively is the safe,
      expected behavior here and avoids operators being locked out by
      a stray capital letter).
    - Unlike ``ALLOWED_ORIGINS`` (which falls back to a non-empty,
      known-safe default), ``ALLOWED_EMAILS`` defaults to an **empty**
      list when ``raw`` is ``None``/empty/blank-only. There is no
      sensible non-empty default for a security whitelist -- failing
      closed (nobody is allowed in) is the only safe behavior when this
      is unconfigured.
    """
    if not raw:
        return []
    return [entry.strip().lower() for entry in raw.split(",") if entry.strip()]


def _allowed_emails() -> list[str]:
    """Read+parse ``ALLOWED_EMAILS`` fresh from the environment.

    A small helper (rather than a module-level constant computed once
    at import) so a redeployed env var change takes effect on a normal
    restart, matching this codebase's read-at-call-time convention
    (see module docstring).
    """
    return _parse_allowed_emails(os.environ.get("ALLOWED_EMAILS"))


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

    - ``GOOGLE_CLIENT_ID`` to be configured (non-empty) -- otherwise
      there is no audience to verify against, so this always raises.
    - the verified payload's ``email_verified`` claim to be exactly
      ``True``.
    - the verified email (compared case-insensitively) to be present in
      the current ``ALLOWED_EMAILS`` whitelist (see ``_allowed_emails``
      above; an unset/empty whitelist always fails this check).

    ``verify_fn`` is injectable so tests can supply a fake that returns
    a canned payload dict without making a real network call to Google;
    it is called as ``verify_fn(id_token_str, request, audience=client_id)``
    matching the real function's signature.

    Returns the verified email, lowercased. Raises :class:`AuthError`
    for any failure -- malformed/invalid/expired/bad-signature token
    (whatever ``verify_fn`` raises is caught broadly and re-raised as
    ``AuthError``, matching this codebase's
    ``app.identification.IdentificationError`` pattern of wrapping
    underlying provider failures), unverified email, or an email not on
    the whitelist.
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

    if payload.get("email_verified") is not True:
        raise AuthError("Google ID token's email_verified claim is not True")

    email = payload.get("email")
    if not isinstance(email, str) or not email:
        raise AuthError("Google ID token payload has no email claim")
    email = email.lower()

    if email not in _allowed_emails():
        raise AuthError(f"Email {email!r} is not on the allowed list")

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
