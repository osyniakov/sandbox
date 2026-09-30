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

class TodoServerIntegrationTest {

    private TodoServer server;
    private HttpClient client;
    private String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() throws IOException {
        server = new TodoServer(0);
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
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    private HttpResponse<String> put(String path, String body) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path))
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    private HttpResponse<String> get(String path) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path)).GET().build());
    }

    private HttpResponse<String> delete(String path) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path)).DELETE().build());
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

        JsonNode created = mapper.readTree(response.body());
        assertTrue(created.has("id"));
        assertFalse(created.get("id").asText().isBlank());
        assertEquals("Buy milk", created.get("title").asText());
        assertFalse(created.get("completed").asBoolean());
    }

    @Test
    void postWithCompletedFlagIsHonored() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"Buy milk\",\"completed\":true}");

        JsonNode created = mapper.readTree(response.body());
        assertTrue(created.get("completed").asBoolean());
    }

    @Test
    void postWithMalformedJsonReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{not json");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithMissingTitleReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"completed\":true}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithBlankTitleReturns400() throws Exception {
        HttpResponse<String> response = post("/todos", "{\"title\":\"   \"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void getTodosReturnsAllCreatedTodos() throws Exception {
        post("/todos", "{\"title\":\"First\"}");
        post("/todos", "{\"title\":\"Second\"}");

        HttpResponse<String> response = get("/todos");

        assertEquals(200, response.statusCode());
        JsonNode all = mapper.readTree(response.body());
        assertTrue(all.isArray());
        assertEquals(2, all.size());
    }

    @Test
    void getTodosReturnsEmptyArrayWhenNoneExist() throws Exception {
        HttpResponse<String> response = get("/todos");

        assertEquals(200, response.statusCode());
        JsonNode all = mapper.readTree(response.body());
        assertTrue(all.isArray());
        assertEquals(0, all.size());
    }

    @Test
    void getByIdReturnsTodo() throws Exception {
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"Buy milk\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = get("/todos/" + id);

        assertEquals(200, response.statusCode());
        JsonNode found = mapper.readTree(response.body());
        assertEquals(id, found.get("id").asText());
        assertEquals("Buy milk", found.get("title").asText());
    }

    @Test
    void getByUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = get("/todos/does-not-exist");

        assertEquals(404, response.statusCode());
    }

    @Test
    void putUpdatesTitleAndCompleted() throws Exception {
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"Original\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = put("/todos/" + id, "{\"title\":\"Updated\",\"completed\":true}");

        assertEquals(200, response.statusCode());
        JsonNode updated = mapper.readTree(response.body());
        assertEquals("Updated", updated.get("title").asText());
        assertTrue(updated.get("completed").asBoolean());

        JsonNode reFetched = mapper.readTree(get("/todos/" + id).body());
        assertEquals("Updated", reFetched.get("title").asText());
    }

    @Test
    void putWithUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = put("/todos/does-not-exist", "{\"title\":\"Updated\"}");

        assertEquals(404, response.statusCode());
    }

    @Test
    void putWithInvalidBodyReturns400() throws Exception {
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"Original\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = put("/todos/" + id, "{\"title\":\"\"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void putWithMalformedJsonReturns400() throws Exception {
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"Original\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = put("/todos/" + id, "not json at all");

        assertEquals(400, response.statusCode());
    }

    @Test
    void deleteRemovesTodoAndReturns204() throws Exception {
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"To delete\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = delete("/todos/" + id);

        assertEquals(204, response.statusCode());
        assertEquals(404, get("/todos/" + id).statusCode());
    }

    @Test
    void deleteWithUnknownIdReturns404() throws Exception {
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
        JsonNode created = mapper.readTree(post("/todos", "{\"title\":\"Buy milk\"}").body());
        String id = created.get("id").asText();

        HttpResponse<String> response = post("/todos/" + id, "{\"title\":\"Buy milk\"}");

        assertEquals(405, response.statusCode());
    }

    @Test
    void getResponsesSetJsonContentType() throws Exception {
        HttpResponse<String> response = get("/todos");

        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
    }
}
