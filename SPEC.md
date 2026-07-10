# SPEC: TODO REST API (Java)

Build a small TODO REST API in the `app/` directory of this repository.

## Constraints

- Plain Java 21. HTTP layer uses `com.sun.net.httpserver.HttpServer` — **no Spring, no frameworks**.
- Build with Maven (`app/pom.xml`). Tests with JUnit 5.
- Jackson (`jackson-databind`) is allowed for JSON; hand-rolled JSON is also fine.
- All state is in-memory; no database, no files.
- `mvn -q test` run from `app/` must pass at the end of every iteration.

## Data model

A todo has:
- `id` — server-generated string (UUID is fine)
- `title` — required, non-blank string
- `completed` — boolean, defaults to `false`

## Acceptance criteria

Tick each box (`[x]`) only when it is implemented **and covered by a passing test**.

- [x] Maven project scaffold in `app/` (Java 21, JUnit 5 wired up) — `mvn -q test` runs successfully, even with a trivial placeholder test
- [x] `Todo` model and a thread-safe in-memory `TodoStore` with create/get/list/update/delete, unit-tested directly (no HTTP)
- [x] HTTP server class that can start on port 0 (ephemeral) and report its actual port, with clean shutdown; used by tests
- [x] `POST /todos` — creates a todo from JSON `{"title": ..., "completed"?: ...}`; returns 201 with the created todo (including `id`); returns 400 for malformed JSON or missing/blank title
- [x] `GET /todos` — returns 200 with a JSON array of all todos
- [x] `GET /todos/{id}` — returns 200 with the todo, or 404 for an unknown id
- [x] `PUT /todos/{id}` — full update of title/completed; 200 with the updated todo; 404 unknown id; 400 invalid body
- [x] `DELETE /todos/{id}` — 204 on success; 404 for an unknown id
- [x] Unsupported methods on known paths return 405; all JSON responses set `Content-Type: application/json`
- [x] Integration tests using `java.net.http.HttpClient` against a server on an ephemeral port, covering every endpoint including the error cases above
- [ ] `app/README.md` with build/run instructions, and a `main` method that starts the server on port 8080 (or `$PORT`)
