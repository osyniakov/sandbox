/** Conway's Game of Life on a 20x20 torus. See SPEC.md. */
public class GameOfLife {
    static final int N = 20;

    public static void main(String[] args) throws Exception {
        try {
            if (args.length == 3 && args[0].equals("run")) {
                boolean[][] g = initial(args[1]);
                int gens = Integer.parseInt(args[2]);
                if (gens < 0) throw new IllegalArgumentException("generations must be >= 0");
                for (int i = 0; i < gens; i++) g = step(g);
                System.out.print(render(g));
            } else if (args.length == 2 && args[0].equals("watch")) {
                boolean[][] g = initial(args[1]);
                for (int i = 0; i <= 200; i++) {
                    System.out.print("\u001b[H\u001b[2J" + render(g) + "generation " + i + "\n");
                    Thread.sleep(100);
                    g = step(g);
                }
            } else {
                throw new IllegalArgumentException("bad arguments");
            }
        } catch (IllegalArgumentException e) {
            System.err.println("error: " + e.getMessage());
            System.err.println("usage: GameOfLife run <pattern> <generations> | watch <pattern>");
            System.err.println("patterns: blinker, glider, r-pentomino");
            System.exit(1);
        }
    }

    static boolean[][] initial(String name) {
        String[] rows = switch (name) {
            case "blinker" -> new String[] {"###"};
            case "glider" -> new String[] {".#.", "..#", "###"};
            case "r-pentomino" -> new String[] {".##", "##.", ".#."};
            default -> throw new IllegalArgumentException("unknown pattern: " + name);
        };
        boolean[][] g = new boolean[N][N];
        for (int r = 0; r < rows.length; r++)
            for (int c = 0; c < rows[r].length(); c++)
                g[2 + r][2 + c] = rows[r].charAt(c) == '#';
        return g;
    }

    static boolean[][] step(boolean[][] g) {
        boolean[][] next = new boolean[N][N];
        for (int r = 0; r < N; r++)
            for (int c = 0; c < N; c++) {
                int n = 0;
                for (int dr = -1; dr <= 1; dr++)
                    for (int dc = -1; dc <= 1; dc++)
                        if ((dr != 0 || dc != 0) && g[(r + dr + N) % N][(c + dc + N) % N]) n++;
                next[r][c] = n == 3 || (n == 2 && g[r][c]);
            }
        return next;
    }

    static String render(boolean[][] g) {
        StringBuilder sb = new StringBuilder();
        for (boolean[] row : g) {
            for (boolean alive : row) sb.append(alive ? '#' : '.');
            sb.append('\n');
        }
        return sb.toString();
    }
}
