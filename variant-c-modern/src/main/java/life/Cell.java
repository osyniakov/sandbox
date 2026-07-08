package life;

import java.util.stream.IntStream;
import java.util.stream.Stream;

/**
 * A cell position on the 20x20 torus. Coordinates are always stored in
 * canonical (wrapped) form, so any two references to the same torus position
 * are {@code equals}.
 */
public record Cell(int row, int col) {

    public Cell {
        row = Math.floorMod(row, Grid.SIZE);
        col = Math.floorMod(col, Grid.SIZE);
    }

    /** The eight torus neighbors of this cell. */
    public Stream<Cell> neighbors() {
        return IntStream.rangeClosed(-1, 1).boxed()
                .flatMap(dr -> IntStream.rangeClosed(-1, 1)
                        .filter(dc -> dr != 0 || dc != 0)
                        .mapToObj(dc -> new Cell(row + dr, col + dc)));
    }
}
