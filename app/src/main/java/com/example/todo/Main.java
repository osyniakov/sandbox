package com.example.todo;

import java.io.IOException;

/**
 * Entry point: starts {@link TodoServer} on {@code $PORT} (defaults to 8080).
 */
public final class Main {
    private Main() {
    }

    public static void main(String[] args) throws IOException {
        String portEnv = System.getenv("PORT");
        int port = portEnv != null ? Integer.parseInt(portEnv) : 8080;

        TodoServer server = new TodoServer(port);
        server.start();
        System.out.println("todo-api listening on port " + server.getPort());
    }
}
