# PROGRESS

Memory shared between iterations of the development loop. Each iteration rewrites
the three sections below and appends one line to the iteration log.

## Current state

Every SPEC.md checkbox is now checked. `app/` is a complete Maven project
(Java 21, JUnit 5, Jackson databind). Source layout:
- `app/src/main/java/com/example/todo/Todo.java` — plain model (id, title, completed).
- `app/src/main/java/com/example/todo/TodoStore.java` — thread-safe in-memory store
  backed by `ConcurrentHashMap<String, Todo>`; UUID ids; create/get/list/update/delete.
- `app/src/main/java/com/example/todo/TodoRequest.java` — Jackson-bindable DTO for
  request bodies (`title` + nullable `completed`), used by both POST and PUT.
- `app/src/main/java/com/example/todo/TodoServer.java` — wraps
  `com.sun.net.httpserver.HttpServer`; constructor takes a port (0 = ephemeral),
  `getPort()` reports the actual bound port, `start()`/`stop()` control lifecycle.
  Registers a single `/todos` context backed by `TodoHandler`.
- `app/src/main/java/com/example/todo/TodoHandler.java` — routes both the collection
  path (`/todos`) and item path (`/todos/{id}`) by parsing the URI suffix manually.
  Implements POST/GET/PUT/DELETE per SPEC.md, 405 for unsupported methods on known
  paths, 400 for malformed JSON or missing/blank title, 404 for unknown ids, and
  sets `Content-Type: application/json` on every JSON response.
- `app/src/main/java/com/example/todo/Main.java` — entry point; reads `$PORT`
  (defaults to 8080), constructs and starts `TodoServer`, prints the listening
  port. No explicit blocking needed — `HttpServer`'s executor threads (a cached
  thread pool set in `TodoServer`) are non-daemon, so the JVM stays alive after
  `main` returns.
- `app/src/test/java/com/example/todo/TodoStoreTest.java` — unit tests for the store.
- `app/src/test/java/com/example/todo/TodoServerIntegrationTest.java` — full
  integration suite using `java.net.http.HttpClient` against a real server on an
  ephemeral port: covers every endpoint, every status code (200/201/204/400/404/405),
  and the JSON `Content-Type` header.
- `app/pom.xml` — now also configures `maven-jar-plugin` (manifest `Main-Class`)
  and `maven-shade-plugin` (bound to `package`, produces a runnable fat jar at
  `target/todo-api.jar` with Jackson bundled).
- `app/README.md` — build (`mvn -q package`) and run (`java -jar
  target/todo-api.jar`, with `$PORT` override) instructions, an API table, and
  curl examples.

`mvn -q test` passes: 29 tests total (10 store unit tests + 19 integration tests),
0 failures. Manually verified `mvn -q package` produces a working fat jar and
`PORT=18080 java -jar target/todo-api.jar` serves real POST/GET requests correctly.

## Next step

All SPEC.md checkboxes are checked and `mvn -q test` passes, so this spec is
complete. `ALL_SPEC_ITEMS_COMPLETE` has been appended below. If given further
work in this repo, look for follow-up instructions from the user/outer loop
rather than SPEC.md, since there are no more unfinished items there.

## Gotchas

- The environment's Maven/Java invocations print `Picked up JAVA_TOOL_OPTIONS: ...`
  proxy/truststore noise on every command (stdout, not stderr) — this is normal
  sandbox plumbing, not a build warning; ignore it when reading command output.
- `HttpServer.createContext("/todos", ...)` is prefix-matched, so `TodoHandler`
  manually strips the `/todos` prefix from the request path and dispatches on
  whether anything (and how much) is left — empty remainder = collection, single
  segment = item id, anything with an extra `/` = 404. Keep that in mind if new
  sub-resources are ever added under `/todos`.
- Jackson's `JsonProcessingException` (thrown on malformed/empty JSON bodies)
  extends `IOException`, so a single `catch (IOException e)` around
  `mapper.readValue(...)` is sufficient to turn any body-parsing failure into a 400
  — no need for Jackson-specific catch clauses.
- `TodoStore.update`'s local variable is misleadingly named `previous` but actually
  holds the *new* value (`Map.computeIfPresent` returns the remapping result, not
  the old value) — it happens to be exactly what callers need (the updated Todo),
  so it's correct, just a confusing name if touched later.
- `mvn -q package` without `-DskipTests` will run the full test suite before
  producing the jar (as expected); `mvn -q test` alone does not package, so it
  won't exercise `maven-shade-plugin` — that's fine since packaging isn't part of
  the required `mvn -q test` gate, but worth knowing if a future change needs the
  jar itself validated (use `mvn -q package` and smoke-test the jar manually, as
  done this iteration via `PORT=18080 java -jar target/todo-api.jar` + curl).

## Iteration log
- 2026-07-10: Scaffolded `app/` Maven project (Java 21, JUnit 5, Jackson dep) and
  implemented `Todo` + thread-safe `TodoStore` with full unit test coverage
  (create/get/list/update/delete, not-found cases, concurrency). `mvn -q test`
  passes. Checked off the first two SPEC.md items.
- 2026-07-10: Implemented `TodoServer` (ephemeral-port HTTP server wrapper) and
  `TodoHandler` (full `/todos` + `/todos/{id}` routing: POST/GET/PUT/DELETE, 400/404/405
  error cases, JSON `Content-Type`), plus `TodoRequest` DTO. Added
  `TodoServerIntegrationTest` (19 tests) exercising every endpoint over real HTTP via
  `java.net.http.HttpClient` on an ephemeral port. `mvn -q test` passes (29 tests).
  Checked off all HTTP-layer SPEC.md items; only `Main`/`README.md` remain.
- 2026-07-10: Added `Main` class (reads `$PORT`, defaults to 8080, starts
  `TodoServer`), wired `maven-jar-plugin`/`maven-shade-plugin` into `pom.xml` so
  `mvn -q package` produces a runnable fat jar, and wrote `app/README.md` with
  build/run instructions and an API reference. Verified the packaged jar serves
  real HTTP requests via curl. `mvn -q test` passes (29 tests, 0 failures).
  Checked off the final SPEC.md item — all criteria are now implemented and tested.

ALL_SPEC_ITEMS_COMPLETE
