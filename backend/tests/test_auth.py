"""Tests for ``app.auth``: Google ID token verification, email whitelist
parsing, and session token issuance/verification.

``verify_google_id_token`` is exercised via an injectable ``verify_fn``
fake (never a real network call to Google) that returns a canned
payload dict or raises, simulating the outcomes
``google.oauth2.id_token.verify_oauth2_token`` itself would produce.
"""

from __future__ import annotations

import time

import pytest

from app.auth import (
    AuthError,
    SESSION_MAX_AGE_SECONDS,
    _parse_allowed_emails,
    issue_session_token,
    verify_google_id_token,
    verify_session_token,
)


# ---------------------------------------------------------------------------
# _parse_allowed_emails
# ---------------------------------------------------------------------------


def test_parse_allowed_emails_none_is_empty_list() -> None:
    assert _parse_allowed_emails(None) == []


def test_parse_allowed_emails_empty_string_is_empty_list() -> None:
    assert _parse_allowed_emails("") == []


def test_parse_allowed_emails_blank_only_is_empty_list() -> None:
    assert _parse_allowed_emails("   ,  ,") == []


def test_parse_allowed_emails_strips_whitespace_and_lowercases() -> None:
    assert _parse_allowed_emails(" Alice@Example.com , BOB@example.com ") == [
        "alice@example.com",
        "bob@example.com",
    ]


def test_parse_allowed_emails_comma_separated_drops_empty_entries() -> None:
    assert _parse_allowed_emails("a@example.com,,b@example.com,") == [
        "a@example.com",
        "b@example.com",
    ]


# ---------------------------------------------------------------------------
# verify_google_id_token
# ---------------------------------------------------------------------------


def _fake_verify_fn(payload: dict) -> callable:
    def _verify(id_token_str, request, audience=None):
        return payload

    return _verify


def test_verify_google_id_token_valid_and_whitelisted_returns_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    fake = _fake_verify_fn({"email": "Alice@Example.com", "email_verified": True})
    email = verify_google_id_token("some-token", verify_fn=fake)
    assert email == "alice@example.com"


def test_verify_google_id_token_email_not_whitelisted_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    fake = _fake_verify_fn({"email": "eve@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_email_not_verified_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": False})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_allowed_emails_unset_raises_even_if_otherwise_valid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.delenv("ALLOWED_EMAILS", raising=False)

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_allowed_emails_empty_string_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "")

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_google_client_id_unset_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_verify_fn_raises_becomes_autherror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    def _boom(id_token_str, request, audience=None):
        raise ValueError("bad signature")

    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=_boom)


# ---------------------------------------------------------------------------
# issue_session_token / verify_session_token
# ---------------------------------------------------------------------------


def test_session_token_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "super-secret")
    token = issue_session_token("alice@example.com")
    assert verify_session_token(token) == "alice@example.com"


def test_session_token_tampered_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "super-secret")
    token = issue_session_token("alice@example.com")
    # Flip a character in the token to invalidate the signature.
    tampered_char = "x" if token[-1] != "x" else "y"
    tampered = token[:-1] + tampered_char
    assert verify_session_token(tampered) is None


def test_session_token_expired_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "super-secret")

    from itsdangerous import URLSafeTimedSerializer

    import app.auth as auth_module

    serializer = URLSafeTimedSerializer("super-secret", salt=auth_module._SESSION_SALT)
    token = serializer.dumps({"email": "alice@example.com"})

    # Verify with a max_age of 0 seconds after a short sleep to force expiry,
    # by monkeypatching SESSION_MAX_AGE_SECONDS to a value already exceeded.
    monkeypatch.setattr(auth_module, "SESSION_MAX_AGE_SECONDS", 0)
    time.sleep(1.1)
    assert verify_session_token(token) is None


def test_session_token_wrong_secret_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "secret-one")
    token = issue_session_token("alice@example.com")

    monkeypatch.setenv("SESSION_SECRET", "secret-two")
    assert verify_session_token(token) is None


def test_session_token_malformed_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "super-secret")
    assert verify_session_token("not-a-real-token") is None


def test_issue_session_token_secret_unset_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        issue_session_token("alice@example.com")


def test_issue_session_token_secret_empty_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "")
    with pytest.raises(RuntimeError):
        issue_session_token("alice@example.com")


def test_session_max_age_is_seven_days() -> None:
    assert SESSION_MAX_AGE_SECONDS == 7 * 24 * 60 * 60
