package life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GridTest {

    @Test
    void newGridIsAllDead() {
        Grid grid = new Grid(20, 20);
        for (int r = 0; r < 20; r++) {
            for (int c = 0; c < 20; c++) {
                assertFalse(grid.isAlive(r, c));
            }
        }
    }

    @Test
    void rejectsNonPositiveDimensions() {
        assertThrows(IllegalArgumentException.class, () -> new Grid(0, 20));
        assertThrows(IllegalArgumentException.class, () -> new Grid(20, -1));
    }

    @Test
    void countsNeighborsInGridInterior() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(4, 4, true);
        grid.setAlive(5, 5, true);
        grid.setAlive(6, 6, true);
        assertEquals(2, grid.countLiveNeighbors(5, 5)); // center excludes itself
        assertEquals(1, grid.countLiveNeighbors(4, 4));
        assertEquals(0, grid.countLiveNeighbors(10, 10));
    }

    @Test
    void neighborCountingWrapsHorizontally() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(5, 19, true); // rightmost column
        assertEquals(1, grid.countLiveNeighbors(5, 0)); // leftmost column sees it
        assertEquals(1, grid.countLiveNeighbors(4, 0));
        assertEquals(1, grid.countLiveNeighbors(6, 0));
    }

    @Test
    void neighborCountingWrapsVertically() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(19, 5, true); // bottom row
        assertEquals(1, grid.countLiveNeighbors(0, 5)); // top row sees it
        assertEquals(1, grid.countLiveNeighbors(0, 4));
        assertEquals(1, grid.countLiveNeighbors(0, 6));
    }

    @Test
    void neighborCountingWrapsAtCorner() {
        Grid grid = new Grid(20, 20);
        // The three toroidal neighbors of (0,0) that live "around the corner".
        grid.setAlive(19, 19, true);
        grid.setAlive(19, 0, true);
        grid.setAlive(0, 19, true);
        assertEquals(3, grid.countLiveNeighbors(0, 0));
    }

    @Test
    void accessorsWrapOutOfRangeCoordinates() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(-1, -1, true);
        assertTrue(grid.isAlive(19, 19));
        assertTrue(grid.isAlive(39, 39));
    }
}
