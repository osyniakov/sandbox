# Game of Life — Variant B (Classic OO)

A Conway's Game of Life CLI on a 20x20 torus, implementing the shared contract in
[`../SPEC.md`](../SPEC.md).

## Build

```sh
mvn package
```

Produces `target/game-of-life.jar` with a `Main-Class` manifest entry.

## Run

```sh
# Print the grid after N generations (byte-exact contract output)
java -jar target/game-of-life.jar run glider 80
java -jar target/game-of-life.jar run blinker 1
java -jar target/game-of-life.jar run r-pentomino 100

# Animate 200 generations at ~100 ms/step
java -jar target/game-of-life.jar watch glider
```

Patterns: `blinker`, `glider`, `r-pentomino`. Bad arguments or an unknown
pattern print usage to stderr and exit 1.

## Test

```sh
mvn test
```

JUnit 5 tests cover toroidal neighbor counting (edges and corners), the B3/S23
rule table, pattern placement at (2,2), the exact rendering format, and the CLI
end-to-end (including the spec's verification cases).

## Design stance

This variant is a classic object-oriented decomposition: each concept in the
domain is its own small class with a single responsibility. `Grid` is a pure
toroidal data structure that knows nothing about Life; `Rules` is an interface
with `ConwayRules` supplying B3/S23, so the update rule is swappable and
testable as a bare function of (state, neighbor count); `Simulation` composes a
grid with rules and owns time-stepping; `Renderer` turns a grid into the
spec's text format; `Pattern`/`PatternLibrary` describe and place seeds; and
`GameOfLifeApp` is a thin CLI adapter that parses arguments, wires the objects
together, and maps outcomes to exit codes. Each seam is dependency-injected
(the app takes its `PrintStream`s), so every layer — including the CLI — is
unit-tested without processes or stdout capture hacks.
