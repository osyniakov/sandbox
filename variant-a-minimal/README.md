# Variant A — Minimalist

Conway's Game of Life on a 20x20 torus, per the shared `SPEC.md`.

## Compile and run

```sh
javac GameOfLife.java
java GameOfLife run glider 80      # print the grid after 80 generations
java GameOfLife watch glider       # animate ~100 ms/step for 200 generations
```

Patterns: `blinker`, `glider`, `r-pentomino`.

## Design stance

One source file, zero dependencies, no build tool. The grid is a plain
`boolean[20][20]`; a generation is one pure function (`step`) that counts the
eight torus-wrapped neighbors with modular arithmetic and applies B3/S23.
Patterns are string literals in a `switch`, rendering is a `StringBuilder`
loop, and argument errors funnel through `IllegalArgumentException` into a
single usage-message handler. No classes beyond the entry point, no
interfaces, no configuration — just the smallest readable expression of the
spec.
