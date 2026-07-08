package life;

/** A parsed CLI invocation. */
public sealed interface Command {

    record Run(Pattern pattern, int generations) implements Command {}

    record Watch(Pattern pattern) implements Command {}

    /** Thrown when the arguments don't form a valid command. */
    final class UsageException extends RuntimeException {
        public UsageException(String message) {
            super(message);
        }
    }

    static Command parse(String[] args) {
        return switch (args) {
            case String[] a when a.length == 3 && a[0].equals("run") ->
                    new Run(patternOf(a[1]), generationsOf(a[2]));
            case String[] a when a.length == 2 && a[0].equals("watch") ->
                    new Watch(patternOf(a[1]));
            default -> throw new UsageException("malformed arguments");
        };
    }

    private static Pattern patternOf(String name) {
        return Pattern.fromCliName(name)
                .orElseThrow(() -> new UsageException("unknown pattern: " + name));
    }

    private static int generationsOf(String text) {
        try {
            int generations = Integer.parseInt(text);
            if (generations < 0) {
                throw new UsageException("generations must be >= 0, got: " + text);
            }
            return generations;
        } catch (NumberFormatException e) {
            throw new UsageException("generations must be an integer, got: " + text);
        }
    }
}
