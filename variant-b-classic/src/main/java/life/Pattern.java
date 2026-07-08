package life;

import java.util.List;

/**
 * An immutable seed pattern described as rows of '#' (alive) and '.' (dead).
 */
public final class Pattern {

    private final String name;
    private final List<String> shape;

    public Pattern(String name, List<String> shape) {
        this.name = name;
        this.shape = List.copyOf(shape);
    }

    public String name() {
        return name;
    }

    /**
     * Stamps this pattern onto the grid with the bounding box's top-left cell
     * at (topRow, leftCol). Only live cells are written; dead cells in the
     * bounding box leave the grid untouched.
     */
    public void placeOn(Grid grid, int topRow, int leftCol) {
        for (int r = 0; r < shape.size(); r++) {
            String line = shape.get(r);
            for (int c = 0; c < line.length(); c++) {
                if (line.charAt(c) == '#') {
                    grid.setAlive(topRow + r, leftCol + c, true);
                }
            }
        }
    }
}
