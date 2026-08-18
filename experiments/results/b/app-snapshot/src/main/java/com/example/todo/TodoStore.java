package com.example.todo;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class TodoStore {

    private final Map<String, Todo> todos = new ConcurrentHashMap<>();

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
        return new ArrayList<>(todos.values());
    }

    public Optional<Todo> update(String id, String title, boolean completed) {
        Todo updated = new Todo(id, title, completed);
        Todo previous = todos.computeIfPresent(id, (key, existing) -> updated);
        return Optional.ofNullable(previous);
    }

    public boolean delete(String id) {
        return todos.remove(id) != null;
    }
}
