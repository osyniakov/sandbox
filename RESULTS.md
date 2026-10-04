# Experiment results: autonomous development loop

> **Follow-up:** this run (run 0) prompted a controlled three-way harness
> comparison — sequential loop vs. single session vs. parallel worktree
> fan-out — with full token/cost/wall-clock instrumentation. See
> [`experiments/COMPARISON.md`](experiments/COMPARISON.md).

A Ralph-style loop (`loop/run-loop.sh`) fed `PROMPT.md` to fresh headless
Claude Code sessions until the `SPEC.md` checklist was complete and
`mvn -q test` was green. The workload was a plain-Java TODO REST API built
from an empty repo. **Total: 3 productive iterations across 2 runs, ~7 minutes
of agent wall-clock time, 29 tests, zero human-written application code.**

## Iteration record

| Run.Iter | Commit    | Duration | What the agent did |
|----------|-----------|----------|--------------------|
| 1.1      | `654d7a9` | ~1m20s   | Maven scaffold, `Todo` model, thread-safe `TodoStore`, 10 unit tests |
| 1.2      | `10bae3c` | ~2m30s   | `TodoServer` + `TodoHandler` (full routing, all error cases), `TodoRequest` DTO, 19 HTTP integration tests |
| —        | `577e9bc` | (manual) | Harness fix: sentinel must be an exact bare line |
| 2.1      | `ac82e4e` | ~1m30s   | `Main` entry point (`$PORT`/8080), shade-plugin fat jar, `README.md`, sentinel emitted |

Final verification (done outside the loop): `mvn -q test` green (29 tests);
built `target/todo-api.jar`, ran it on port 18080, and curl-verified every
endpoint: 201/200/200/200/204 on the happy path, 404 after delete, 400 for a
blank title, 405 for PATCH.

## Findings

1. **The completion detector is the weakest link.** Run 1 stopped early on a
   false positive: the iteration-2 agent left itself the note *"remember to
   append `ALL_SPEC_ITEMS_COMPLETE` to this file"* in `PROGRESS.md`, and the
   harness's substring `grep` matched the mention as if it were the marker.
   Lesson: a completion sentinel must be structurally unambiguous (exact
   whole-line match via `grep -qxF`, plus a prompt rule to never write the
   token elsewhere) — or better, derive completion purely from verifiable
   state (all checkboxes ticked AND tests green) instead of trusting the
   agent's own claim.

2. **One-focused-item-per-iteration was ignored in the best possible way.**
   The prompt said "pick the single most important unfinished item", but the
   agent bundled aggressively (iteration 2 ticked six checkboxes at once) —
   and it got away with it because tests gated every step. With a strong
   fitness function, batching is a speed win, not a risk.

3. **`PROGRESS.md` memory worked well across sessions.** Each iteration
   started from zero context, yet iteration 2.1 followed iteration 1.2's
   handoff notes precisely (down to "add maven-jar-plugin or shade config").
   The gotchas section prevented rediscovery of environment quirks (e.g. the
   `JAVA_TOOL_OPTIONS` noise on every Maven command).

4. **Harness bug: resumed runs clobber transcripts.** Run 2 restarted
   numbering at `iter-1.log` and truncated run 1's log. Logs should go in a
   per-run directory (`loop/logs/<timestamp>/`).

5. **`claude -p` captures only the final message** (run 1 iter 2's "log" was
   one line), so the transcripts are thin. For real observability use
   `--output-format stream-json --verbose` and keep the JSONL.

## Knobs for follow-up experiments

- Per-run log directories + `stream-json` transcripts (fixes findings 4–5).
- Completion check based only on `SPEC.md` checkboxes + green tests, dropping
  the self-reported sentinel entirely.
- Compare batching vs. strict one-item iterations (`--max-turns` as a forcing
  function).
- Swap `SPEC.md`/`PROMPT.md` to re-target the harness at any other task — the
  loop itself is workload-agnostic.
