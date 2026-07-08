# Comparison: three agents, one spec, three Javas

Three subagents were launched **in parallel**, each given the same [SPEC.md](SPEC.md)
(Game of Life CLI on a 20x20 torus) plus a different design brief and its own
directory. None of them saw the others' work. The orchestrator then built all three
independently and diffed their `run` output byte-for-byte.

## The numbers

| | A: minimalist | B: classic OO | C: modern Java 21 |
|---|---|---|---|
| Build tool | none (`javac`) | Maven | Gradle |
| Main-source LOC | **66** | 362 | 258 |
| Main-source files | 1 | 8 | 5 |
| Test LOC / test count | 0 / 0 | 429 / 45 | 242 / 26 |
| Agent wall-clock | ~2.1 min | ~5.0 min | ~4.2 min |
| Agent tokens | ~29k | ~45k | ~41k |
| Core data structure | `boolean[20][20]` | `Grid` class (mutable-ish, encapsulated) | `Grid` record over `Set<Cell>` (immutable) |

## Cross-variant correctness check

All three variants produce **byte-identical stdout** for:
`run glider 0`, `run glider 40`, `run glider 80`, `run blinker 1`,
`run r-pentomino 100` — and `run glider 80` equals `run glider 0`
(the glider wraps the 20x20 torus in exactly 80 generations), confirming the torus
wrapping independently in all three implementations.

r-pentomino-100 sha256: `5a338f80b5835b30…` — same from all three.

## Design notes

- **A (66 LOC)** is a `main` plus three static helpers over a plain 2D boolean array;
  wrapping is an inline `(i + d + 20) % 20`. All error handling funnels through one
  catch block. Nothing to configure, nothing to download; compiles in a second.
- **B (362 LOC)** decomposes by responsibility: `Grid` knows space but not Life,
  `Rules` is an interface with `ConwayRules` implementing B3/S23, `Simulation` steps
  time, `Renderer` formats, and the CLI takes injected `PrintStream`s and returns exit
  codes instead of calling `System.exit` — which is why it could unit-test the full
  end-to-end contract in-process (45 tests, the most thorough suite).
- **C (258 LOC)** makes the core purely functional: `Grid.next()` is a pure
  `Grid -> Grid` using a switch expression for B3/S23, torus wrapping is centralized in
  `Cell`'s compact constructor via `Math.floorMod`, patterns are an enum of text
  blocks, and the CLI parses into a sealed `Command` interface consumed with record
  pattern matching. All I/O lives in a thin `Main`.

Same spec, genuinely different shapes: the sparse-set-of-live-cells representation (C)
vs dense array (A, B) is the most interesting split — it changes how you even phrase
neighbor counting.

## Retrospective on the parallel-agent workflow

- **Parallelism worked cleanly.** Directory-per-agent meant zero conflicts; total
  wall-clock was ~5 min (the slowest agent) instead of ~11 min sequential.
- **The spec earned its keep.** Pinning the exact placement (top-left at row 2, col 2),
  wrapping semantics, and output format was what made byte-identical output achievable
  from three independent implementations on the first try. Every ambiguity you leave in
  a spec becomes a divergence across parallel workers.
- **One integration surprise, zero logic bugs.** All three implementations agreed on
  every case immediately. The only hitch was operational: variant C's agent verified
  via `gradle run`/the installDist script, while the orchestrator's harness assumed
  `java -jar` — the jar had no `Main-Class` manifest attribute, so the first cross-diff
  showed C as "failing" (empty stdout). The variant was spec-compliant; the harness
  assumption wasn't in the spec. Fix: 3 lines in `build.gradle`. Lesson: if the
  orchestrator intends to run all outputs uniformly, the *invocation contract* belongs
  in the spec too, not just the I/O contract.
- **Self-verification claims held up.** Each agent reported passing the spec's
  verification cases, and independent re-runs by the orchestrator confirmed all of
  them. The one thing agents couldn't check themselves — cross-variant agreement on
  r-pentomino (no closed-form answer) — is exactly what the orchestrator's diff added.

## Reproducing the cross-check

```sh
cd variant-a-minimal && javac GameOfLife.java && cd ..
cd variant-b-classic && mvn -q clean package && cd ..
cd variant-c-modern && gradle build -q && cd ..

for args in "glider 0" "glider 80" "r-pentomino 100"; do
  java -cp variant-a-minimal GameOfLife run $args > /tmp/a.txt
  java -jar variant-b-classic/target/game-of-life.jar run $args > /tmp/b.txt
  java -jar variant-c-modern/build/libs/life-modern.jar run $args > /tmp/c.txt
  diff /tmp/a.txt /tmp/b.txt && diff /tmp/a.txt /tmp/c.txt && echo "OK: run $args"
done
```
