You are the FOUNDATION agent in a parallel development pipeline. Other agents will build on top of your work in parallel branches, so the interfaces you define here are contracts — pick them carefully and keep them minimal.

Read `SPEC.md` first. Your job is ONLY the first three checklist items:

1. Maven project scaffold in `app/` (Java 21, JUnit 5, Jackson databind dependency wired up), `mvn -q test` passing.
2. `com.example.todo.Todo` (fields: `id` String, `title` String, `completed` boolean) and a thread-safe `com.example.todo.TodoStore` (create/get/list/update/delete over a concurrent map, UUID ids) with direct unit tests.
3. A SKELETAL `com.example.todo.TodoServer` wrapping `com.sun.net.httpserver.HttpServer`: constructor takes a port (0 = ephemeral), `getPort()` returns the actual bound port, `start()`/`stop()` lifecycle, holds a `TodoStore`. Do NOT implement any request routing or endpoints — a later agent adds the `/todos` handler. Cover start/port/stop with a small test.

Use exactly the package `com.example.todo` and exactly the class names above — parallel agents will code against them sight unseen.

Rules:
- Run `mvn -q test` from `app/` and make it pass before you finish.
- Tick the first three checkboxes in `SPEC.md` when they are genuinely done. Touch nothing else in `SPEC.md`.
- Do NOT run any git commands — the harness handles version control.
- Do NOT implement any HTTP endpoints, `Main` class, or README.
