package life;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The catalog of named seed patterns defined by the spec.
 */
public final class PatternLibrary {

    private final Map<String, Pattern> patterns = new LinkedHashMap<>();

    public PatternLibrary() {
        register(new Pattern("blinker", List.of(
                "###")));
        register(new Pattern("glider", List.of(
                ".#.",
                "..#",
                "###")));
        register(new Pattern("r-pentomino", List.of(
                ".##",
                "##.",
                ".#.")));
    }

    private void register(Pattern pattern) {
        patterns.put(pattern.name(), pattern);
    }

    /** Looks up a pattern by its exact name. */
    public Optional<Pattern> find(String name) {
        return Optional.ofNullable(patterns.get(name));
    }

    /** The names of all known patterns, in registration order. */
    public Set<String> names() {
        return patterns.keySet();
    }
}
