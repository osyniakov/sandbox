# Kleinanzeigen data-access method (spike sandbox-yqf.1)

## Decision

Bead `sandbox-yqf.7` must implement the Kleinanzeigen comparable-listings
search using the **`kleinanzeigen-api` Python package (PyPI, MIT license,
`github.com/monkrel/kleinanzeigen-api`)**, which talks to the same
unofficial mobile-app JSON API (`api.kleinanzeigen.de`) that the official
Android app uses. It is not headless-browser scraping and not raw HTML
scraping — it is a maintained wrapper around a reverse-engineered private
API, used read-only for search, at low volume, with the library's default
rate limiting left untouched. Manual paste-in of comparable listing
URLs/prices is documented below as the resilience fallback if this library
breaks, but it is *not* the method to build against now.

---

## 1. Official API status

**Could not verify directly.** `www.kleinanzeigen.de`,
`developer.kleinanzeigen.de`, `api.kleinanzeigen.de`, and `adevinta.com`
(Kleinanzeigen's parent company) are all **blocked by this sandbox's egress
policy** — every `curl` attempt returned `CONNECT tunnel failed, response
403`, confirmed against the proxy's own failure log
(`$HTTPS_PROXY/__agentproxy/status` shows `connect_rejected` /
"gateway answered 403 to CONNECT (policy denial or upstream failure)" for
`www.kleinanzeigen.de:443`, logged twice). Per the proxy README, a 403 on
CONNECT means the destination is not allowed for this session; it explicitly
instructs not to retry or route around it, so I did not attempt further
workarounds and am reporting the block instead.

**Indirect evidence (reachable):** The `kleinanzeigen-api` PyPI package
(fetched via `pypi.org/pypi/kleinanzeigen-api/json`, which *is* reachable)
describes itself as an **"Unofficial Python client"** that "talks to the
same mobile JSON API (`api.kleinanzeigen.de`) the official Android app
uses," authenticating with "app-distribution Basic-auth credentials baked
into the Android client, not personal secrets," and impersonating a Chrome
TLS fingerprint via `curl_cffi` to get past TLS-layer blocking of plain
`requests` clients. A maintained project going to this much effort to
reverse-engineer app internals is strong circumstantial evidence that no
public, sanctioned partner/developer API exists — nobody builds a TLS
fingerprint-spoofing client against an API they could just get official
credentials for. This is consistent with general prior knowledge that
Kleinanzeigen (formerly eBay Kleinanzeigen) retired third-party partner API
access some years ago, but that prior knowledge is **not independently
re-verified** here — flagging this as a real gap, not glossing over it.

## 2. robots.txt and ToS

**Could not fetch directly** — `https://www.kleinanzeigen.de/robots.txt`
and any AGB/ToS page are unreachable for the same egress-policy reason as
above (403 on CONNECT). I am not guessing their contents.

**Secondary evidence (reachable):** the same `kleinanzeigen-api` README
(pulled from the PyPI long-description, which PyPI itself serves and is
allow-listed in this sandbox) states plainly, under its own "Legal &
etiquette" section:

> "Kleinanzeigen's Terms of Service **forbid automated access**. This
> library is published for educational/personal use; **you are
> responsible** for how you use it. Don't scrape at scale, don't
> redistribute the data, and don't build anything that harms the service or
> its users."

That is a paraphrase/quote from a third party who has apparently read the
ToS, not a firsthand read of the clause text. Treat "ToS forbids automated
access" as established for planning purposes, but the exact clause wording,
any carve-outs, and crawl-delay/robots.txt specifics remain unverified in
this spike.

## 3. Existing OSS approaches

GitHub search (`api.github.com/search/*`, `github.com/search`) was
**not usable in this sandbox**: the GitHub API is scoped to this session's
own configured repository only (`api.github.com/repos/osyniakov/sandbox`
itself returned 403; the search endpoints returned "sessions are bound to
their configured repositories"), and `github.com/search` returned a plain
403. So this survey relies on PyPI, which was reachable.

- **`kleinanzeigen-api`** (PyPI: `kleinanzeigen-api`, repo:
  `github.com/monkrel/kleinanzeigen-api`)
  - Language: Python, `requires_python >= 3.9`, MIT license, single runtime
    dependency (`curl-cffi>=0.7`).
  - Activity: 4 releases, `0.1.0` (2026-06-06) → `0.4.0` (2026-07-05) —
    roughly weekly cadence over a month, most recent release about a month
    before this spike (today: 2026-08-07). Reads as actively developed, not
    abandoned. Could not confirm GitHub star count or issue activity
    (GitHub blocked as above), so "maintenance health" here is judged only
    from PyPI release cadence, not community signals.
  - Approach: **API reverse-engineering**, not HTML scraping and not a
    headless browser. It calls the private mobile-app JSON API directly,
    impersonates a Chrome TLS fingerprint (`curl_cffi`) to get past
    TLS-level bot blocking, and uses Basic-auth credentials that ship
    baked into the Android app (the library bundles working defaults;
    if Kleinanzeigen rotates them the library exposes
    `KLEINANZEIGEN_BASIC_USER`/`KLEINANZEIGEN_BASIC_PW` overrides).
  - Capabilities relevant to this app: `search(q=, category=, location=,
    distance_km=, min_price=, max_price=, sort_type=, pages=, exclude=)`
    returns `Listing` objects with `id, title, description, price,
    price_type, url, city, zip_code, latitude, longitude, size_m2, rooms,
    posted, poster_type, category_id, images, attributes`. Also has
    `get_ad(id)`, `search_rentals(...)`, and a near-real-time
    `iter_new_ads()` (not needed for this app). No login required for
    search/read use — login is only needed for posting/managing own ads.
  - Built-in guardrails: defaults to **~1.5s/request rate limiting with
    jitter**; README explicitly says "Don't lower it much, and cache
    results instead of tight polling."
  - Own stated legal position: "Terms of Service forbid automated access
    ... published for educational/personal use ... you are responsible."

- **Other package names checked and not found on PyPI** (all 404):
  `kleinanzeigen-bot`, `kleinanzeigen`, `kleinanzeigen-scraper`,
  `ebay-kleinanzeigen-api`, `python-kleinanzeigen`,
  `kleinanzeigen-crawler`, `ebay-kleinanzeigen`, `kleinanzeigen-py`,
  `kleinanzeigen-client`, `kleinanzeigen-py3`, `kleinanzeigen4py`,
  `kleinanzeigenapi`, `kleinanzeigen-search`, `kleinanzeigen-cli`.
  PyPI's own search UI (`pypi.org/search/?q=...`) returned a bot-challenge
  page ("Client Challenge", JS-required) rather than results, so this list
  is from guessing plausible names against the JSON API, not an exhaustive
  index search — a real gap, noted rather than hidden. No competing
  actively-maintained package surfaced.

## 4. Chosen method for sandbox-yqf.7

Implement the search module against **`kleinanzeigen-api`** as follows:

1. Add `kleinanzeigen-api` as a project dependency (pin, e.g.
   `kleinanzeigen-api>=0.4.0,<0.5`, and re-check for updates before pinning
   further since it's a young, fast-moving package).
2. For each identified item from the photo-identification step, call
   `KleinanzeigenAPI().search(q=<item search term>, sort_type="PRICE_ASCENDING"
   or "DATE_DESCENDING", pages=1)` (start with `pages=1`; only raise to 2 if
   result counts are too sparse for a price estimate) to fetch comparable
   listings, and use `exclude=[...]` to filter obvious noise terms (e.g.
   "defekt", "bastler", "ersatzteile") if the item is meant to be working.
3. Extract `.price` from each returned `Listing` to build the sell-price
   recommendation (e.g. median or range of comparable listing prices).
   `search_rentals`, `iter_new_ads`, and the logged-in features (chat, own
   ad management, posting) are out of scope — this app only needs read-only
   search of other people's listings.
4. Guardrails (mandatory, do not weaken):
   - **Do not lower the library's default rate limit** (~1.5s/request with
     jitter). Do not use `mode="frontier"`/fast-watch mode — that mode is
     built for near-real-time monitoring at ~20 req/s and is unnecessary
     and inappropriate for this app's occasional lookup use case.
   - **Do not use `iter_new_ads()`** or any polling/watch loop — this app
     performs one-shot searches triggered by user action (photographing an
     item), not continuous monitoring.
   - Cache/memoize results per query within a decluttering session to avoid
     redundant identical calls (the server itself caches ~2 minutes anyway).
   - Keep `pages` low (1–2) — the app needs a representative sample of
     comparable listings for a price estimate, not exhaustive results.
   - No login/credentials configuration needed; do not add
     `KLEINANZEIGEN_BASIC_USER`/`PW` overrides unless the bundled defaults
     start failing with 401/403 (per the library's own documented fallback).
   - Handle 401/403 (credential rotation on Kleinanzeigen's side) and
     network errors by degrading gracefully — e.g. surface "comparable
     prices unavailable, enter manually" in the app UI — rather than
     retrying aggressively or falling back to a heavier scraping approach.
   - Total request volume must stay consistent with "personal, occasional,
     single-user tool": a handful of searches per declutter session, not
     bulk/scheduled scraping.
5. **Documented fallback** (not the primary build target, but note it in
   the module design for resilience): if this library stops working
   (credentials rotated and the maintainer doesn't update it in time, or the
   package is abandoned/pulled), the module should degrade to letting the
   user manually paste in comparable listing URLs/prices rather than
   silently retrying against a broken or blocked endpoint, or attempting to
   build a replacement scraper under time pressure.

## 5. Legal / ToS risk note

This is a genuine, non-trivial gray area — stating it plainly rather than
resolving it either direction by assumption:

- The chosen library's own documentation states Kleinanzeigen's ToS
  "forbid automated access." Using it is, **by the letter of that stated
  clause, a ToS violation**, not an authorized integration. This spike did
  not independently confirm the exact clause wording (kleinanzeigen.de is
  unreachable from this sandbox), so treat that as the working assumption,
  not a certainty.
- ToS violations of this kind are typically a **contractual/civil matter**
  between the user (or an account, if logged in) and Kleinanzeigen GmbH —
  not a criminal one. This app's design as specified doesn't require
  logging in for search, which limits the practical enforcement surface to
  IP/traffic-pattern based blocking rather than account bans.
- For **this specific use case** — personal, non-commercial, single-user,
  low-volume (a few searches per declutter session, not scheduled/bulk
  scraping, no data redistribution, no resale of scraped data) — the
  realistic practical risk is low: the most likely consequence of
  detection is a rate-limit or temporary IP block, not legal action. Using
  an existing, actively-maintained library with sane default rate-limiting
  (rather than hand-rolling a more aggressive scraper) further reduces the
  chance of tripping abuse detection.
- This is **not the same as saying it's fine**. It remains an activity the
  service provider has stated it does not permit. If this tool were ever
  scaled up (many users, high query volume), made commercial, used to
  redistribute Kleinanzeigen's data, or run unattended/continuously, the
  risk profile changes materially and this decision should be revisited —
  at that point the manual-paste-in fallback (or pursuing an actual partner
  relationship, if one becomes available) is the appropriate path, not a
  bigger scraper.

---

## Fetches/searches performed and their outcomes (for auditability)

| Target | Result |
|---|---|
| `https://www.kleinanzeigen.de/robots.txt` | Blocked — 403 on CONNECT (sandbox egress policy) |
| `https://developer.kleinanzeigen.de` | Blocked — 403 on CONNECT |
| `https://api.kleinanzeigen.de` | Blocked — 403 on CONNECT |
| `https://adevinta.com`, `https://developers.adevinta.com` | Blocked — 403 on CONNECT |
| `https://www.ebay-kleinanzeigen.de/robots.txt` (legacy domain) | Blocked — 403 on CONNECT |
| `https://api.github.com/search/repositories?q=kleinanzeigen` | 403 — session scoped to configured repo only |
| `https://api.github.com/repos/octocat/Hello-World`, `.../osyniakov/sandbox` | 403 — same scoping restriction, GitHub API effectively unusable here |
| `https://github.com/search?q=kleinanzeigen+scraper` | 403 |
| `https://pypi.org/search/?q=kleinanzeigen` | 200 but served a JS "Client Challenge" bot-check page, no usable results |
| `https://pypi.org/pypi/kleinanzeigen-api/json` | 200 — primary evidence source for sections 1–4 |
| ~13 other guessed PyPI package names | All 404 (not found) |

This table is provided so bead `sandbox-yqf.7`'s implementer and any
reviewer can see exactly what was and wasn't independently verified, rather
than treating this document as fully first-party-verified fact.
