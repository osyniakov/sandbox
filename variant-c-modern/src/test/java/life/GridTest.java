package life;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GridTest {

    @Nested
    class NeighborCounting {

        @Test
        void countsAdjacentLiveCellsInTheInterior() {
            var grid = Grid.of(new Cell(5, 5), new Cell(5, 6), new Cell(6, 5));
            assertEquals(3, grid.liveNeighbors(new Cell(6, 6)));
            assertEquals(2, grid.liveNeighbors(new Cell(5, 5)));
            assertEquals(0, grid.liveNeighbors(new Cell(15, 15)));
        }

        @Test
        void doesNotCountTheCellItself() {
            var grid = Grid.of(new Cell(5, 5));
            assertEquals(0, grid.liveNeighbors(new Cell(5, 5)));
        }

        @Test
        void wrapsAcrossHorizontalEdges() {
            var grid = Grid.of(new Cell(10, 19));
            assertEquals(1, grid.liveNeighbors(new Cell(10, 0)));
        }

        @Test
        void wrapsAcrossVerticalEdges() {
            var grid = Grid.of(new Cell(19, 10));
            assertEquals(1, grid.liveNeighbors(new Cell(0, 10)));
        }

        @Test
        void wrapsDiagonallyAtTheCorner() {
            var grid = Grid.of(new Cell(19, 19), new Cell(19, 0), new Cell(0, 19));
            assertEquals(3, grid.liveNeighbors(new Cell(0, 0)));
        }

        @Test
        void cellCoordinatesAreCanonicalizedModuloTwenty() {
            assertEquals(new Cell(19, 19), new Cell(-1, -1));
            assertEquals(new Cell(0, 3), new Cell(20, 23));
        }
    }

    @Nested
    class StepRule {

        @Test
        void deadCellWithExactlyThreeNeighborsIsBorn() {
            var grid = Grid.of(new Cell(5, 5), new Cell(5, 6), new Cell(6, 5));
            assertTrue(grid.next().isAlive(new Cell(6, 6)));
        }

        @Test
        void liveCellWithTwoOrThreeNeighborsSurvives() {
            var block = Grid.of(new Cell(5, 5), new Cell(5, 6), new Cell(6, 5), new Cell(6, 6));
            assertEquals(block, block.next(), "a block is a still life");
        }

        @Test
        void liveCellWithFewerThanTwoNeighborsDies() {
            var grid = Grid.of(new Cell(5, 5), new Cell(5, 6));
            assertEquals(Set.of(), grid.next().alive());
        }

        @Test
        void liveCellWithMoreThanThreeNeighborsDies() {
            var grid = Grid.of(new Cell(5, 5), new Cell(4, 4), new Cell(4, 6),
                    new Cell(6, 4), new Cell(6, 6));
            assertFalse(grid.next().isAlive(new Cell(5, 5)));
        }

        @Test
        void deadCellWithTwoNeighborsStaysDead() {
            var grid = Grid.of(new Cell(5, 5), new Cell(5, 7));
            assertFalse(grid.next().isAlive(new Cell(5, 6)));
        }

        @Test
        void blinkerOscillatesWithPeriodTwo() {
            var horizontal = Grid.of(new Cell(2, 2), new Cell(2, 3), new Cell(2, 4));
            var vertical = Grid.of(new Cell(1, 3), new Cell(2, 3), new Cell(3, 3));
            assertEquals(vertical, horizontal.next());
            assertEquals(horizontal, horizontal.next().next());
        }

        @Test
        void gliderReturnsHomeAfterEightyGenerationsOnTheTorus() {
            var initial = Pattern.GLIDER.placedAt(2, 2);
            assertEquals(initial, initial.after(80));
        }
    }
}
