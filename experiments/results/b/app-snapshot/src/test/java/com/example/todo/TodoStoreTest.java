package com.example.todo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TodoStoreTest {

    @Test
    void createGeneratesIdAndStoresTodo() {
        TodoStore store = new TodoStore();

        Todo created = store.create("Buy milk", false);

        assertNotNull(created.getId());
        assertEquals("Buy milk", created.getTitle());
        assertFalse(created.isCompleted());
        assertTrue(store.get(created.getId()).isPresent());
    }

    @Test
    void getReturnsEmptyForUnknownId() {
        TodoStore store = new TodoStore();

        Optional<Todo> result = store.get("does-not-exist");

        assertTrue(result.isEmpty());
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
    void listReturnsEmptyWhenNoTodos() {
        TodoStore store = new TodoStore();

        assertTrue(store.list().isEmpty());
    }

    @Test
    void updateChangesExistingTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Original", false);

        Optional<Todo> updated = store.update(created.getId(), "Updated", true);

        assertTrue(updated.isPresent());
        Todo fetched = store.get(created.getId()).orElseThrow();
        assertEquals("Updated", fetched.getTitle());
        assertTrue(fetched.isCompleted());
    }

    @Test
    void updateReturnsEmptyForUnknownId() {
        TodoStore store = new TodoStore();

        Optional<Todo> updated = store.update("unknown", "Title", false);

        assertTrue(updated.isEmpty());
    }

    @Test
    void deleteRemovesExistingTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("To delete", false);

        boolean deleted = store.delete(created.getId());

        assertTrue(deleted);
        assertTrue(store.get(created.getId()).isEmpty());
    }

    @Test
    void deleteReturnsFalseForUnknownId() {
        TodoStore store = new TodoStore();

        boolean deleted = store.delete("unknown");

        assertFalse(deleted);
    }

    @Test
    void concurrentCreatesAreAllPersisted() throws InterruptedException {
        TodoStore store = new TodoStore();
        int threadCount = 20;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        AtomicInteger counter = new AtomicInteger();

        for (int i = 0; i < threadCount; i++) {
            executor.submit(() -> store.create("Todo " + counter.incrementAndGet(), false));
        }

        executor.shutdown();
        assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));

        assertEquals(threadCount, store.list().size());
    }
}
