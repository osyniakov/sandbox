# Overriding `kleinanzeigen-api` defaults (app version, Basic-auth user/password)

This page explains how the backend's Kleinanzeigen dependency sets its
request identity, and how to override those values on Railway without
upgrading the library. Background on why we use this library is in
[`kleinanzeigen-access.md`](kleinanzeigen-access.md).

## The dependency

- Package: `kleinanzeigen-api` (PyPI), pinned in `backend/requirements.txt`
  as `kleinanzeigen-api>=0.4.0,<0.5`. Currently it resolves to **0.4.0**.
- The backend uses it in one place: `KleinanzeigenAPIProvider._get_client()`
  in `backend/app/comparable_search.py`. That method creates the client as
  plain `KleinanzeigenAPI()`, with no arguments, the first time a search runs.
  It then caches the client on the provider.

## The values the library hard-codes (0.4.0, `kleinanzeigen_api/client.py`)

```python
APP_VERSION        = "2026.25.0"
DEFAULT_BASIC_USER = "android"
DEFAULT_BASIC_PW   = "<bundled Android-app password>"
```

`KleinanzeigenAPI.__init__` resolves them like this:

```python
def __init__(self, rate_limit=1.5, app_version=APP_VERSION, ...,
             basic_user=None, basic_pw=None, ...):
    self.app_version = app_version
    user = basic_user or os.getenv("KLEINANZEIGEN_BASIC_USER") or DEFAULT_BASIC_USER
    pw   = basic_pw   or os.getenv("KLEINANZEIGEN_BASIC_PW")   or DEFAULT_BASIC_PW
```

`app_version` ends up in three headers on every request:

| Header | Value |
|---|---|
| `X-ECG-USER-AGENT` | `ebayk-android-app-<app_version>` |
| `X-ECG-USER-VERSION` | `<app_version>` |
| `User-Agent` | `Kleinanzeigen/<app_version> (Android 13; Pixel 7)` |

The user and password become the `Authorization: Basic …` header.

| Value | Constructor argument | Environment variable | Overridable on Railway today? |
|---|---|---|---|
| Basic-auth user | `basic_user` | `KLEINANZEIGEN_BASIC_USER` | **Yes**, no code change |
| Basic-auth password | `basic_pw` | `KLEINANZEIGEN_BASIC_PW` | **Yes**, no code change |
| App version | `app_version` | **none** | **No**, needs the small code change below |

## 1. User and password: set the variables on Railway

The library reads these itself, so you only need to set them on the backend
service:

1. Railway dashboard → project → **backend service** → **Variables**.
2. Add:
   - `KLEINANZEIGEN_BASIC_USER` = the new user (normally still `android`)
   - `KLEINANZEIGEN_BASIC_PW` = the new password
3. Save. Railway redeploys the service with the new variables.

Equivalent with the CLI: `railway variables --set KLEINANZEIGEN_BASIC_USER=android --set KLEINANZEIGEN_BASIC_PW=...`
(run it against the backend service).

Things to know:

- **They are runtime variables, not build arguments.** The library reads
  them with `os.getenv` when the client is created, which is at the first
  search after the process starts. Do not set them as Docker build args.
- **An empty value counts as unset.** The code uses `or`, so
  `KLEINANZEIGEN_BASIC_PW=""` silently falls back to the bundled default. To
  revert to the defaults, delete the variable.
- **Changes need a restart.** The client is built once per process and then
  cached, so a running container won't see an edited variable. Railway's
  automatic redeploy on save takes care of this.
- **Set both or neither.** Each one falls back to the default on its own, so
  setting only the password still sends the default user `android`.
- **Treat the password as a secret**, even though it is a credential that
  ships inside the Android app. Keep it in Railway Variables only, and never
  commit it.

## 2. App version: needs a small code change

There is no environment variable for `app_version`. It is only a constructor
argument, so our code has to read an environment variable and pass the value
in. Proposed change to `KleinanzeigenAPIProvider._get_client()` in
`backend/app/comparable_search.py`:

```python
import os
...
        from kleinanzeigen_api import KleinanzeigenAPI

        kwargs: dict[str, Any] = {}
        # Override the app version the library spoofs in its headers (it has
        # no env var of its own). Unset/blank -> keep the library's default.
        app_version = os.getenv("KLEINANZEIGEN_APP_VERSION", "").strip()
        if app_version:
            kwargs["app_version"] = app_version

        # Deliberately use the library's own defaults for rate_limit /
        # max_retries -- see module docstring "Rate limiting".
        self._client = KleinanzeigenAPI(**kwargs)
```

Then set `KLEINANZEIGEN_APP_VERSION` (for example `2026.40.0`) in the backend
service's Railway Variables, the same way as above. Leaving it unset or blank
keeps the library default, which matches how the user/password fallback
behaves. Use a version string that matches a real recent Android release,
because the API may reject versions it doesn't recognise.

For consistency you could also pass `basic_user` and `basic_pw` explicitly
from the same place. That isn't required, because the library already reads
`KLEINANZEIGEN_BASIC_USER` and `KLEINANZEIGEN_BASIC_PW` on its own.

### Workarounds that don't work or aren't recommended

- **Patching `kleinanzeigen_api.client.APP_VERSION` at startup has no
  effect.** Python binds the default `app_version=APP_VERSION` when the
  function is defined, so changing the module constant later doesn't change
  the default.
- **Patching `KleinanzeigenAPI.__init__.__defaults__`** would work, but it
  depends on the argument order of a young, fast-moving package. It is
  fragile, so prefer the explicit argument above.
- **Forking or vendoring the library** only to change one string isn't worth
  it.

### Out of scope

`kleinanzeigen_api/auth.py` also hard-codes `"Kleinanzeigen Android 2026.25.0"`
as the User-Agent on the OAuth login token request. It can't be overridden.
This backend never logs in, because search is anonymous and uses Basic auth
only, so that string doesn't matter here.

## When to use these overrides

Per `kleinanzeigen-access.md` §4, keep the bundled defaults unless searches
start failing. The library raises an error saying `401`/`403` "Basic-auth
credentials likely rotated", and the app then shows the "comparable prices
unavailable" fallback. In that case:

1. Check whether a newer `kleinanzeigen-api` 0.4.x release ships the new
   values. Bumping the pin is the preferred fix.
2. If no release is available yet, set the Railway variables above as a
   stop-gap. Remove them again once the library catches up, so a stale
   override doesn't later shadow newer defaults.

These overrides do not change the rate-limit guardrails. Don't touch
`rate_limit` or `max_retries`.
