package life;

/**
 * Conway's classic B3/S23 rule: a dead cell with exactly 3 live neighbors is
 * born; a live cell with 2 or 3 live neighbors survives; every other cell is
 * dead in the next generation.
 */
public final class ConwayRules implements Rules {

    @Override
    public boolean nextState(boolean alive, int liveNeighbors) {
        if (alive) {
            return liveNeighbors == 2 || liveNeighbors == 3;
        }
        return liveNeighbors == 3;
    }
}
