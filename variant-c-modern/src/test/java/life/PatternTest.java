package life;

import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PatternTest {

    @Test
    void gliderIsPlacedWithBoundingBoxTopLeftAtGivenPosition() {
        var grid = Pattern.GLIDER.placedAt(2, 2);
        assertEquals(Set.of(
                new Cell(2, 3),
                new Cell(3, 4),
                new Cell(4, 2), new Cell(4, 3), new Cell(4, 4)),
                grid.alive());
    }

    @Test
    void blinkerIsThreeCellsInARow() {
        var grid = Pattern.BLINKER.placedAt(2, 2);
        assertEquals(Set.of(new Cell(2, 2), new Cell(2, 3), new Cell(2, 4)), grid.alive());
    }

    @Test
    void rPentominoHasItsFiveCells() {
        var grid = Pattern.R_PENTOMINO.placedAt(2, 2);
        assertEquals(Set.of(
                new Cell(2, 3), new Cell(2, 4),
                new Cell(3, 2), new Cell(3, 3),
                new Cell(4, 3)),
                grid.alive());
    }

    @Test
    void placementOffsetIsApplied() {
        var grid = Pattern.BLINKER.placedAt(10, 15);
        assertEquals(Set.of(new Cell(10, 15), new Cell(10, 16), new Cell(10, 17)), grid.alive());
    }

    @Test
    void cliNamesRoundTrip() {
        assertEquals(Optional.of(Pattern.GLIDER), Pattern.fromCliName("glider"));
        assertEquals(Optional.of(Pattern.BLINKER), Pattern.fromCliName("blinker"));
        assertEquals(Optional.of(Pattern.R_PENTOMINO), Pattern.fromCliName("r-pentomino"));
        assertEquals(Optional.empty(), Pattern.fromCliName("toad"));
    }
}
