# PROGRESS

Memory shared between iterations of the development loop. Each iteration rewrites
the three sections below and appends one line to the iteration log.

## Current state

`app/` is a Maven project (Java 21, JUnit 5, Jackson databind). Source layout:
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
  path (`/todos`) and item path (`/todos/{id}`) by parsing the URI suffix manually
  (HttpServer contexts are prefix-based, so there's no built-in path-param routing).
  Implements POST/GET/PUT/DELETE per SPEC.md, 405 for unsupported methods on known
  paths, 400 for malformed JSON or missing/blank title, 404 for unknown ids, and
  sets `Content-Type: application/json` on every JSON response.
- `app/src/test/java/com/example/todo/TodoStoreTest.java` — unit tests for the store.
- `app/src/test/java/com/example/todo/TodoServerIntegrationTest.java` — full
  integration suite using `java.net.http.HttpClient` against a real server on an
  ephemeral port: covers every endpoint, every status code (200/201/204/400/404/405),
  and the JSON `Content-Type` header.

`mvn -q test` passes: 29 tests total (10 store unit tests + 19 integration tests),
0 failures.

No `main` method / runnable entry point yet, and no `app/README.md`.

## Next step

Add a `Main` class with a `main(String[] args)` method that starts `TodoServer` on
port 8080, or `$PORT` from the environment if set, and blocks (the server's own
executor threads keep the JVM alive once `start()` is called, so `main` just needs
to start it and print the listening port — no explicit `join`/sleep loop needed).
Then write `app/README.md` with build (`mvn -q package` or `mvn -q test`) and run
(`java -jar target/todo-api.jar` or `mvn -q exec:java`) instructions, documenting
the `$PORT` env var override. This is the last unticked SPEC.md item. Consider
whether `maven-jar-plugin` manifest config (mainClass) or `exec-maven-plugin` is
the simpler way to make the jar/README runnable — either is fine, pick whichever
needs the least new pom.xml surface area. Once this lands and `mvn -q test` still
passes, every SPEC.md checkbox will be checked — remember to append
`ALL_SPEC_ITEMS_COMPLETE` to this file at that point.

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
- `pom.xml` still has no `maven-jar-plugin` manifest/mainClass config — add it (or
  wire up `exec-maven-plugin`) once the `Main` class exists, per the next step above.

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
