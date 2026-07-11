package com.example.todo;

public class Main {

    public static void main(String[] args) throws Exception {
        int port = 8080;
        String portEnv = System.getenv("PORT");
        if (portEnv != null && !portEnv.isBlank()) {
            port = Integer.parseInt(portEnv.trim());
        }

        TodoServer server = new TodoServer(new TodoStore(), port);
        server.start();
        System.out.println("Todo API listening on port " + server.getPort());
    }
}
