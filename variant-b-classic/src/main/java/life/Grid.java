package life;

/**
 * A fixed-size toroidal grid of boolean cells.
 *
 * <p>The grid wraps around both edges: the neighbor above row 0 is the last
 * row, the neighbor left of column 0 is the last column, and so on. Row 0 is
 * the top row; column 0 is the leftmost column.</p>
 *
 * <p>This class knows nothing about Game of Life rules; it is purely the
 * spatial data structure.</p>
 */
public final class Grid {

    private final int rows;
    private final int cols;
    private final boolean[][] cells;

    public Grid(int rows, int cols) {
        if (rows <= 0 || cols <= 0) {
            throw new IllegalArgumentException("Grid dimensions must be positive");
        }
        this.rows = rows;
        this.cols = cols;
        this.cells = new boolean[rows][cols];
    }

    public int rows() {
        return rows;
    }

    public int cols() {
        return cols;
    }

    /** Returns whether the cell at the given (possibly out-of-range) coordinates is alive, wrapping toroidally. */
    public boolean isAlive(int row, int col) {
        return cells[wrap(row, rows)][wrap(col, cols)];
    }

    /** Sets the cell at the given coordinates, wrapping toroidally. */
    public void setAlive(int row, int col, boolean alive) {
        cells[wrap(row, rows)][wrap(col, cols)] = alive;
    }

    /** Counts the live cells among the eight toroidal neighbors of (row, col). */
    public int countLiveNeighbors(int row, int col) {
        int count = 0;
        for (int dr = -1; dr <= 1; dr++) {
            for (int dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) {
                    continue;
                }
                if (isAlive(row + dr, col + dc)) {
                    count++;
                }
            }
        }
        return count;
    }

    private static int wrap(int value, int size) {
        return Math.floorMod(value, size);
    }
}
