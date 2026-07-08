package life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RendererTest {

    private final Renderer renderer = new Renderer();

    @Test
    void emptyGridRendersAsTwentyLinesOfTwentyDots() {
        String output = renderer.render(new Grid(20, 20));
        String expected = ("." .repeat(20) + "\n").repeat(20);
        assertEquals(expected, output);
    }

    @Test
    void everyLineIsExactlyTwentyCharsAndNewlineTerminated() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(0, 0, true);
        grid.setAlive(19, 19, true);
        String output = renderer.render(grid);

        assertTrue(output.endsWith("\n"), "output must end with a newline");
        String[] lines = output.split("\n", -1);
        assertEquals(21, lines.length); // 20 lines + empty tail after final \n
        assertEquals("", lines[20]);
        for (int i = 0; i < 20; i++) {
            assertEquals(20, lines[i].length(), "line " + i);
            assertTrue(lines[i].matches("[#.]{20}"), "line " + i + " has only # and .");
        }
    }

    @Test
    void liveCellsRenderAsHashAtCorrectPositions() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(2, 3, true);
        String output = renderer.render(grid);
        String[] lines = output.split("\n");
        assertEquals('#', lines[2].charAt(3));
        assertEquals("..." + "#" + ".".repeat(16), lines[2]);
        assertEquals(".".repeat(20), lines[0]);
    }

    @Test
    void gliderInitialPlacementRendersExactly() {
        Grid grid = new Grid(20, 20);
        new PatternLibrary().find("glider").orElseThrow().placeOn(grid, 2, 2);
        String[] lines = renderer.render(grid).split("\n");
        assertEquals("...#................", lines[2]);
        assertEquals("....#...............", lines[3]);
        assertEquals("..###...............", lines[4]);
    }
}
