# Harness comparison: measured results

Three agent-harness topologies built the identical TODO-REST-API spec
(`common/SPEC.md`) from an empty workspace, same model, run back-to-back on the
same machine on 2026-07-11. All three finished, all three passed the identical
independent verification (fresh `mvn -q test` + `common/smoke.sh`: jar boot +
curl of every endpoint class). Raw data: `results/<v>/*.metrics.json`.

## The numbers

| Metric | A — sequential loop | B — single session | C — parallel fan-out |
|---|---|---|---|
| Outcome | done | done | done |
| Wall-clock | 5m 25s | **3m 01s** | 4m 36s |
| Agent sessions | 2 | 1 | 5 |
| Total turns | 43 | **22** | 80 |
| Agent time (sum) | 5.3m | **3.0m** | 7.2m |
| Output tokens | 28.4k | **16.7k** | 33.7k |
| Cache-creation tokens | 49.4k | **31.2k** | 93.9k |
| Cache-read tokens | 1,732k | **961k** | 2,828k |
| Cost (USD) | $1.24 | **$0.73** | $1.92 |
| Tests produced | 28 | 25 | 45 |
| Independent smoke test | pass | pass | pass |

Variant C stage breakdown: foundation 71 s (serial) → fan-out 120 s (3 workers
in parallel; 281 s of summed worker time, i.e. a 2.3× compression inside the
stage) → merge 85 s (serial).

Per-session detail is in `summarize.py` output; per-variant final sources in
`results/<v>/app-snapshot/` for qualitative diffing.

## What the data says

**B (single session) won on every efficiency axis** — 1.7× cheaper and 1.8×
faster than the loop, 2.6× cheaper and 1.5× faster than the fan-out. For a task
that fits comfortably in one context window, continuity is simply free
efficiency: no re-reading the spec, no re-discovering the codebase, one warm
cache all the way through.

**A (loop) paid a measurable cold-start tax.** Iteration 2 spent its opening
turns re-orienting (re-reading SPEC/PROGRESS, re-listing the tree) before
producing anything — that's most of the 43-vs-22 turn gap. What the extra $0.51
bought vs. B: a committed checkpoint mid-run, crash-resumability, and bounded
per-session context. On a 2-iteration task those are nearly worthless; on a
50-iteration task they're the whole game.

**C was the most expensive AND slower than B — Amdahl's law, live.** The
parallel stage genuinely worked (281 s of work in 120 s of wall-clock), but the
serial bookends (foundation 71 s + merge 85 s = 156 s) exceeded the parallel
stage itself. With only ~2 minutes of parallelizable work, the coordination
overhead can't pay for itself. The crossover only comes when the fan-out stage
dominates: this task is simply too small for parallelism to win.

**But C produced the best artifact.** 45 tests vs. 28/25 — because the tests
worker wrote the integration suite *blind against the spec*, with no knowledge
of the implementation, it tested the contract exhaustively rather than
confirming what the implementer happened to build. And the merge was
**conflict-free on all three branches**: the foundation stage pinning package,
class names, and interfaces up front, plus strict "stay in your lane" worker
prompts, worked exactly as intended. The blind-written tests passed against the
independently-written implementation on the first post-merge run.

## Practical conclusions

1. **Default to a single continuous session** for anything that fits one
   context window. It was strictly dominant on efficiency here.
2. **Choose the loop for duration, not efficiency** — when the horizon is long
   enough that context rot, crashes, or unattended operation matter more than
   a ~1.7× token premium.
3. **Choose fan-out for scale or quality, not speed on small tasks.** Its
   wall-clock only wins when parallelizable work dwarfs the serial
   foundation+merge bookends. Its adversarial side-effect — spec-driven tests
   written independently of the implementation — was the single biggest quality
   improvement observed in the whole experiment, and is worth stealing even in
   single-session workflows (write tests from the spec before/independently of
   the implementation).
4. **Interface-first decomposition is what made parallelism safe**: freeze the
   contracts in a serial foundation stage, then let workers go wide.

## Caveats

- **n = 1 per variant.** Model/API variance between runs is real; treat ratios
  as indicative, not precise. (Directionally they match run 0 at the repo root.)
- The task is small (~30 min of total agent work) and decomposes unusually
  cleanly; both properties favor B and understate C's potential.
- All variants used the same model and default settings; no `--max-turns` or
  model-tier experiments yet.
- Cost figures are as reported by the CLI (`total_cost_usd`), dominated by
  cache reads/writes; a different caching regime would shift absolute numbers
  but is unlikely to reorder the variants.
