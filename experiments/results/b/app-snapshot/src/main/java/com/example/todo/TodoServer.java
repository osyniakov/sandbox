package com.example.todo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;

public class TodoServer {

    private final TodoStore store;
    private final int requestedPort;
    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer httpServer;

    public TodoServer(TodoStore store, int port) {
        this.store = store;
        this.requestedPort = port;
    }

    public void start() throws IOException {
        httpServer = HttpServer.create(new InetSocketAddress(requestedPort), 0);
        httpServer.createContext("/todos", new TodosHandler());
        httpServer.setExecutor(Executors.newCachedThreadPool());
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

    private class TodosHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            try {
                String path = exchange.getRequestURI().getPath();
                String method = exchange.getRequestMethod();

                if (path.equals("/todos") || path.equals("/todos/")) {
                    handleCollection(exchange, method);
                    return;
                }

                String prefix = "/todos/";
                if (path.startsWith(prefix)) {
                    String rest = path.substring(prefix.length());
                    if (!rest.isEmpty() && !rest.contains("/")) {
                        handleItem(exchange, method, rest);
                        return;
                    }
                }

                sendError(exchange, 404, "Not found");
            } finally {
                exchange.close();
            }
        }
    }

    private void handleCollection(HttpExchange exchange, String method) throws IOException {
        switch (method) {
            case "GET" -> sendJson(exchange, 200, store.list());
            case "POST" -> handleCreate(exchange);
            default -> sendError(exchange, 405, "Method not allowed");
        }
    }

    private void handleItem(HttpExchange exchange, String method, String id) throws IOException {
        switch (method) {
            case "GET" -> handleGet(exchange, id);
            case "PUT" -> handleUpdate(exchange, id);
            case "DELETE" -> handleDelete(exchange, id);
            default -> sendError(exchange, 405, "Method not allowed");
        }
    }

    private void handleCreate(HttpExchange exchange) throws IOException {
        TodoRequest request;
        try {
            request = readBody(exchange);
        } catch (IOException e) {
            sendError(exchange, 400, "Malformed JSON");
            return;
        }

        if (request == null || request.getTitle() == null || request.getTitle().isBlank()) {
            sendError(exchange, 400, "Title is required");
            return;
        }

        boolean completed = request.getCompleted() != null && request.getCompleted();
        Todo created = store.create(request.getTitle(), completed);
        sendJson(exchange, 201, created);
    }

    private void handleGet(HttpExchange exchange, String id) throws IOException {
        Optional<Todo> todo = store.get(id);
        if (todo.isPresent()) {
            sendJson(exchange, 200, todo.get());
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    private void handleUpdate(HttpExchange exchange, String id) throws IOException {
        TodoRequest request;
        try {
            request = readBody(exchange);
        } catch (IOException e) {
            sendError(exchange, 400, "Malformed JSON");
            return;
        }

        if (request == null || request.getTitle() == null || request.getTitle().isBlank()) {
            sendError(exchange, 400, "Title is required");
            return;
        }

        boolean completed = request.getCompleted() != null && request.getCompleted();
        Optional<Todo> updated = store.update(id, request.getTitle(), completed);
        if (updated.isPresent()) {
            sendJson(exchange, 200, store.get(id).orElseThrow());
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    private void handleDelete(HttpExchange exchange, String id) throws IOException {
        boolean deleted = store.delete(id);
        if (deleted) {
            exchange.sendResponseHeaders(204, -1);
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    private TodoRequest readBody(HttpExchange exchange) throws IOException {
        try (InputStream in = exchange.getRequestBody()) {
            byte[] bytes = in.readAllBytes();
            if (bytes.length == 0) {
                return null;
            }
            return mapper.readValue(bytes, TodoRequest.class);
        }
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = mapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private void sendError(HttpExchange exchange, int status, String message) throws IOException {
        sendJson(exchange, status, Map.of("error", message));
    }
}
