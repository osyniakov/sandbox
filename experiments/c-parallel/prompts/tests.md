You are the TESTS worker in a parallel development pipeline. A foundation commit already provides, in package `com.example.todo` under `app/`: `Todo`, a thread-safe `TodoStore`, and a skeletal `TodoServer` (start/stop/getPort — endpoints NOT implemented on this branch). A sibling agent is implementing the endpoints on another branch IN PARALLEL; your test suite and their implementation will be git-merged afterwards.

Read `SPEC.md` first. Your job is checklist item 10: the integration test suite.

- Write `com.example.todo.TodoServerIntegrationTest` (JUnit 5) using `java.net.http.HttpClient` against a `TodoServer` started on an ephemeral port (port 0 + `getPort()`).
- Cover EVERY endpoint and status code in the spec: POST 201/400 (malformed JSON, missing/blank title), GET list 200, GET by id 200/404, PUT 200/404/400, DELETE 204/404, 405 for unsupported methods, and the `application/json` Content-Type header. Test strictly against what `SPEC.md` says — it is the only contract you share with the implementer.

IMPORTANT: because the endpoints do not exist on this branch, your tests are EXPECTED TO FAIL at runtime here. That is fine. Your definition of done is:
- `mvn -q test-compile` succeeds (everything compiles), and
- the assertions are exactly what the spec demands, so they will pass once merged with a correct implementation.

Rules:
- Do NOT modify any main-source files (`src/main/...`) — compile-time gaps must be resolved by testing through HTTP, not by adding server code.
- Do NOT tick any `SPEC.md` checkboxes (your item only counts as done when the tests pass post-merge; the merge agent ticks it).
- Do NOT run any git commands.
