# Spring Boot OAuth2 / JWT / Federated Identity Playground

A runnable Spring Boot 3.2 project for exploring three closely related security concepts:

- **OAuth 2.0** — Authorization Code flow with real Identity Providers (Google, GitHub)
- **JWT** — Issuing and validating RS256-signed JSON Web Tokens
- **Federated Identity** — Normalizing heterogeneous user attributes from multiple IdPs into a single internal representation

---

## Concepts at a Glance

```
Browser / curl
      │
      ▼
Spring Boot App  (port 8080)
      │
      ├── /public/**          → open, no auth
      ├── /api/me             → requires Bearer JWT
      ├── /api/admin/secret   → requires Bearer JWT + ROLE_ADMIN
      │
      └── /oauth2/authorization/google   ──▶  Google (OIDC)
      └── /oauth2/authorization/github   ──▶  GitHub (OAuth2)
                                               │
                           FederatedIdentityAuthenticationSuccessHandler
                                               │
                              normalises Google/GitHub user attributes
                              mints a local RS256 JWT
                                               │
                           {"token": "eyJ..."}  ◀── returned to caller
```

After login, the client sends `Authorization: Bearer <jwt>` on every API call. The Resource Server validates the JWT locally using the RSA public key — no round-trip to the IdP.

---

## Running Without Real OAuth Credentials

The app starts and most things work even without Google/GitHub credentials.

### Start the app

```bash
mvn spring-boot:run
```

### Test the public endpoint (no token needed)

```bash
curl http://localhost:8080/public/hello
# {"message":"Hello, World!","description":"This endpoint is public — no authentication needed."}
```

### Test the protected endpoint (no token → 401)

```bash
curl http://localhost:8080/api/me
# 401 Unauthorized
```

The OAuth2 login flow (`/oauth2/authorization/google`) will redirect to the real IdP, which will fail gracefully without valid client credentials. All JWT logic (mint, verify, protected endpoints) is fully testable via the test suite without any IdP.

---

## Running With Real OAuth Credentials

### 1. Register a Google OAuth2 App

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth2 **Web application** credential
3. Add `http://localhost:8080/login/oauth2/code/google` as an **Authorized redirect URI**

### 2. Register a GitHub OAuth App

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set **Authorization callback URL** to `http://localhost:8080/login/oauth2/code/github`

### 3. Set environment variables and run

```bash
export GOOGLE_CLIENT_ID=your-google-client-id
export GOOGLE_CLIENT_SECRET=your-google-client-secret
export GITHUB_CLIENT_ID=your-github-client-id
export GITHUB_CLIENT_SECRET=your-github-client-secret

mvn spring-boot:run
```

### 4. Complete the login flow

Open a browser and visit one of:
- `http://localhost:8080/oauth2/authorization/google`
- `http://localhost:8080/oauth2/authorization/github`

After authenticating with the IdP, you'll receive a JSON response:

```json
{
  "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9...",
  "tokenType": "Bearer",
  "provider": "google",
  "subject": "google:109876543210987654321"
}
```

Use that token in subsequent API calls:

```bash
TOKEN="eyJ..."

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/me
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/admin/secret
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/public/hello` | None | Open endpoint |
| `GET` | `/api/me` | Bearer JWT | Returns decoded JWT claims |
| `GET` | `/api/admin/secret` | Bearer JWT + `ROLE_ADMIN` | Admin-only endpoint |
| `GET` | `/actuator/health` | None | Spring Boot health check |

---

## JWT Structure

Every token minted by this app is an RS256-signed JWT with the following claims:

```json
{
  "iss": "http://oauth-playground.local",
  "sub": "google:109876543210987654321",
  "iat": 1712000000,
  "exp": 1712003600,
  "name": "Alice Example",
  "email": "alice@example.com",
  "provider": "google",
  "roles": ["ROLE_USER"]
}
```

Paste any token into [jwt.io](https://jwt.io) to inspect it.

---

## Key Classes

| Class | Package | Purpose |
|-------|---------|---------|
| `JwtConfig` | `config` | Generates RSA key pair; provides `JwtEncoder`, `JwtDecoder`, and a custom `JwtAuthenticationConverter` that reads the `roles` claim |
| `SecurityConfig` | `config` | Two `SecurityFilterChain` beans: (1) stateless JWT resource server for `/api/**`, (2) OAuth2 login chain for browser flows |
| `JwtTokenService` | `security` | Mints and verifies RS256 JWTs |
| `UserPrincipal` | `security` | Provider-agnostic user record: `subject`, `name`, `email`, `provider`, `roles` |
| `FederatedIdentityAuthenticationSuccessHandler` | `security` | OAuth2 post-login hook — normalises Google/GitHub attributes into `UserPrincipal`, mints JWT, returns it as JSON |
| `ApiController` | `web` | REST endpoints: `/public/hello`, `/api/me`, `/api/admin/secret` |

---

## Architecture Notes

### Why two `SecurityFilterChain` beans?

API clients (curl, mobile apps) use **stateless** Bearer tokens — no cookies, no sessions.
Browser clients need **stateful** behaviour during the OAuth2 Authorization Code dance (the `state` parameter must survive the redirect to the IdP and back).

Separating them keeps each concern clean:

```
Chain 1  @Order(1)  securityMatcher("/api/**")
         → stateless, JWT Resource Server, no session

Chain 2  @Order(2)  all other paths
         → OAuth2 login, session for the redirect dance, public routes
```

### Why a transient RSA key pair?

The key pair is generated fresh on every startup (`RSAKeyGenerator(2048)` in `JwtConfig`). This means:

- **Zero setup** — no key files, no keystore, no config needed to run
- **Tokens don't survive a restart** — good demonstration that JWTs are only valid as long as the signing key is available
- In production: load a stable key from a secrets manager (AWS KMS, HashiCorp Vault, a `KeyStore` file, etc.)

### Federated Identity normalisation

Google (OIDC) and GitHub (plain OAuth2) return user attributes under different names:

| Attribute | Google claim | GitHub attribute |
|-----------|-------------|-----------------|
| User ID | `sub` | `id` (integer) |
| Name | `name` | `name` (or `login` if null) |
| Email | `email` | `email` (may be null for private accounts) |

`FederatedIdentityAuthenticationSuccessHandler` normalises these into a `UserPrincipal` with a `subject` prefixed by the provider name (e.g. `"google:12345"` vs `"github:67890"`), preventing ID collisions across providers.

### Role-based access control from JWT

Spring Security's default `JwtGrantedAuthoritiesConverter` reads the `scope`/`scp` claim and prefixes values with `SCOPE_`. This app uses a **custom converter** (defined in `JwtConfig.jwtAuthenticationConverter()`) that reads the `roles` claim instead, with no prefix — so `"ROLE_ADMIN"` in the JWT maps directly to the `ROLE_ADMIN` authority that `hasAuthority("ROLE_ADMIN")` checks.

---

## Running the Tests

```bash
mvn test
```

All 15 tests run without any OAuth credentials or network access.

| Test class | What it covers |
|------------|----------------|
| `JwtTokenServiceTest` | Mint/verify round-trip, claim preservation, expiry, multi-user isolation |
| `ApiControllerTest` | Public endpoint access, 401 without token, `/api/me` with valid JWT, 403 for non-admin, 200 for admin |

---

## Project Structure

```
src/
├── main/
│   ├── java/com/example/oauthplayground/
│   │   ├── OauthPlaygroundApplication.java
│   │   ├── config/
│   │   │   ├── JwtConfig.java          ← RSA key pair, JwtEncoder/Decoder, authorities converter
│   │   │   └── SecurityConfig.java     ← dual filter chains
│   │   ├── security/
│   │   │   ├── UserPrincipal.java      ← provider-agnostic user record
│   │   │   ├── JwtTokenService.java    ← mint + verify JWTs
│   │   │   └── FederatedIdentityAuthenticationSuccessHandler.java
│   │   └── web/
│   │       └── ApiController.java      ← REST endpoints
│   └── resources/
│       └── application.yml
└── test/
    └── java/com/example/oauthplayground/
        ├── JwtTokenServiceTest.java
        └── ApiControllerTest.java
```
