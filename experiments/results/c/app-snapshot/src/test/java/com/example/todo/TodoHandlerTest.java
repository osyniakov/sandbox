package com.example.todo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Focused handler-level checks for routing and status codes. The full
 * end-to-end HttpClient integration suite lives elsewhere.
 */
class TodoHandlerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private TodoServer server;
    private String baseUrl;

    @BeforeEach
    void setUp() {
        server = new TodoServer(0);
        server.start();
        baseUrl = "http://localhost:" + server.getPort() + "/todos";
    }

    @AfterEach
    void tearDown() {
        server.stop();
    }

    @Test
    void postCreatesTodoAndReturns201WithJsonContentType() throws Exception {
        HttpResponse<String> response = post(baseUrl, "{\"title\":\"Buy milk\"}");

        assertEquals(201, response.statusCode());
        assertEquals("application/json", response.headers().firstValue("Content-Type").orElse(""));
        JsonNode body = MAPPER.readTree(response.body());
        assertTrue(body.get("id").asText().length() > 0);
        assertEquals("Buy milk", body.get("title").asText());
        assertEquals(false, body.get("completed").asBoolean());
    }

    @Test
    void postWithMalformedJsonReturns400() throws Exception {
        HttpResponse<String> response = post(baseUrl, "not json");

        assertEquals(400, response.statusCode());
    }

    @Test
    void postWithBlankTitleReturns400() throws Exception {
        HttpResponse<String> response = post(baseUrl, "{\"title\":\"  \"}");

        assertEquals(400, response.statusCode());
    }

    @Test
    void getUnknownIdReturns404() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/does-not-exist"))
                .GET()
                .build();

        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(404, response.statusCode());
    }

    @Test
    void putUnknownIdReturns404() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/does-not-exist"))
                .PUT(HttpRequest.BodyPublishers.ofString("{\"title\":\"x\",\"completed\":true}"))
                .build();

        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(404, response.statusCode());
    }

    @Test
    void deleteUnknownIdReturns404() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/does-not-exist"))
                .DELETE()
                .build();

        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(404, response.statusCode());
    }

    @Test
    void deleteExistingTodoReturns204() throws Exception {
        JsonNode created = MAPPER.readTree(post(baseUrl, "{\"title\":\"Buy milk\"}").body());
        String id = created.get("id").asText();

        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/" + id))
                .DELETE()
                .build();
        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(204, response.statusCode());
    }

    @Test
    void unsupportedMethodOnCollectionReturns405() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl))
                .DELETE()
                .build();

        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(405, response.statusCode());
    }

    @Test
    void unsupportedMethodOnItemReturns405() throws Exception {
        JsonNode created = MAPPER.readTree(post(baseUrl, "{\"title\":\"Buy milk\"}").body());
        String id = created.get("id").asText();

        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/" + id))
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build();
        HttpResponse<String> response = CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(405, response.statusCode());
    }

    private HttpResponse<String> post(String url, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
