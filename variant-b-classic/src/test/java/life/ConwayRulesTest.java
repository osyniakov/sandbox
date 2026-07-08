package life;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConwayRulesTest {

    private final Rules rules = new ConwayRules();

    @Test
    void liveCellWithTwoOrThreeNeighborsSurvives() {
        assertTrue(rules.nextState(true, 2));
        assertTrue(rules.nextState(true, 3));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 4, 5, 6, 7, 8})
    void liveCellWithOtherNeighborCountsDies(int neighbors) {
        assertFalse(rules.nextState(true, neighbors));
    }

    @Test
    void deadCellWithExactlyThreeNeighborsIsBorn() {
        assertTrue(rules.nextState(false, 3));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2, 4, 5, 6, 7, 8})
    void deadCellWithOtherNeighborCountsStaysDead(int neighbors) {
        assertFalse(rules.nextState(false, neighbors));
    }
}
