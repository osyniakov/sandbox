package com.example.todo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Optional;

/**
 * Handles every request under the {@code /todos} context: the collection
 * endpoint ({@code /todos}) and the item endpoint ({@code /todos/{id}}).
 */
class TodoHandler implements HttpHandler {
    private final TodoStore store;
    private final ObjectMapper mapper;

    TodoHandler(TodoStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            String remainder = path.length() > "/todos".length()
                    ? path.substring("/todos".length())
                    : "";
            if (remainder.startsWith("/")) {
                remainder = remainder.substring(1);
            }

            if (remainder.isEmpty()) {
                handleCollection(exchange);
            } else if (!remainder.contains("/")) {
                handleItem(exchange, remainder);
            } else {
                sendEmpty(exchange, 404);
            }
        } finally {
            exchange.close();
        }
    }

    private void handleCollection(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        switch (method) {
            case "GET" -> sendJson(exchange, 200, store.list());
            case "POST" -> handleCreate(exchange);
            default -> sendEmpty(exchange, 405);
        }
    }

    private void handleItem(HttpExchange exchange, String id) throws IOException {
        String method = exchange.getRequestMethod();
        switch (method) {
            case "GET" -> {
                Optional<Todo> todo = store.get(id);
                if (todo.isPresent()) {
                    sendJson(exchange, 200, todo.get());
                } else {
                    sendEmpty(exchange, 404);
                }
            }
            case "PUT" -> handleUpdate(exchange, id);
            case "DELETE" -> {
                if (store.delete(id)) {
                    sendEmpty(exchange, 204);
                } else {
                    sendEmpty(exchange, 404);
                }
            }
            default -> sendEmpty(exchange, 405);
        }
    }

    private void handleCreate(HttpExchange exchange) throws IOException {
        TodoRequest request;
        try {
            request = mapper.readValue(exchange.getRequestBody(), TodoRequest.class);
        } catch (IOException e) {
            sendEmpty(exchange, 400);
            return;
        }

        if (request.getTitle() == null || request.getTitle().isBlank()) {
            sendEmpty(exchange, 400);
            return;
        }

        boolean completed = request.getCompleted() != null && request.getCompleted();
        Todo created = store.create(request.getTitle(), completed);
        sendJson(exchange, 201, created);
    }

    private void handleUpdate(HttpExchange exchange, String id) throws IOException {
        TodoRequest request;
        try {
            request = mapper.readValue(exchange.getRequestBody(), TodoRequest.class);
        } catch (IOException e) {
            sendEmpty(exchange, 400);
            return;
        }

        if (request.getTitle() == null || request.getTitle().isBlank()) {
            sendEmpty(exchange, 400);
            return;
        }

        boolean completed = request.getCompleted() != null && request.getCompleted();
        Optional<Todo> updated = store.update(id, request.getTitle(), completed);
        if (updated.isPresent()) {
            sendJson(exchange, 200, updated.get());
        } else {
            sendEmpty(exchange, 404);
        }
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = mapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private void sendEmpty(HttpExchange exchange, int status) throws IOException {
        exchange.sendResponseHeaders(status, -1);
    }
}
