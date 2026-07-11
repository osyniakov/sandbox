You are one iteration of an autonomous development loop running in this repository.

The repo root contains:
- `SPEC.md` — what to build, with a checklist of acceptance criteria
- `PROGRESS.md` — memory left for you by previous iterations

Rules for this iteration:

1. Read `SPEC.md` and `PROGRESS.md` before doing anything else.
2. Pick the SINGLE most important unfinished checklist item in `SPEC.md`. You may bundle in tightly-related small items if they naturally belong together, but do NOT attempt the whole spec in one iteration.
3. Implement it inside `app/`, with tests as required by the spec.
4. Run `mvn -q test` from `app/` and make it pass before you finish. Never leave the tree with failing tests.
5. Update the checkboxes in `SPEC.md` for items that are now genuinely complete (implemented AND tested).
6. Rewrite the "Current state", "Next step", and "Gotchas" sections of `PROGRESS.md` for the next iteration, and append one line to its "Iteration log" describing what you did.
7. Do NOT run any git commands (no commit, no push) — the outer loop handles version control.

The loop stops on its own when every `SPEC.md` checkbox is ticked and `mvn -q test` passes; you do not need to signal completion.

Keep the iteration focused and the diff small. Quality over quantity: one solid, tested increment.
