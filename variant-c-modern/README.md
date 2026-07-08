# Game of Life — Variant C (Modern Java 21)

Conway's Game of Life on a fixed 20x20 torus, per the shared spec in `../SPEC.md`.

## Build, test, run

Uses the system Gradle (no wrapper) and a Java 21 toolchain:

```sh
gradle build          # compiles and runs the JUnit 5 tests
gradle test           # tests only
gradle run --args='run glider 80'      # simulate and print the final grid
gradle run --args='watch r-pentomino'  # animate in the terminal
```

For clean stdout (e.g. diffing against other variants), run the classes directly:

```sh
gradle installDist
build/install/life-modern/bin/life-modern run glider 0
```

## Design stance

This variant leans on modern Java 21 to make the core of the simulation a small
set of immutable values and pure functions. A generation is a `Grid` record
wrapping an immutable `Set<Cell>` of live cells; `Grid::next` is a pure function
`Grid -> Grid` that applies B3/S23 via a `switch` expression over the neighbor
count, and torus wrapping lives in one place — the `Cell` record's compact
constructor canonicalizes coordinates with `Math.floorMod`, so equal torus
positions are always `equals`. Patterns are an enum defined as text blocks of
ASCII art, the CLI parses into a sealed `Command` interface consumed with record
pattern matching, and only the thin `Main` shell performs I/O; everything below
it is deterministic and directly unit-testable.
