package com.example.todo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

/**
 * Wraps {@link HttpServer} to expose the actual bound port (useful when
 * starting on port 0) and a clean start/stop lifecycle.
 */
public class TodoServer {
    private final HttpServer httpServer;

    public TodoServer(int port) throws IOException {
        this(port, new TodoStore());
    }

    public TodoServer(int port, TodoStore store) throws IOException {
        this.httpServer = HttpServer.create(new InetSocketAddress(port), 0);
        this.httpServer.setExecutor(Executors.newCachedThreadPool());
        this.httpServer.createContext("/todos", new TodoHandler(store, new ObjectMapper()));
    }

    public int getPort() {
        return httpServer.getAddress().getPort();
    }

    public void start() {
        httpServer.start();
    }

    public void stop() {
        httpServer.stop(0);
    }
}
