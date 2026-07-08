package life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CommandTest {

    @Test
    void parsesRunCommand() {
        assertEquals(new Command.Run(Pattern.GLIDER, 80),
                Command.parse(new String[] {"run", "glider", "80"}));
    }

    @Test
    void parsesWatchCommand() {
        assertEquals(new Command.Watch(Pattern.R_PENTOMINO),
                Command.parse(new String[] {"watch", "r-pentomino"}));
    }

    @Test
    void rejectsUnknownPattern() {
        assertThrows(Command.UsageException.class,
                () -> Command.parse(new String[] {"run", "toad", "3"}));
    }

    @Test
    void rejectsMalformedArguments() {
        assertThrows(Command.UsageException.class, () -> Command.parse(new String[] {}));
        assertThrows(Command.UsageException.class, () -> Command.parse(new String[] {"run", "glider"}));
        assertThrows(Command.UsageException.class, () -> Command.parse(new String[] {"run", "glider", "x"}));
        assertThrows(Command.UsageException.class, () -> Command.parse(new String[] {"run", "glider", "-1"}));
        assertThrows(Command.UsageException.class, () -> Command.parse(new String[] {"dance", "glider"}));
    }
}
