"""Tests for ``app.auth``: Google ID token verification, ALLOWED_EMAILS
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
    full = {"iss": "https://accounts.google.com", **payload}

    def _verify(id_token_str, request, audience=None):
        return full

    return _verify


def test_verify_google_id_token_any_verified_email_returns_normalized_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.delenv("ALLOWED_EMAILS", raising=False)

    fake = _fake_verify_fn({"email": "  Eve@Example.com ", "email_verified": True})
    assert verify_google_id_token("some-token", verify_fn=fake) == "eve@example.com"


def test_verify_google_id_token_ignores_allowed_emails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    monkeypatch.setenv("ALLOWED_EMAILS", "alice@example.com")

    fake = _fake_verify_fn({"email": "eve@example.com", "email_verified": True})
    assert verify_google_id_token("some-token", verify_fn=fake) == "eve@example.com"


def test_verify_google_id_token_email_not_verified_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": False})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


@pytest.mark.parametrize("email", [None, "", "   ", 123])
def test_verify_google_id_token_missing_or_empty_email_raises(
    monkeypatch: pytest.MonkeyPatch, email: object
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"email": email, "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_google_client_id_unset_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)

    fake = _fake_verify_fn({"email": "alice@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_verify_fn_raises_becomes_autherror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    def _boom(id_token_str, request, audience=None):
        raise ValueError("bad signature")

    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=_boom)


@pytest.mark.parametrize(
    "iss",
    ["https://evil.example.com", "accounts.google.com.evil.com", "", None, 5, ["https://accounts.google.com"], {}],
)
def test_verify_google_id_token_wrong_iss_raises(
    monkeypatch: pytest.MonkeyPatch, iss: object
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"iss": iss, "email": "a@example.com", "email_verified": True})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_missing_iss_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    def _verify(id_token_str, request, audience=None):
        return {"email": "a@example.com", "email_verified": True}

    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=_verify)


@pytest.mark.parametrize("iss", ["accounts.google.com", "https://accounts.google.com"])
def test_verify_google_id_token_legitimate_iss_succeeds(
    monkeypatch: pytest.MonkeyPatch, iss: str
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"iss": iss, "email": "A@example.com", "email_verified": True})
    assert verify_google_id_token("some-token", verify_fn=fake) == "a@example.com"


def test_verify_google_id_token_email_verified_missing_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"email": "a@example.com"})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_email_verified_string_true_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")

    fake = _fake_verify_fn({"email": "a@example.com", "email_verified": "true"})
    with pytest.raises(AuthError):
        verify_google_id_token("some-token", verify_fn=fake)


def test_verify_google_id_token_default_verify_fn_is_google_verify_oauth2_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import google.auth.transport.requests
    import google.oauth2.id_token

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-123")
    calls: list[tuple] = []

    def _recorder(token, request, audience=None):
        calls.append((token, request, audience))
        return {
            "iss": "accounts.google.com",
            "email": "a@example.com",
            "email_verified": True,
        }

    monkeypatch.setattr(google.oauth2.id_token, "verify_oauth2_token", _recorder)

    assert verify_google_id_token("tok", verify_fn=None) == "a@example.com"
    assert len(calls) == 1
    token, request, audience = calls[0]
    assert token == "tok"
    assert isinstance(request, google.auth.transport.requests.Request)
    assert audience == "client-123"


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
    # Token format is payload.timestamp.signature. Mutate a character that is
    # guaranteed to change the decoded bytes. The FINAL character of the
    # signature is avoided: it carries non-canonical base64 padding bits, so
    # changing it can decode to identical bytes and still verify (flaky).
    payload, timestamp, signature = token.split(".")

    def _swap(segment: str, index: int) -> str:
        replacement = "B" if segment[index] == "A" else "A"
        return segment[:index] + replacement + segment[index + 1 :]

    variants = {
        "payload": ".".join([_swap(payload, 0), timestamp, signature]),
        "timestamp": ".".join([payload, _swap(timestamp, 0), signature]),
        "signature": ".".join([payload, timestamp, _swap(signature, 0)]),
        "signature_interior": ".".join(
            [payload, timestamp, _swap(signature, len(signature) // 2)]
        ),
    }
    for name, tampered in variants.items():
        assert tampered != token, name
        assert verify_session_token(tampered) is None, name


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
