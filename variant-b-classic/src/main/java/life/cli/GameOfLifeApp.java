package life.cli;

import java.io.PrintStream;

import life.ConwayRules;
import life.Grid;
import life.Pattern;
import life.PatternLibrary;
import life.Renderer;
import life.Simulation;

/**
 * Command-line entry point.
 *
 * <pre>
 *   run &lt;pattern&gt; &lt;generations&gt;   print the final grid after N steps
 *   watch &lt;pattern&gt;               animate 200 generations at ~100 ms/step
 * </pre>
 */
public final class GameOfLifeApp {

    public static final int GRID_ROWS = 20;
    public static final int GRID_COLS = 20;
    public static final int PLACEMENT_ROW = 2;
    public static final int PLACEMENT_COL = 2;

    private static final int WATCH_GENERATIONS = 200;
    private static final long WATCH_FRAME_MILLIS = 100;
    private static final String CLEAR_SCREEN = "\u001b[H\u001b[2J";

    private final PatternLibrary library = new PatternLibrary();
    private final Renderer renderer = new Renderer();
    private final PrintStream out;
    private final PrintStream err;

    public GameOfLifeApp(PrintStream out, PrintStream err) {
        this.out = out;
        this.err = err;
    }

    public static void main(String[] args) {
        int exitCode = new GameOfLifeApp(System.out, System.err).execute(args);
        System.exit(exitCode);
    }

    /** Runs the requested command and returns the process exit code. */
    public int execute(String[] args) {
        if (args.length == 0) {
            return usageError("missing command");
        }
        return switch (args[0]) {
            case "run" -> runCommand(args);
            case "watch" -> watchCommand(args);
            default -> usageError("unknown command: " + args[0]);
        };
    }

    private int runCommand(String[] args) {
        if (args.length != 3) {
            return usageError("run expects exactly 2 arguments: <pattern> <generations>");
        }
        Pattern pattern = library.find(args[1]).orElse(null);
        if (pattern == null) {
            return usageError("unknown pattern: " + args[1]);
        }
        int generations;
        try {
            generations = Integer.parseInt(args[2]);
        } catch (NumberFormatException e) {
            return usageError("generations must be an integer: " + args[2]);
        }
        if (generations < 0) {
            return usageError("generations must be >= 0: " + args[2]);
        }

        Simulation simulation = newSimulation(pattern);
        simulation.run(generations);
        out.print(renderer.render(simulation.grid()));
        return 0;
    }

    private int watchCommand(String[] args) {
        if (args.length != 2) {
            return usageError("watch expects exactly 1 argument: <pattern>");
        }
        Pattern pattern = library.find(args[1]).orElse(null);
        if (pattern == null) {
            return usageError("unknown pattern: " + args[1]);
        }

        Simulation simulation = newSimulation(pattern);
        for (int generation = 0; generation <= WATCH_GENERATIONS; generation++) {
            out.print(CLEAR_SCREEN);
            out.printf("Game of Life — %s — generation %d/%d%n",
                    pattern.name(), generation, WATCH_GENERATIONS);
            out.print(renderer.render(simulation.grid()));
            out.flush();
            if (generation == WATCH_GENERATIONS) {
                break;
            }
            try {
                Thread.sleep(WATCH_FRAME_MILLIS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            simulation.step();
        }
        return 0;
    }

    private Simulation newSimulation(Pattern pattern) {
        Grid grid = new Grid(GRID_ROWS, GRID_COLS);
        pattern.placeOn(grid, PLACEMENT_ROW, PLACEMENT_COL);
        return new Simulation(grid, new ConwayRules());
    }

    private int usageError(String message) {
        err.println("error: " + message);
        err.println("usage: game-of-life run <pattern> <generations>");
        err.println("       game-of-life watch <pattern>");
        err.println("patterns: " + String.join(", ", library.names()));
        return 1;
    }
}
