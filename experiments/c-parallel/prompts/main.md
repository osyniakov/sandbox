You are the MAIN/PACKAGING worker in a parallel development pipeline. A foundation commit already provides, in package `com.example.todo` under `app/`: `Todo`, a thread-safe `TodoStore`, and a skeletal `TodoServer` (constructor takes a port, `getPort()`, `start()`/`stop()`). Sibling agents are implementing the endpoints and the integration tests on other branches IN PARALLEL; your changes will be git-merged with theirs, so stay strictly in your lane.

Read `SPEC.md` first. Your job is checklist item 11 (entry point, packaging, README):

- Add `com.example.todo.Main` with a `main` method that reads `$PORT` (default 8080), starts a `TodoServer` on it, and prints the listening port. Do not implement any endpoints.
- Configure `app/pom.xml` so `mvn -q package` produces a runnable jar (manifest `Main-Class`; a shaded/fat jar so Jackson is bundled).
- Write `app/README.md`: build and run instructions ($PORT override included) and a short API reference table taken from `SPEC.md`.

Rules:
- Do NOT modify `TodoServer`, `TodoStore`, `Todo`, or any existing source or test file — only add new files, plus the minimal `pom.xml` plugin additions (every extra changed line is a potential merge conflict).
- Verify: `mvn -q test` still passes and `mvn -q package -DskipTests` produces a jar that starts (`PORT=18123 java -jar ...` prints the port; then kill it).
- Tick checkbox 11 in `SPEC.md` when genuinely done. Touch no other checkboxes.
- Do NOT run any git commands.
