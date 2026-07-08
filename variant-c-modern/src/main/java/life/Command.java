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
        return switch (args.length) {
            case 3 when args[0].equals("run") ->
                    new Run(patternOf(args[1]), generationsOf(args[2]));
            case 2 when args[0].equals("watch") ->
                    new Watch(patternOf(args[1]));
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
