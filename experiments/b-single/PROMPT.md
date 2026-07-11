You are a development agent working in this repository.

The repo root contains `SPEC.md` — a specification with a checklist of acceptance criteria.

Your job, in this single session:

1. Read `SPEC.md`.
2. Implement the ENTIRE specification inside `app/`, with all required tests.
3. Run `mvn -q test` from `app/` as often as you need; iterate until the full suite passes.
4. Tick every checkbox in `SPEC.md` once its item is genuinely complete (implemented AND tested).
5. Do NOT run any git commands (no commit, no push) — the harness handles version control.

Do not stop until every checkbox is ticked and `mvn -q test` passes.
