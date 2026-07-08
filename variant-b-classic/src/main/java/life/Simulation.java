package life;

/**
 * Drives a {@link Grid} forward in time by applying a {@link Rules}
 * implementation to every cell simultaneously.
 */
public final class Simulation {

    private final Rules rules;
    private Grid grid;

    public Simulation(Grid initialGrid, Rules rules) {
        this.grid = initialGrid;
        this.rules = rules;
    }

    /** The current generation's grid. */
    public Grid grid() {
        return grid;
    }

    /** Advances the simulation by one generation. */
    public void step() {
        Grid next = new Grid(grid.rows(), grid.cols());
        for (int row = 0; row < grid.rows(); row++) {
            for (int col = 0; col < grid.cols(); col++) {
                boolean alive = grid.isAlive(row, col);
                int neighbors = grid.countLiveNeighbors(row, col);
                next.setAlive(row, col, rules.nextState(alive, neighbors));
            }
        }
        grid = next;
    }

    /** Advances the simulation by {@code generations} steps. */
    public void run(int generations) {
        for (int i = 0; i < generations; i++) {
            step();
        }
    }
}
