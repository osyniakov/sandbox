package com.example.todo;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;

/**
 * Wraps {@link HttpServer} to expose the TODO REST API on a single
 * ephemeral-friendly port. Routes both the {@code /todos} collection and
 * {@code /todos/{id}} item paths through one context handler.
 */
public final class TodoServer {

    private final HttpServer server;
    private final TodoStore store;
    private final ObjectMapper mapper = new ObjectMapper()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public TodoServer(int port, TodoStore store) throws IOException {
        this.store = store;
        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        this.server.createContext("/todos", this::handle);
        this.server.setExecutor(Executors.newCachedThreadPool());
    }

    public int getPort() {
        return server.getAddress().getPort();
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            String remainder = path.equals("/todos") ? "" : path.substring("/todos".length());
            if (remainder.startsWith("/")) {
                remainder = remainder.substring(1);
            }
            if (remainder.isEmpty()) {
                handleCollection(exchange, method);
            } else if (!remainder.contains("/")) {
                handleItem(exchange, method, remainder);
            } else {
                sendJson(exchange, 404, Map.of("error", "not found"));
            }
        } finally {
            exchange.close();
        }
    }

    private void handleCollection(HttpExchange exchange, String method) throws IOException {
        switch (method) {
            case "GET" -> sendJson(exchange, 200, store.list());
            case "POST" -> handlePost(exchange);
            default -> sendJson(exchange, 405, Map.of("error", "method not allowed"));
        }
    }

    private void handleItem(HttpExchange exchange, String method, String id) throws IOException {
        switch (method) {
            case "GET" -> handleGetItem(exchange, id);
            case "PUT" -> handlePut(exchange, id);
            case "DELETE" -> handleDelete(exchange, id);
            default -> sendJson(exchange, 405, Map.of("error", "method not allowed"));
        }
    }

    private void handlePost(HttpExchange exchange) throws IOException {
        TodoRequest req;
        try {
            req = parseRequest(exchange);
        } catch (IOException e) {
            sendJson(exchange, 400, Map.of("error", "malformed JSON"));
            return;
        }
        if (req == null || req.title == null || req.title.isBlank()) {
            sendJson(exchange, 400, Map.of("error", "title is required"));
            return;
        }
        boolean completed = req.completed != null && req.completed;
        Todo todo = store.create(req.title, completed);
        sendJson(exchange, 201, todo);
    }

    private void handleGetItem(HttpExchange exchange, String id) throws IOException {
        Optional<Todo> todo = store.get(id);
        if (todo.isEmpty()) {
            sendJson(exchange, 404, Map.of("error", "not found"));
            return;
        }
        sendJson(exchange, 200, todo.get());
    }

    private void handlePut(HttpExchange exchange, String id) throws IOException {
        TodoRequest req;
        try {
            req = parseRequest(exchange);
        } catch (IOException e) {
            sendJson(exchange, 400, Map.of("error", "malformed JSON"));
            return;
        }
        if (req == null || req.title == null || req.title.isBlank()) {
            sendJson(exchange, 400, Map.of("error", "title is required"));
            return;
        }
        boolean completed = req.completed != null && req.completed;
        Optional<Todo> updated = store.update(id, req.title, completed);
        if (updated.isEmpty()) {
            sendJson(exchange, 404, Map.of("error", "not found"));
            return;
        }
        sendJson(exchange, 200, updated.get());
    }

    private void handleDelete(HttpExchange exchange, String id) throws IOException {
        if (!store.delete(id)) {
            sendJson(exchange, 404, Map.of("error", "not found"));
            return;
        }
        exchange.sendResponseHeaders(204, -1);
    }

    private TodoRequest parseRequest(HttpExchange exchange) throws IOException {
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        if (body.isBlank()) {
            return null;
        }
        return mapper.readValue(body, TodoRequest.class);
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = mapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static final class TodoRequest {
        public String title;
        public Boolean completed;
    }
}
