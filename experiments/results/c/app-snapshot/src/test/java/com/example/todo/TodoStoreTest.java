package com.example.todo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TodoStoreTest {

    @Test
    void createAssignsIdAndStoresTodo() {
        TodoStore store = new TodoStore();

        Todo created = store.create("Buy milk", false);

        assertTrue(created.getId() != null && !created.getId().isBlank());
        assertEquals("Buy milk", created.getTitle());
        assertFalse(created.isCompleted());
    }

    @Test
    void getReturnsCreatedTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Buy milk", false);

        Optional<Todo> found = store.get(created.getId());

        assertTrue(found.isPresent());
        assertEquals(created.getId(), found.get().getId());
    }

    @Test
    void getReturnsEmptyForUnknownId() {
        TodoStore store = new TodoStore();

        assertTrue(store.get("does-not-exist").isEmpty());
    }

    @Test
    void listReturnsAllCreatedTodos() {
        TodoStore store = new TodoStore();
        store.create("First", false);
        store.create("Second", true);

        List<Todo> all = store.list();

        assertEquals(2, all.size());
    }

    @Test
    void updateModifiesExistingTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Original", false);

        Optional<Todo> updated = store.update(created.getId(), "Updated", true);

        assertTrue(updated.isPresent());
        assertEquals("Updated", updated.get().getTitle());
        assertTrue(updated.get().isCompleted());
        assertEquals("Updated", store.get(created.getId()).get().getTitle());
    }

    @Test
    void updateReturnsEmptyForUnknownId() {
        TodoStore store = new TodoStore();

        assertTrue(store.update("does-not-exist", "Title", false).isEmpty());
    }

    @Test
    void deleteRemovesTodoAndReturnsTrue() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Delete me", false);

        assertTrue(store.delete(created.getId()));
        assertTrue(store.get(created.getId()).isEmpty());
    }

    @Test
    void deleteReturnsFalseForUnknownId() {
        TodoStore store = new TodoStore();

        assertFalse(store.delete("does-not-exist"));
    }

    @Test
    void concurrentCreatesAreAllRetainedWithUniqueIds() throws InterruptedException {
        TodoStore store = new TodoStore();
        int threadCount = 50;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        Set<String> ids = ConcurrentHashMap.newKeySet();

        for (int i = 0; i < threadCount; i++) {
            executor.submit(() -> ids.add(store.create("Task", false).getId()));
        }
        executor.shutdown();
        assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));

        assertEquals(threadCount, ids.size());
        assertEquals(threadCount, store.list().size());
    }
}
