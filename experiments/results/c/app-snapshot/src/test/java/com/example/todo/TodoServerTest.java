package com.example.todo;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TodoServerTest {

    private TodoServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop();
        }
    }

    @Test
    void startsOnEphemeralPortAndReportsIt() {
        server = new TodoServer(0);

        server.start();

        assertTrue(server.getPort() > 0);
    }

    @Test
    void stopClosesTheListeningSocket() throws IOException {
        server = new TodoServer(0);
        server.start();
        int port = server.getPort();

        server.stop();

        assertThrows(IOException.class, () -> {
            try (Socket socket = new Socket()) {
                socket.connect(new java.net.InetSocketAddress("localhost", port), 200);
                socket.getOutputStream().write(1);
                socket.getInputStream().read();
            }
        });
    }

    @Test
    void twoServersOnPortZeroGetDifferentPorts() throws IOException {
        server = new TodoServer(0);
        server.start();

        TodoServer other = new TodoServer(0);
        try {
            other.start();
            assertTrue(server.getPort() != other.getPort());
        } finally {
            other.stop();
        }
    }
}
