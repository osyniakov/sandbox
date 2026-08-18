package com.example.todo;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;

public class TodoServer {

    private final int requestedPort;
    private final TodoStore store = new TodoStore();
    private HttpServer httpServer;

    public TodoServer(int port) {
        this.requestedPort = port;
    }

    public void start() {
        try {
            httpServer = HttpServer.create(new InetSocketAddress(requestedPort), 0);
        } catch (IOException e) {
            throw new RuntimeException("Failed to start TodoServer", e);
        }
        httpServer.createContext("/todos", new TodoHandler(store));
        httpServer.setExecutor(null);
        httpServer.start();
    }

    public void stop() {
        if (httpServer != null) {
            httpServer.stop(0);
        }
    }

    public int getPort() {
        return httpServer.getAddress().getPort();
    }

    public TodoStore getStore() {
        return store;
    }
}
