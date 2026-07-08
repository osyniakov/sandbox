package life;

import java.util.stream.Collectors;

/** Entry point: Conway's Game of Life on a 20x20 torus. */
public final class Main {

    /** Top-left placement of every pattern's bounding box, per the spec. */
    private static final int PLACE_ROW = 2;
    private static final int PLACE_COL = 2;

    private static final int WATCH_GENERATIONS = 200;
    private static final long WATCH_DELAY_MILLIS = 100;
    private static final String CLEAR_SCREEN = "\u001B[H\u001B[2J";

    public static void main(String[] args) {
        try {
            execute(Command.parse(args));
        } catch (Command.UsageException e) {
            System.err.println("error: " + e.getMessage());
            System.err.println(usage());
            System.exit(1);
        }
    }

    private static void execute(Command command) {
        switch (command) {
            case Command.Run(Pattern pattern, int generations) ->
                    System.out.print(initialGrid(pattern).after(generations).render());
            case Command.Watch(Pattern pattern) -> watch(initialGrid(pattern));
        }
    }

    private static Grid initialGrid(Pattern pattern) {
        return pattern.placedAt(PLACE_ROW, PLACE_COL);
    }

    private static void watch(Grid initial) {
        var grid = initial;
        for (int generation = 0; generation <= WATCH_GENERATIONS; generation++) {
            System.out.print(CLEAR_SCREEN);
            System.out.printf("generation %d%n%s", generation, grid.render());
            System.out.flush();
            try {
                Thread.sleep(WATCH_DELAY_MILLIS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            grid = grid.next();
        }
    }

    private static String usage() {
        var patterns = java.util.Arrays.stream(Pattern.values())
                .map(Pattern::cliName)
                .collect(Collectors.joining("|"));
        return """
                usage:
                  life run <pattern> <generations>
                  life watch <pattern>
                patterns: %s""".formatted(patterns);
    }

    private Main() {}
}
