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
        server = new TodoServer(new TodoStore(), 0);
        server.start();
        baseUrl = "http://localhost:" + server.getPort() + "/todos";
        client = HttpClient.newHttpClient();
    }

    @AfterEach
    void tearDown() {
        server.stop();
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder requestTo(String url) {
        return HttpRequest.newBuilder(URI.create(url));
    }

    @Test
    void serverReportsActualEphemeralPort() {
        assertTrue(server.getPort() > 0);
    }

    @Test
    void postCreatesTodoWithDefaultCompletedFalse() throws Exception {
        HttpRequest request = requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Buy milk\"}"))
                .build();

        HttpResponse<String> response = send(request);

        assertEquals(201, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
        JsonNode body = mapper.readTree(response.body());
        assertTrue(body.has("id"));
        assertFalse(body.get("id").asText().isBlank());
        assertEquals("Buy milk", body.get("title").asText());
        assertFalse(body.get("completed").asBoolean());
    }

    @Test
    void postCreatesTodoWithExplicitCompletedTrue() throws Exception {
        HttpRequest request = requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Buy milk\",\"completed\":true}"))
                .build();

        HttpResponse<String> response = send(request);

        assertEquals(201, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertTrue(body.get("completed").asBoolean());
    }

    @Test
    void postWithMalformedJsonReturns400() throws Exception {
        HttpRequest request = requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{not valid json"))
                .build();

        HttpResponse<String> response = send(request);

        assertEquals(400, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
    }

    @Test
    void postWithMissingTitleReturns400() throws Exception {
        HttpRequest request = requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"completed\":true}"))
                .build();

        HttpResponse<String> response = send(request);

        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithBlankTitleReturns400() throws Exception {
        HttpRequest request = requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"   \"}"))
                .build();

        HttpResponse<String> response = send(request);

        assertEquals(400, response.statusCode());
    }

    @Test
    void getAllReturnsAllCreatedTodos() throws Exception {
        send(requestTo(baseUrl).POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"A\"}")).build());
        send(requestTo(baseUrl).POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"B\"}")).build());

        HttpResponse<String> response = send(requestTo(baseUrl).GET().build());

        assertEquals(200, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
        JsonNode body = mapper.readTree(response.body());
        assertTrue(body.isArray());
        assertEquals(2, body.size());
    }

    @Test
    void getByIdReturnsTodo() throws Exception {
        HttpResponse<String> created = send(requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Find me\"}"))
                .build());
        String id = mapper.readTree(created.body()).get("id").asText();

        HttpResponse<String> response = send(requestTo(baseUrl + "/" + id).GET().build());

        assertEquals(200, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertEquals(id, body.get("id").asText());
        assertEquals("Find me", body.get("title").asText());
    }

    @Test
    void getByUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = send(requestTo(baseUrl + "/does-not-exist").GET().build());

        assertEquals(404, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
    }

    @Test
    void putUpdatesTitleAndCompleted() throws Exception {
        HttpResponse<String> created = send(requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Old\"}"))
                .build());
        String id = mapper.readTree(created.body()).get("id").asText();

        HttpResponse<String> response = send(requestTo(baseUrl + "/" + id)
                .PUT(HttpRequest.BodyPublishers.ofString("{\"title\":\"New\",\"completed\":true}"))
                .build());

        assertEquals(200, response.statusCode());
        JsonNode body = mapper.readTree(response.body());
        assertEquals("New", body.get("title").asText());
        assertTrue(body.get("completed").asBoolean());
    }

    @Test
    void putWithUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = send(requestTo(baseUrl + "/does-not-exist")
                .PUT(HttpRequest.BodyPublishers.ofString("{\"title\":\"New\"}"))
                .build());

        assertEquals(404, response.statusCode());
    }

    @Test
    void putWithInvalidBodyReturns400() throws Exception {
        HttpResponse<String> created = send(requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Old\"}"))
                .build());
        String id = mapper.readTree(created.body()).get("id").asText();

        HttpResponse<String> response = send(requestTo(baseUrl + "/" + id)
                .PUT(HttpRequest.BodyPublishers.ofString("not json"))
                .build());

        assertEquals(400, response.statusCode());
    }

    @Test
    void deleteRemovesTodo() throws Exception {
        HttpResponse<String> created = send(requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Delete me\"}"))
                .build());
        String id = mapper.readTree(created.body()).get("id").asText();

        HttpResponse<String> deleteResponse = send(requestTo(baseUrl + "/" + id).DELETE().build());
        assertEquals(204, deleteResponse.statusCode());

        HttpResponse<String> getResponse = send(requestTo(baseUrl + "/" + id).GET().build());
        assertEquals(404, getResponse.statusCode());
    }

    @Test
    void deleteWithUnknownIdReturns404() throws Exception {
        HttpResponse<String> response = send(requestTo(baseUrl + "/does-not-exist").DELETE().build());

        assertEquals(404, response.statusCode());
    }

    @Test
    void unsupportedMethodOnItemPathReturns405() throws Exception {
        HttpResponse<String> created = send(requestTo(baseUrl)
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Item\"}"))
                .build());
        String id = mapper.readTree(created.body()).get("id").asText();

        HttpResponse<String> response = send(requestTo(baseUrl + "/" + id)
                .method("PATCH", HttpRequest.BodyPublishers.noBody())
                .build());

        assertEquals(405, response.statusCode());
    }

    @Test
    void unsupportedMethodOnCollectionPathReturns405() throws Exception {
        HttpResponse<String> response = send(requestTo(baseUrl)
                .DELETE()
                .build());

        assertEquals(405, response.statusCode());
    }
}
