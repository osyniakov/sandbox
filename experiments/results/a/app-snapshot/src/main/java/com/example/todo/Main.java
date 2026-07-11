package com.example.todo;

import java.io.IOException;

public final class Main {

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        TodoServer server = new TodoServer(port, new TodoStore());
        server.start();
        System.out.println("Todo API listening on port " + server.getPort());
    }
}
