# PROGRESS

Memory shared between iterations of the development loop. Each iteration rewrites
the sections below and appends one line to the iteration log.

## Current state

All 12 SPEC.md acceptance criteria are now checked off. `app/` is a complete,
tested TODO REST API:

- `Todo` / `TodoStore` (unchanged from prior iteration) — thread-safe in-memory
  CRUD store.
- `TodoServer` (`app/src/main/java/com/example/todo/TodoServer.java`) — wraps
  `com.sun.net.httpserver.HttpServer`. One context (`/todos`) routes both the
  collection and `/todos/{id}` item paths internally based on the path
  remainder. Uses Jackson (`ObjectMapper`, `FAIL_ON_UNKNOWN_PROPERTIES`
  disabled) for JSON (de)serialization; a private static `TodoRequest` DTO
  (public fields, Jackson auto-detects them) captures incoming
  `{title, completed?}` bodies. Implements `POST`/`GET` on `/todos` and
  `GET`/`PUT`/`DELETE` on `/todos/{id}`, all error paths (400 malformed/blank
  title, 404 unknown id, 405 wrong method on a known path, 404 on unknown
  nested paths like `/todos/{id}/extra`), and sets `Content-Type:
  application/json` on every JSON response. `getPort()` exposes the actual
  bound port after starting on port 0; `stop()` shuts down cleanly.
- `Main` (`app/src/main/java/com/example/todo/Main.java`) — starts a
  `TodoServer` on `$PORT` (default `8080`) and prints the bound port.
- `app/README.md` — build/run/test instructions and an endpoint table.

`TodoServerTest` (18 integration tests, `java.net.http.HttpClient` against a
`TodoServer` started on port 0 per test via `@BeforeEach`/`@AfterEach`) covers
every endpoint: create (with/without explicit `completed`), missing/blank
title, malformed JSON, list, get by id (found/404), put (200/404/400 invalid
body/400 malformed JSON), delete (204/404), 405 on the collection and on an
item path, and 404 on an unknown nested path. Combined with the 10
`TodoStoreTest` unit tests, `mvn -q test` passes 28/28 (verified via
`target/surefire-reports/*.txt` and process exit code).

`pom.xml` was updated to add `maven-shade-plugin` (bound to the `package`
phase) producing a runnable fat jar `target/todo-api.jar` with Jackson bundled
and a `Main-Class` manifest entry — plain `maven-jar-plugin` was tried first
but produces a thin jar that throws `NoClassDefFoundError` for
`ObjectMapper` at runtime since Jackson isn't on the classpath outside Maven;
shade fixes this. Manually smoke-tested: built the jar, ran
`PORT=18081 java -jar target/todo-api.jar`, and exercised every endpoint with
`curl` (POST/GET/PUT/DELETE, including the deleted-id 404) — all responses
matched spec.

## Next step

SPEC.md is fully complete (12/12 boxes checked) and `mvn -q test` passes.
There is no mandated next step. If further polish is wanted, optional
ideas (not in SPEC, do not add without user request): request logging,
`OPTIONS`/CORS handling, pagination, or a Dockerfile. Otherwise this
iteration loop can stop.

## Gotchas

- `mvn` and `java` both print a `Picked up JAVA_TOOL_OPTIONS: ...` banner line
  to stdout/stderr before any real output (proxy/truststore config from the
  sandbox environment) — ignore it, it's not a build warning.
- `mvn -q test`/`mvn -q package` are silent on success; check the exit code or
  `app/target/surefire-reports/*.txt` to confirm pass counts rather than
  relying on visible output. A `| grep -v "Picked up JAVA_TOOL_OPTIONS"`
  pipe's own exit code (1 when nothing else printed) is NOT the build's exit
  code — check separately if you need it.
- A plain `maven-jar-plugin` manifest-only jar does **not** include Jackson on
  the runtime classpath, so `java -jar target/todo-api.jar` fails with
  `NoClassDefFoundError: com/fasterxml/jackson/databind/ObjectMapper`. Use
  `maven-shade-plugin` (already configured) to produce a fat jar instead —
  don't revert to bare `maven-jar-plugin` without also solving the classpath
  problem (e.g. `Class-Path` manifest entries pointing at the local `.m2`
  repo, which is fragile).
- `TodoServer` routes everything through a single `HttpServer` context
  (`/todos`); do not add a second `createContext` call for `/todos/{id}` —
  `HttpServer` matches contexts by path prefix, and a second context would
  either be redundant or shadow routing logic that already lives in
  `TodoServer.handle`.

## Iteration log

- 2026-07-11: Scaffolded `app/` Maven project (Java 21, JUnit 5, Jackson dep
  added for later use). Implemented `Todo` model and thread-safe `TodoStore`
  (ConcurrentHashMap-backed) with full CRUD, covered by 10 unit tests including
  a concurrency test. Ticked the first two SPEC checklist items. `mvn -q test`
  passes (10/10). Next: HTTP server scaffold on ephemeral port.
- 2026-07-11: Implemented the full HTTP layer — `TodoServer` (wraps
  `com.sun.net.httpserver.HttpServer`, one context routes `/todos` and
  `/todos/{id}`, Jackson JSON, all CRUD endpoints and error cases), `Main`
  (starts on `$PORT`/8080), and `app/README.md`. Added 18 integration tests
  (`TodoServerTest`) via `java.net.http.HttpClient` against a port-0 server.
  Fixed `pom.xml` to use `maven-shade-plugin` instead of bare
  `maven-jar-plugin` after discovering the thin jar threw
  `NoClassDefFoundError` for Jackson at runtime; rebuilt and smoke-tested the
  fat jar end-to-end with `curl`. Ticked all remaining SPEC checklist items
  (12/12 now checked). `mvn -q test` passes 28/28. SPEC is functionally
  complete; no mandated next step.
