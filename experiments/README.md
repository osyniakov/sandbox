# Harness comparison experiment

Three agent-harness topologies build the **same spec** (`common/SPEC.md`, the
TODO REST API from the run-0 experiment at the repo root) from scratch, and we
measure tokens, cost, wall-clock, and sessions/turns-to-green.

| Variant | Topology | Harness |
|---|---|---|
| A | Sequential Ralph-style loop: fresh session per iteration, `PROGRESS.md` memory, tests+checkboxes as the stop condition | `a-loop/run.sh` |
| B | One continuous headless session does the whole spec | `b-single/run.sh` |
| C | Foundation agent → 3 parallel workers in git worktrees (endpoints / integration tests / main+packaging) → merge agent | `c-parallel/run.sh` |

Design decisions:

- Each variant builds in `workspaces/<v>/` — a standalone, gitignored git repo,
  so variant commits never touch this repo's history.
- Every headless call goes through `common/run-claude.sh`, which captures the
  full `stream-json` transcript and extracts a `*.metrics.json`
  (tokens/cost/turns/duration) from the terminal result event into `results/<v>/`.
- Completion is verified state only — zero unticked `SPEC.md` boxes AND
  `mvn -q test` green — never the agent's own claim (lesson from run 0, see
  `../RESULTS.md`).
- Variants run sequentially so wall-clock numbers aren't polluted by CPU/API
  contention; variant C's internal fan-out is the only intra-variant parallelism.
- `common/smoke.sh <workspace>` gives every finished variant the same
  independent end-to-end check (package jar, boot, curl all endpoint classes).

Re-run everything:

```bash
experiments/a-loop/run.sh && experiments/b-single/run.sh && experiments/c-parallel/run.sh
python3 experiments/summarize.py
```

Findings live in `COMPARISON.md`. Raw data: `results/<v>/*.metrics.json` and
final source snapshots under `results/<v>/app-snapshot/` (committed);
`results/<v>/*.jsonl` full transcripts are kept locally but gitignored (bulky).
