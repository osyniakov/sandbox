package life;

import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/** The starting patterns the CLI knows about, defined as ASCII art. */
public enum Pattern {
    BLINKER("""
            ###
            """),
    GLIDER("""
            .#.
            ..#
            ###
            """),
    R_PENTOMINO("""
            .##
            ##.
            .#.
            """);

    private final String art;

    Pattern(String art) {
        this.art = art;
    }

    /** The CLI name of this pattern, e.g. {@code r-pentomino}. */
    public String cliName() {
        return name().toLowerCase().replace('_', '-');
    }

    public static Optional<Pattern> fromCliName(String name) {
        return java.util.Arrays.stream(values())
                .filter(p -> p.cliName().equals(name))
                .findFirst();
    }

    /**
     * A grid with this pattern placed so its bounding box's top-left cell is
     * at ({@code topRow}, {@code leftCol}).
     */
    public Grid placedAt(int topRow, int leftCol) {
        var lines = art.strip().lines().toList();
        Set<Cell> cells = IntStream.range(0, lines.size()).boxed()
                .flatMap(r -> IntStream.range(0, lines.get(r).length())
                        .filter(c -> lines.get(r).charAt(c) == '#')
                        .mapToObj(c -> new Cell(topRow + r, leftCol + c)))
                .collect(Collectors.toUnmodifiableSet());
        return new Grid(cells);
    }
}
