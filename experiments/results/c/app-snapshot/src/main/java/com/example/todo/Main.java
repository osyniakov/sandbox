package com.example.todo;

public class Main {

    public static void main(String[] args) {
        String portEnv = System.getenv("PORT");
        int port = portEnv != null ? Integer.parseInt(portEnv) : 8080;

        TodoServer server = new TodoServer(port);
        server.start();
        System.out.println("Listening on port " + server.getPort());
    }
}
