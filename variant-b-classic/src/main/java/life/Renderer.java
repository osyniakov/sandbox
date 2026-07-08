package life;

/**
 * Renders a {@link Grid} to the textual format defined by the spec:
 * one line per row, '#' for a live cell, '.' for a dead cell, each line
 * terminated by '\n'.
 */
public final class Renderer {

    public static final char ALIVE = '#';
    public static final char DEAD = '.';

    /** Renders the whole grid, including a trailing newline on the last row. */
    public String render(Grid grid) {
        StringBuilder sb = new StringBuilder((grid.cols() + 1) * grid.rows());
        for (int row = 0; row < grid.rows(); row++) {
            for (int col = 0; col < grid.cols(); col++) {
                sb.append(grid.isAlive(row, col) ? ALIVE : DEAD);
            }
            sb.append('\n');
        }
        return sb.toString();
    }
}
