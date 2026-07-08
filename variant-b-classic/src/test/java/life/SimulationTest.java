package life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimulationTest {

    private static Simulation conwaySimulation(Grid grid) {
        return new Simulation(grid, new ConwayRules());
    }

    @Test
    void blinkerOscillatesHorizontalToVertical() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(2, 2, true);
        grid.setAlive(2, 3, true);
        grid.setAlive(2, 4, true);

        Simulation sim = conwaySimulation(grid);
        sim.step();

        Grid next = sim.grid();
        // Exactly (1,3), (2,3), (3,3) alive.
        for (int r = 0; r < 20; r++) {
            for (int c = 0; c < 20; c++) {
                boolean expected = c == 3 && (r == 1 || r == 2 || r == 3);
                assertEquals(expected, next.isAlive(r, c), "cell (" + r + "," + c + ")");
            }
        }
    }

    @Test
    void blockIsAStillLife() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(5, 5, true);
        grid.setAlive(5, 6, true);
        grid.setAlive(6, 5, true);
        grid.setAlive(6, 6, true);

        Simulation sim = conwaySimulation(grid);
        sim.run(10);

        assertTrue(sim.grid().isAlive(5, 5));
        assertTrue(sim.grid().isAlive(5, 6));
        assertTrue(sim.grid().isAlive(6, 5));
        assertTrue(sim.grid().isAlive(6, 6));
        assertFalse(sim.grid().isAlive(4, 4));
    }

    @Test
    void lonelyCellDies() {
        Grid grid = new Grid(20, 20);
        grid.setAlive(10, 10, true);

        Simulation sim = conwaySimulation(grid);
        sim.step();

        assertFalse(sim.grid().isAlive(10, 10));
    }

    @Test
    void gliderReturnsToStartAfter80GenerationsOnTorus() {
        Renderer renderer = new Renderer();
        Grid grid = new Grid(20, 20);
        new PatternLibrary().find("glider").orElseThrow().placeOn(grid, 2, 2);
        String initial = renderer.render(grid);

        Simulation sim = conwaySimulation(grid);
        sim.run(80);

        assertEquals(initial, renderer.render(sim.grid()));
    }

    @Test
    void runZeroGenerationsLeavesGridUnchanged() {
        Renderer renderer = new Renderer();
        Grid grid = new Grid(20, 20);
        new PatternLibrary().find("r-pentomino").orElseThrow().placeOn(grid, 2, 2);
        String initial = renderer.render(grid);

        Simulation sim = conwaySimulation(grid);
        sim.run(0);

        assertEquals(initial, renderer.render(sim.grid()));
    }
}
