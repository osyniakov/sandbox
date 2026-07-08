package life;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PatternLibraryTest {

    private final PatternLibrary library = new PatternLibrary();

    private static Set<List<Integer>> liveCells(Grid grid) {
        var cells = new java.util.HashSet<List<Integer>>();
        for (int r = 0; r < grid.rows(); r++) {
            for (int c = 0; c < grid.cols(); c++) {
                if (grid.isAlive(r, c)) {
                    cells.add(List.of(r, c));
                }
            }
        }
        return cells;
    }

    @Test
    void knowsAllSpecPatterns() {
        assertEquals(Set.of("blinker", "glider", "r-pentomino"), Set.copyOf(library.names()));
    }

    @Test
    void unknownPatternIsAbsent() {
        assertTrue(library.find("toad").isEmpty());
    }

    @Test
    void gliderPlacementMatchesSpec() {
        Grid grid = new Grid(20, 20);
        library.find("glider").orElseThrow().placeOn(grid, 2, 2);
        assertEquals(Set.of(
                List.of(2, 3),
                List.of(3, 4),
                List.of(4, 2), List.of(4, 3), List.of(4, 4)),
                liveCells(grid));
    }

    @Test
    void blinkerPlacementMatchesSpec() {
        Grid grid = new Grid(20, 20);
        library.find("blinker").orElseThrow().placeOn(grid, 2, 2);
        assertEquals(Set.of(
                List.of(2, 2), List.of(2, 3), List.of(2, 4)),
                liveCells(grid));
    }

    @Test
    void rPentominoPlacementMatchesSpec() {
        Grid grid = new Grid(20, 20);
        library.find("r-pentomino").orElseThrow().placeOn(grid, 2, 2);
        assertEquals(Set.of(
                List.of(2, 3), List.of(2, 4),
                List.of(3, 2), List.of(3, 3),
                List.of(4, 3)),
                liveCells(grid));
    }

    @Test
    void placementOffsetIsRespected() {
        Grid grid = new Grid(20, 20);
        library.find("blinker").orElseThrow().placeOn(grid, 7, 9);
        assertEquals(Set.of(
                List.of(7, 9), List.of(7, 10), List.of(7, 11)),
                liveCells(grid));
    }
}
