package com.example.todo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TodoServerTest {

    private TodoServer server;
    private HttpClient client;
    private String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() throws IOException {
        server = new TodoServer(0, new TodoStore());
        server.start();
        baseUrl = "http://localhost:" + server.getPort();
        client = HttpClient.newHttpClient();
    }

    @AfterEach
    void tearDown() {
        server.stop();
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String body) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    private HttpResponse<String> put(String path, String body) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    private HttpResponse<String> get(String path) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path)).GET().build());
    }

    private HttpResponse<String> delete(String path) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path)).DELETE().build());
    }

    private String createTodoAndGetId(String title) throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"" + title + "\"}");
        return mapper.readTree(response.body()).get("id").asText();
    }

    @Test
    void serverReportsActualEphemeralPort() {
        assertTrue(server.getPort() > 0);
    }

    @Test
    void postCreatesTodoAndReturns201() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"Buy milk\"}");

        assertEquals(201, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
        JsonNode json = mapper.readTree(response.body());
        assertTrue(json.has("id"));
        assertFalse(json.get("id").asText().isBlank());
        assertEquals("Buy milk", json.get("title").asText());
        assertFalse(json.get("completed").asBoolean());
    }

    @Test
    void postHonorsExplicitCompletedFlag() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"Ship it\",\"completed\":true}");

        JsonNode json = mapper.readTree(response.body());
        assertTrue(json.get("completed").asBoolean());
    }

    @Test
    void postWithMissingTitleReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{}");
        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithBlankTitleReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"   \"}");
        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithMalformedJsonReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{not json");
        assertEquals(400, response.statusCode());
    }

    @Test
    void getAllTodosReturnsAllCreated() throws Exception {
        post("/todos", "{\"title\":\"One\"}");
        post("/todos", "{\"title\":\"Two\"}");

        HttpResponse<String> response = get("/todos");

        assertEquals(200, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
        JsonNode json = mapper.readTree(response.body());
        assertTrue(json.isArray());
        assertEquals(2, json.size());
    }

    @Test
    void getByIdReturnsTodo() throws Exception {
        String id = createTodoAndGetId("Read a book");

        HttpResponse<String> response = get("/todos/" + id);

        assertEquals(200, response.statusCode());
        JsonNode json = mapper.readTree(response.body());
        assertEquals(id, json.get("id").asText());
        assertEquals("Read a book", json.get("title").asText());
    }

    @Test
    void getUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = get("/todos/does-not-exist");
        assertEquals(404, response.statusCode());
    }

    @Test
    void putUpdatesTodoAndReturns200() throws Exception {
        String id = createTodoAndGetId("Draft");

        HttpResponse<String> response = put("/todos/" + id, "{\"title\":\"Final\",\"completed\":true}");

        assertEquals(200, response.statusCode());
        JsonNode json = mapper.readTree(response.body());
        assertEquals("Final", json.get("title").asText());
        assertTrue(json.get("completed").asBoolean());

        HttpResponse<String> confirm = get("/todos/" + id);
        JsonNode confirmedJson = mapper.readTree(confirm.body());
        assertEquals("Final", confirmedJson.get("title").asText());
    }

    @Test
    void putUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = put("/todos/does-not-exist", "{\"title\":\"Final\"}");
        assertEquals(404, response.statusCode());
    }

    @Test
    void putWithInvalidBodyReturns400() throws Exception {
        String id = createTodoAndGetId("Draft");

        HttpResponse<String> response = put("/todos/" + id, "{\"title\":\"\"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void putWithMalformedJsonReturns400() throws Exception {
        String id = createTodoAndGetId("Draft");

        HttpResponse<String> response = put("/todos/" + id, "not json at all");

        assertEquals(400, response.statusCode());
    }

    @Test
    void deleteRemovesTodoAndReturns204() throws Exception {
        String id = createTodoAndGetId("Throwaway");

        HttpResponse<String> response = delete("/todos/" + id);
        assertEquals(204, response.statusCode());

        HttpResponse<String> confirm = get("/todos/" + id);
        assertEquals(404, confirm.statusCode());
    }

    @Test
    void deleteUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = delete("/todos/does-not-exist");
        assertEquals(404, response.statusCode());
    }

    @Test
    void unsupportedMethodOnCollectionReturns405() throws Exception {
        HttpResponse<String> response = delete("/todos");
        assertEquals(405, response.statusCode());
    }

    @Test
    void unsupportedMethodOnItemReturns405() throws Exception {
        String id = createTodoAndGetId("Whatever");

        HttpResponse<String> response = post("/todos/" + id, "{\"title\":\"x\"}");

        assertEquals(405, response.statusCode());
    }

    @Test
    void unknownNestedPathReturns404() throws Exception {
        String id = createTodoAndGetId("Whatever");

        HttpResponse<String> response = get("/todos/" + id + "/extra");

        assertEquals(404, response.statusCode());
    }
}
