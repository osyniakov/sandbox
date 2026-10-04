package com.example.todo;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class TodoHandler implements HttpHandler {

    private static final String BASE_PATH = "/todos";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final TodoStore store;

    public TodoHandler(TodoStore store) {
        this.store = store;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();

            if (path.equals(BASE_PATH) || path.equals(BASE_PATH + "/")) {
                handleCollection(exchange, method);
                return;
            }

            String prefix = BASE_PATH + "/";
            if (path.startsWith(prefix)) {
                String id = path.substring(prefix.length());
                if (!id.isEmpty() && !id.contains("/")) {
                    handleItem(exchange, method, id);
                    return;
                }
            }

            sendError(exchange, 404, "Not found");
        } finally {
            exchange.close();
        }
    }

    private void handleCollection(HttpExchange exchange, String method) throws IOException {
        switch (method) {
            case "GET" -> listTodos(exchange);
            case "POST" -> createTodo(exchange);
            default -> sendMethodNotAllowed(exchange, "GET, POST");
        }
    }

    private void handleItem(HttpExchange exchange, String method, String id) throws IOException {
        switch (method) {
            case "GET" -> getTodo(exchange, id);
            case "PUT" -> updateTodo(exchange, id);
            case "DELETE" -> deleteTodo(exchange, id);
            default -> sendMethodNotAllowed(exchange, "GET, PUT, DELETE");
        }
    }

    private void listTodos(HttpExchange exchange) throws IOException {
        List<Todo> todos = store.list();
        sendJson(exchange, 200, todos);
    }

    private void getTodo(HttpExchange exchange, String id) throws IOException {
        Optional<Todo> todo = store.get(id);
        if (todo.isPresent()) {
            sendJson(exchange, 200, todo.get());
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    private void createTodo(HttpExchange exchange) throws IOException {
        TodoRequest request = readRequest(exchange);
        if (request == null) {
            return;
        }
        Todo todo = store.create(request.title, request.completed());
        sendJson(exchange, 201, todo);
    }

    private void updateTodo(HttpExchange exchange, String id) throws IOException {
        TodoRequest request = readRequest(exchange);
        if (request == null) {
            return;
        }
        Optional<Todo> updated = store.update(id, request.title, request.completed());
        if (updated.isPresent()) {
            sendJson(exchange, 200, updated.get());
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    private void deleteTodo(HttpExchange exchange, String id) throws IOException {
        if (store.delete(id)) {
            exchange.sendResponseHeaders(204, -1);
        } else {
            sendError(exchange, 404, "Todo not found");
        }
    }

    /** Parses and validates the request body; on failure sends the 400 response itself and returns null. */
    private TodoRequest readRequest(HttpExchange exchange) throws IOException {
        TodoRequest request;
        try {
            request = MAPPER.readValue(exchange.getRequestBody(), TodoRequest.class);
        } catch (IOException e) {
            sendError(exchange, 400, "Malformed JSON");
            return null;
        }
        if (request == null || request.title == null || request.title.isBlank()) {
            sendError(exchange, 400, "Title is required");
            return null;
        }
        return request;
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = MAPPER.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private void sendError(HttpExchange exchange, int status, String message) throws IOException {
        sendJson(exchange, status, Map.of("error", message));
    }

    private void sendMethodNotAllowed(HttpExchange exchange, String allowedMethods) throws IOException {
        exchange.getResponseHeaders().set("Allow", allowedMethods);
        sendError(exchange, 405, "Method not allowed");
    }

    private static class TodoRequest {
        public String title;
        public Boolean completed;

        boolean completed() {
            return completed != null && completed;
        }
    }
}
