package life;

/**
 * A cellular-automaton birth/survival rule: decides a cell's next state from
 * its current state and its live-neighbor count.
 */
public interface Rules {

    /** Returns whether a cell is alive in the next generation. */
    boolean nextState(boolean alive, int liveNeighbors);
}
