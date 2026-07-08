package life.cli;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GameOfLifeAppTest {

    private ByteArrayOutputStream outBytes;
    private ByteArrayOutputStream errBytes;
    private GameOfLifeApp app;

    @BeforeEach
    void setUp() {
        outBytes = new ByteArrayOutputStream();
        errBytes = new ByteArrayOutputStream();
        app = new GameOfLifeApp(
                new PrintStream(outBytes, true, StandardCharsets.UTF_8),
                new PrintStream(errBytes, true, StandardCharsets.UTF_8));
    }

    private String stdout() {
        return outBytes.toString(StandardCharsets.UTF_8);
    }

    private String stderr() {
        return errBytes.toString(StandardCharsets.UTF_8);
    }

    @Test
    void runGliderZeroPrintsInitialPlacement() {
        int code = app.execute(new String[] {"run", "glider", "0"});
        assertEquals(0, code);
        assertEquals("", stderr());
        String expected =
                "....................\n"
                + "....................\n"
                + "...#................\n"
                + "....#...............\n"
                + "..###...............\n"
                + ("....................\n").repeat(15);
        assertEquals(expected, stdout());
    }

    @Test
    void runBlinkerOnePrintsVerticalBlinker() {
        int code = app.execute(new String[] {"run", "blinker", "1"});
        assertEquals(0, code);
        String[] lines = stdout().split("\n");
        assertEquals("...#................", lines[1]);
        assertEquals("...#................", lines[2]);
        assertEquals("...#................", lines[3]);
        assertEquals("....................", lines[0]);
        assertEquals("....................", lines[4]);
    }

    @Test
    void runGlider80MatchesRunGlider0() {
        app.execute(new String[] {"run", "glider", "80"});
        String after80 = stdout();

        setUp();
        app.execute(new String[] {"run", "glider", "0"});
        assertEquals(stdout(), after80);
    }

    @Test
    void unknownPatternFailsWithUsageOnStderr() {
        int code = app.execute(new String[] {"run", "nope", "5"});
        assertEquals(1, code);
        assertEquals("", stdout());
        assertTrue(stderr().contains("unknown pattern"));
        assertTrue(stderr().contains("usage:"));
    }

    @Test
    void malformedGenerationsFails() {
        assertEquals(1, app.execute(new String[] {"run", "glider", "abc"}));
        assertEquals(1, app.execute(new String[] {"run", "glider", "-3"}));
        assertEquals("", stdout());
    }

    @Test
    void unknownCommandAndMissingArgsFail() {
        assertEquals(1, app.execute(new String[] {}));
        assertEquals(1, app.execute(new String[] {"dance"}));
        assertEquals(1, app.execute(new String[] {"run", "glider"}));
        assertEquals(1, app.execute(new String[] {"watch"}));
        assertEquals(1, app.execute(new String[] {"watch", "nope"}));
        assertEquals("", stdout());
    }
}
