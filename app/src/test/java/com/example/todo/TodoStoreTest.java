package com.example.todo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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

        Optional<Todo> found = store.get("does-not-exist");

        assertTrue(found.isEmpty());
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
    void updateChangesTitleAndCompleted() {
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

        Optional<Todo> updated = store.update("does-not-exist", "Updated", true);

        assertTrue(updated.isEmpty());
    }

    @Test
    void deleteRemovesTodoAndReturnsTrue() {
        TodoStore store = new TodoStore();
        Todo created = store.create("To be removed", false);

        boolean deleted = store.delete(created.getId());

        assertTrue(deleted);
        assertTrue(store.get(created.getId()).isEmpty());
    }

    @Test
    void deleteReturnsFalseForUnknownId() {
        TodoStore store = new TodoStore();

        boolean deleted = store.delete("does-not-exist");

        assertFalse(deleted);
    }

    @Test
    void concurrentCreatesAreAllStoredSafely() throws InterruptedException {
        TodoStore store = new TodoStore();
        int threadCount = 20;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch latch = new CountDownLatch(threadCount);

        for (int i = 0; i < threadCount; i++) {
            executor.submit(() -> {
                store.create("Concurrent", false);
                latch.countDown();
            });
        }

        assertTrue(latch.await(10, TimeUnit.SECONDS));
        executor.shutdown();

        assertEquals(threadCount, store.list().size());
    }
}
