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
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end tests driving TodoServer purely over HTTP, per SPEC.md.
 */
class TodoServerIntegrationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private TodoServer server;
    private String baseUrl;

    @BeforeEach
    void setUp() {
        server = new TodoServer(0);
        server.start();
        baseUrl = "http://localhost:" + server.getPort();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop();
        }
    }

    // ---- helpers ----------------------------------------------------

    private HttpResponse<String> send(String method, String path, String jsonBody) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path));
        HttpRequest.BodyPublisher publisher = jsonBody == null ? BodyPublishers.noBody() : BodyPublishers.ofString(jsonBody);
        builder.method(method, publisher);
        if (jsonBody != null) {
            builder.header("Content-Type", "application/json");
        }
        return CLIENT.send(builder.build(), BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String jsonBody) throws IOException, InterruptedException {
        return send("POST", "/todos", jsonBody);
    }

    private HttpResponse<String> get(String path) throws IOException, InterruptedException {
        return send("GET", path, null);
    }

    private HttpResponse<String> put(String path, String jsonBody) throws IOException, InterruptedException {
        return send("PUT", path, jsonBody);
    }

    private HttpResponse<String> delete(String path) throws IOException, InterruptedException {
        return send("DELETE", path, null);
    }

    private void assertJsonContentType(HttpResponse<String> response) {
        String contentType = response.headers().firstValue("Content-Type").orElse("");
        assertTrue(contentType.startsWith("application/json"),
                "expected Content-Type application/json but was: " + contentType);
    }

    private String createTodoAndGetId(String title) throws IOException, InterruptedException {
        HttpResponse<String> response = post("{\"title\": \"" + title + "\"}");
        assertEquals(201, response.statusCode());
        JsonNode node = MAPPER.readTree(response.body());
        return node.get("id").asText();
    }

    // ---- POST /todos -------------------------------------------------

    @Test
    void postCreatesTodoAndReturns201WithCreatedTodo() throws Exception {
        HttpResponse<String> response = post("{\"title\": \"Buy milk\"}");

        assertEquals(201, response.statusCode());
        assertJsonContentType(response);

        JsonNode node = MAPPER.readTree(response.body());
        assertTrue(node.has("id"));
        assertFalse(node.get("id").asText().isBlank());
        assertEquals("Buy milk", node.get("title").asText());
        assertFalse(node.get("completed").asBoolean());
    }

    @Test
    void postWithExplicitCompletedRespectsValue() throws Exception {
        HttpResponse<String> response = post("{\"title\": \"Buy milk\", \"completed\": true}");

        assertEquals(201, response.statusCode());
        JsonNode node = MAPPER.readTree(response.body());
        assertTrue(node.get("completed").asBoolean());
    }

    @Test
    void postCreatedTodoIsRetrievableAfterwards() throws Exception {
        HttpResponse<String> created = post("{\"title\": \"Buy milk\"}");
        String id = MAPPER.readTree(created.body()).get("id").asText();

        HttpResponse<String> fetched = get("/todos/" + id);

        assertEquals(200, fetched.statusCode());
        JsonNode node = MAPPER.readTree(fetched.body());
        assertEquals(id, node.get("id").asText());
        assertEquals("Buy milk", node.get("title").asText());
    }

    @Test
    void postMalformedJsonReturns400() throws Exception {
        HttpResponse<String> response = post("{ not valid json ");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postMissingTitleReturns400() throws Exception {
        HttpResponse<String> response = post("{\"completed\": false}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postBlankTitleReturns400() throws Exception {
        HttpResponse<String> response = post("{\"title\": \"   \"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postEmptyTitleReturns400() throws Exception {
        HttpResponse<String> response = post("{\"title\": \"\"}");

        assertEquals(400, response.statusCode());
    }

    // ---- GET /todos ---------------------------------------------------

    @Test
    void getListReturns200WithEmptyArrayInitially() throws Exception {
        HttpResponse<String> response = get("/todos");

        assertEquals(200, response.statusCode());
        assertJsonContentType(response);
        JsonNode node = MAPPER.readTree(response.body());
        assertTrue(node.isArray());
        assertEquals(0, node.size());
    }

    @Test
    void getListReturnsAllCreatedTodos() throws Exception {
        String firstId = createTodoAndGetId("First");
        String secondId = createTodoAndGetId("Second");

        HttpResponse<String> response = get("/todos");

        assertEquals(200, response.statusCode());
        assertJsonContentType(response);
        JsonNode node = MAPPER.readTree(response.body());
        assertTrue(node.isArray());
        assertEquals(2, node.size());

        boolean hasFirst = false;
        boolean hasSecond = false;
        for (JsonNode item : node) {
            String id = item.get("id").asText();
            if (id.equals(firstId)) hasFirst = true;
            if (id.equals(secondId)) hasSecond = true;
        }
        assertTrue(hasFirst);
        assertTrue(hasSecond);
    }

    // ---- GET /todos/{id} ------------------------------------------------

    @Test
    void getByIdReturns200WithMatchingTodo() throws Exception {
        String id = createTodoAndGetId("Read a book");

        HttpResponse<String> response = get("/todos/" + id);

        assertEquals(200, response.statusCode());
        assertJsonContentType(response);
        JsonNode node = MAPPER.readTree(response.body());
        assertEquals(id, node.get("id").asText());
        assertEquals("Read a book", node.get("title").asText());
        assertFalse(node.get("completed").asBoolean());
    }

    @Test
    void getByUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = get("/todos/" + UUID.randomUUID());

        assertEquals(404, response.statusCode());
    }

    // ---- PUT /todos/{id} ------------------------------------------------

    @Test
    void putUpdatesTodoAndReturns200WithUpdatedTodo() throws Exception {
        String id = createTodoAndGetId("Original title");

        HttpResponse<String> response = put("/todos/" + id, "{\"title\": \"Updated title\", \"completed\": true}");

        assertEquals(200, response.statusCode());
        assertJsonContentType(response);
        JsonNode node = MAPPER.readTree(response.body());
        assertEquals(id, node.get("id").asText());
        assertEquals("Updated title", node.get("title").asText());
        assertTrue(node.get("completed").asBoolean());
    }

    @Test
    void putPersistsUpdateVisibleOnSubsequentGet() throws Exception {
        String id = createTodoAndGetId("Original title");

        put("/todos/" + id, "{\"title\": \"Updated title\", \"completed\": true}");
        HttpResponse<String> response = get("/todos/" + id);

        assertEquals(200, response.statusCode());
        JsonNode node = MAPPER.readTree(response.body());
        assertEquals("Updated title", node.get("title").asText());
        assertTrue(node.get("completed").asBoolean());
    }

    @Test
    void putUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = put("/todos/" + UUID.randomUUID(),
                "{\"title\": \"Doesn't matter\", \"completed\": false}");

        assertEquals(404, response.statusCode());
    }

    @Test
    void putMalformedJsonReturns400() throws Exception {
        String id = createTodoAndGetId("Original title");

        HttpResponse<String> response = put("/todos/" + id, "{ not valid json ");

        assertEquals(400, response.statusCode());
    }

    @Test
    void putBlankTitleReturns400() throws Exception {
        String id = createTodoAndGetId("Original title");

        HttpResponse<String> response = put("/todos/" + id, "{\"title\": \"   \", \"completed\": false}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void putMissingTitleReturns400() throws Exception {
        String id = createTodoAndGetId("Original title");

        HttpResponse<String> response = put("/todos/" + id, "{\"completed\": false}");

        assertEquals(400, response.statusCode());
    }

    // ---- DELETE /todos/{id} ---------------------------------------------

    @Test
    void deleteReturns204AndRemovesTodo() throws Exception {
        String id = createTodoAndGetId("To be deleted");

        HttpResponse<String> response = delete("/todos/" + id);

        assertEquals(204, response.statusCode());

        HttpResponse<String> afterDelete = get("/todos/" + id);
        assertEquals(404, afterDelete.statusCode());
    }

    @Test
    void deleteUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = delete("/todos/" + UUID.randomUUID());

        assertEquals(404, response.statusCode());
    }

    // ---- unsupported methods -> 405 --------------------------------------

    @Test
    void deleteOnTodosCollectionReturns405() throws Exception {
        HttpResponse<String> response = delete("/todos");

        assertEquals(405, response.statusCode());
    }

    @Test
    void putOnTodosCollectionReturns405() throws Exception {
        HttpResponse<String> response = put("/todos", "{\"title\": \"x\"}");

        assertEquals(405, response.statusCode());
    }

    @Test
    void postOnTodoItemReturns405() throws Exception {
        String id = createTodoAndGetId("Some todo");

        HttpResponse<String> response = send("POST", "/todos/" + id, "{\"title\": \"x\"}");

        assertEquals(405, response.statusCode());
    }

    @Test
    void patchOnTodoItemReturns405() throws Exception {
        String id = createTodoAndGetId("Some todo");

        HttpResponse<String> response = send("PATCH", "/todos/" + id, "{\"title\": \"x\"}");

        assertEquals(405, response.statusCode());
    }

    // ---- Content-Type header ---------------------------------------------

    @Test
    void errorResponsesAreJsonContentType() throws Exception {
        assertJsonContentType(get("/todos/" + UUID.randomUUID()));
        assertJsonContentType(post("{ not valid json "));
    }
}
