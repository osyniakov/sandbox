# PROGRESS

Memory shared between iterations of the development loop. Each iteration rewrites
the three sections below and appends one line to the iteration log.

## Current state

`app/` scaffolded as a Maven project (Java 21, JUnit 5, Jackson databind dependency
already declared in `pom.xml` though not yet used). Source layout:
- `app/src/main/java/com/example/todo/Todo.java` — plain model (id, title, completed)
  with a no-arg + all-args constructor and getters/setters (Jackson-friendly).
- `app/src/main/java/com/example/todo/TodoStore.java` — thread-safe in-memory store
  backed by `ConcurrentHashMap<String, Todo>`; UUID ids; create/get/list/update/delete.
- `app/src/test/java/com/example/todo/TodoStoreTest.java` — unit tests covering all
  store operations including not-found cases and a concurrent-create stress test.

No HTTP server yet. `mvn -q test` passes (verified this iteration).

## Next step

Build the HTTP server layer: a class wrapping `com.sun.net.httpserver.HttpServer`
that starts on port 0 (ephemeral), exposes the actual bound port, and supports
clean shutdown (`stop()`). Keep it separate from routing/handlers so it's easy to
unit-test the start/stop/port-reporting behavior in isolation before wiring up the
`/todos` routes and JSON (de)serialization. That's the next unticked checklist item
in `SPEC.md`, followed immediately by the actual endpoint handlers — those two go
together naturally in the following iteration(s).

## Gotchas

- The environment's Maven/Java invocations print `Picked up JAVA_TOOL_OPTIONS: ...`
  proxy/truststore noise on every command (stdout, not stderr) — this is normal
  sandbox plumbing, not a build warning; ignore it when reading command output.
- `pom.xml` intentionally has no `maven-jar-plugin` manifest/mainClass config yet —
  add it (pointing at the eventual `Main` class) once `main()` exists, per the last
  checklist item in `SPEC.md`.

## Iteration log
- 2026-07-10: Scaffolded `app/` Maven project (Java 21, JUnit 5, Jackson dep) and
  implemented `Todo` + thread-safe `TodoStore` with full unit test coverage
  (create/get/list/update/delete, not-found cases, concurrency). `mvn -q test`
  passes. Checked off the first two SPEC.md items.
