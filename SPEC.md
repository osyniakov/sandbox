# Game of Life — Shared Spec

Every variant in this repo implements exactly this contract. The `run` command must
produce **byte-identical output across all variants** — it is the cross-variant
correctness check.

## Rules

- Conway's Game of Life, B3/S23: a dead cell with exactly 3 live neighbors becomes
  alive; a live cell with 2 or 3 live neighbors survives; all other cells die/stay dead.
- Grid is a fixed **20 columns x 20 rows torus**: neighbors wrap around both edges.
- Row 0 is the top row, column 0 is the leftmost column.

## CLI contract

The program is invoked with one of:

### `run <pattern> <generations>`

Simulate `<generations>` steps (an integer >= 0) from the pattern's initial placement,
then print the final grid to stdout and exit 0.

Output format: exactly 20 lines of exactly 20 characters, `#` for alive, `.` for dead,
each line terminated by `\n`. Nothing else on stdout.

### `watch <pattern>`

Animate the simulation in the terminal (clear screen between generations, ~100 ms per
step, run 200 generations then exit, or until interrupted). Presentation is
free-form — this mode is NOT diffed across variants.

### Errors

Unknown pattern or malformed arguments: print a usage/error message to **stderr**,
exit 1.

## Patterns

Placed with the bounding box's top-left cell at **row 2, column 2**. `#` = alive:

**blinker**
```
###
```

**glider**
```
.#.
..#
###
```

**r-pentomino**
```
.##
##.
.#.
```

## Verification cases

1. `run glider 0` prints the initial placement: live cells at (row,col)
   (2,3), (3,4), (4,2), (4,3), (4,4); all other cells dead.
2. `run blinker 1` — the blinker at (2,2)..(2,4) becomes vertical: live cells
   exactly (1,3), (2,3), (3,3).
3. `run glider 80` — on a 20x20 torus the glider translates one cell diagonally
   every 4 generations, so after 80 generations it wraps all the way around and the
   output is **identical to `run glider 0`**.
4. `run r-pentomino 100` — no closed-form check; all variants must agree byte-for-byte.
