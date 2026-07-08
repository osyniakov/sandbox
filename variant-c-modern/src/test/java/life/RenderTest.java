package life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RenderTest {

    @Test
    void emptyGridIsTwentyLinesOfTwentyDots() {
        var rendered = new Grid(java.util.Set.of()).render();
        assertEquals((".".repeat(20) + "\n").repeat(20), rendered);
    }

    @Test
    void everyLineIsTwentyCharactersAndNewlineTerminated() {
        var rendered = Pattern.R_PENTOMINO.placedAt(2, 2).render();
        assertTrue(rendered.endsWith("\n"), "output ends with a newline");
        var lines = rendered.split("\n", -1);
        assertEquals(21, lines.length, "20 lines plus the empty tail after the final newline");
        assertEquals("", lines[20]);
        for (int i = 0; i < 20; i++) {
            assertEquals(20, lines[i].length(), "line " + i);
            assertTrue(lines[i].matches("[#.]{20}"), "line " + i + " uses only # and .");
        }
    }

    @Test
    void initialGliderRendersAtRowTwoColumnTwo() {
        var expected = """
                ....................
                ....................
                ...#................
                ....#...............
                ..###...............
                """ + (".".repeat(20) + "\n").repeat(15);
        assertEquals(expected, Pattern.GLIDER.placedAt(2, 2).render());
    }

    @Test
    void blinkerAfterOneGenerationRendersVertically() {
        var rendered = Pattern.BLINKER.placedAt(2, 2).next().render();
        var lines = rendered.split("\n");
        assertEquals("...#" + ".".repeat(16), lines[1]);
        assertEquals("...#" + ".".repeat(16), lines[2]);
        assertEquals("...#" + ".".repeat(16), lines[3]);
        assertEquals(".".repeat(20), lines[0]);
        assertEquals(".".repeat(20), lines[4]);
    }
}
