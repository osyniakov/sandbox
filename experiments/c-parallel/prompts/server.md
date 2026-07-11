You are the SERVER worker in a parallel development pipeline. A foundation commit already provides, in package `com.example.todo` under `app/`: `Todo`, a thread-safe `TodoStore`, and a skeletal `TodoServer` (start/stop/getPort, no routing yet). Two sibling agents are working IN PARALLEL on other branches: one is writing the HTTP integration test suite, another is writing `Main` + packaging + README. Your changes will be git-merged with theirs, so stay strictly in your lane.

Read `SPEC.md` first. Your job is checklist items 4–9 (the HTTP endpoints):

- Implement `com.example.todo.TodoHandler` and wire it into `TodoServer` at the `/todos` context.
- `POST /todos` (201 / 400 for malformed JSON or missing/blank title), `GET /todos` (200 array), `GET /todos/{id}` (200 / 404), `PUT /todos/{id}` (200 / 404 / 400), `DELETE /todos/{id}` (204 / 404), 405 for unsupported methods, `Content-Type: application/json` on all JSON responses.
- Note: `HttpServer.createContext` is prefix-matched — route `/todos` vs `/todos/{id}` yourself.

Rules:
- You may add focused handler-level tests, but do NOT write the full HttpClient integration suite (the tests worker owns it) and do NOT create `Main` or `README.md` (the main worker owns those).
- Keep edits to existing foundation files (esp. `TodoServer`) as small as possible — every line you change there is a potential merge conflict.
- Run `mvn -q test` from `app/` and make it pass before you finish.
- Tick checkboxes 4–9 in `SPEC.md` when genuinely done. Touch no other checkboxes.
- Do NOT run any git commands.
