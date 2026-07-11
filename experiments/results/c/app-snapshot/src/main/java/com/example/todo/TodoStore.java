package com.example.todo;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class TodoStore {

    private final ConcurrentHashMap<String, Todo> todos = new ConcurrentHashMap<>();

    public Todo create(String title, boolean completed) {
        String id = UUID.randomUUID().toString();
        Todo todo = new Todo(id, title, completed);
        todos.put(id, todo);
        return todo;
    }

    public Optional<Todo> get(String id) {
        return Optional.ofNullable(todos.get(id));
    }

    public List<Todo> list() {
        return List.copyOf(todos.values());
    }

    public Optional<Todo> update(String id, String title, boolean completed) {
        return Optional.ofNullable(todos.computeIfPresent(id, (key, existing) -> {
            existing.setTitle(title);
            existing.setCompleted(completed);
            return existing;
        }));
    }

    public boolean delete(String id) {
        return todos.remove(id) != null;
    }
}
