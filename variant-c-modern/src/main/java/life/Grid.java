package life;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/**
 * An immutable generation of the Game of Life on a fixed 20x20 torus,
 * represented as the set of live cells. {@link #next()} is a pure function
 * producing the following generation.
 */
public record Grid(Set<Cell> alive) {

    /** Side length of the square torus. */
    public static final int SIZE = 20;

    public Grid {
        alive = Set.copyOf(alive);
    }

    public static Grid of(Cell... cells) {
        return new Grid(Set.of(cells));
    }

    public boolean isAlive(Cell cell) {
        return alive.contains(cell);
    }

    /** Number of live neighbors of {@code cell}, counting across wrapped edges. */
    public int liveNeighbors(Cell cell) {
        return (int) cell.neighbors().filter(this::isAlive).count();
    }

    /** The next generation under B3/S23. */
    public Grid next() {
        return new Grid(cells()
                .filter(cell -> switch (liveNeighbors(cell)) {
                    case 3 -> true;
                    case 2 -> isAlive(cell);
                    default -> false;
                })
                .collect(Collectors.toUnmodifiableSet()));
    }

    /** This grid advanced by {@code generations} steps. */
    public Grid after(int generations) {
        return java.util.stream.Stream.iterate(this, Grid::next)
                .skip(generations)
                .findFirst()
                .orElseThrow();
    }

    /**
     * Renders the grid as 20 lines of 20 characters, {@code '#'} for alive and
     * {@code '.'} for dead, each line terminated by {@code '\n'}.
     */
    public String render() {
        return IntStream.range(0, SIZE)
                .mapToObj(row -> IntStream.range(0, SIZE)
                        .mapToObj(col -> isAlive(new Cell(row, col)) ? "#" : ".")
                        .collect(Collectors.joining("", "", "\n")))
                .collect(Collectors.joining());
    }

    private static java.util.stream.Stream<Cell> cells() {
        return IntStream.range(0, SIZE).boxed()
                .flatMap(row -> IntStream.range(0, SIZE)
                        .mapToObj(col -> new Cell(row, col)));
    }
}
