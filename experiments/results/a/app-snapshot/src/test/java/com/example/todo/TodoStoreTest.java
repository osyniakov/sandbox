package com.example.todo;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TodoStoreTest {

    @Test
    void createAssignsIdAndDefaults() {
        TodoStore store = new TodoStore();
        Todo todo = store.create("Buy milk", false);

        assertTrue(todo.getId() != null && !todo.getId().isBlank());
        assertEquals("Buy milk", todo.getTitle());
        assertFalse(todo.isCompleted());
    }

    @Test
    void getReturnsEmptyForUnknownId() {
        TodoStore store = new TodoStore();
        assertTrue(store.get("nope").isEmpty());
    }

    @Test
    void getReturnsCreatedTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Walk dog", true);

        Optional<Todo> found = store.get(created.getId());
        assertTrue(found.isPresent());
        assertEquals(created.getId(), found.get().getId());
        assertEquals("Walk dog", found.get().getTitle());
        assertTrue(found.get().isCompleted());
    }

    @Test
    void listReturnsAllCreatedTodos() {
        TodoStore store = new TodoStore();
        store.create("One", false);
        store.create("Two", false);

        List<Todo> all = store.list();
        assertEquals(2, all.size());
    }

    @Test
    void listReturnsEmptyWhenNoTodos() {
        TodoStore store = new TodoStore();
        assertTrue(store.list().isEmpty());
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
        assertTrue(store.update("nope", "Title", false).isEmpty());
    }

    @Test
    void deleteRemovesExistingTodo() {
        TodoStore store = new TodoStore();
        Todo created = store.create("Gone soon", false);

        assertTrue(store.delete(created.getId()));
        assertTrue(store.get(created.getId()).isEmpty());
    }

    @Test
    void deleteReturnsFalseForUnknownId() {
        TodoStore store = new TodoStore();
        assertFalse(store.delete("nope"));
    }

    @Test
    void concurrentCreatesAreAllStoredSafely() throws InterruptedException {
        TodoStore store = new TodoStore();
        int threadCount = 20;
        ExecutorService pool = Executors.newFixedThreadPool(threadCount);
        CountDownLatch ready = new CountDownLatch(threadCount);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threadCount);
        Set<String> ids = new CopyOnWriteArraySet<>();

        for (int i = 0; i < threadCount; i++) {
            int index = i;
            pool.submit(() -> {
                ready.countDown();
                try {
                    start.await();
                    Todo todo = store.create("Task " + index, false);
                    ids.add(todo.getId());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }

        ready.await();
        start.countDown();
        assertTrue(done.await(10, TimeUnit.SECONDS));
        pool.shutdown();

        assertEquals(threadCount, ids.size());
        assertEquals(threadCount, store.list().size());
    }
}
