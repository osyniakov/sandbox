package com.example.bpmn.diagram;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "app.seed.enabled=false")
@AutoConfigureMockMvc
class DiagramControllerTest {

    private static final String MINIMAL_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                              targetNamespace="http://bpmn.io/schema/bpmn">
              <bpmn:process id="Process_1" isExecutable="false" />
            </bpmn:definitions>
            """;

    @Autowired
    MockMvc mockMvc;

    @Test
    void crudHappyPath() throws Exception {
        mockMvc.perform(get("/api/diagrams"))
                .andExpect(status().isOk());

        String body = """
                {"name":"demo","xml":%s}
                """.formatted(quote(MINIMAL_XML));

        String created = mockMvc.perform(post("/api/diagrams")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name", is("demo")))
                .andReturn().getResponse().getContentAsString();

        Long id = extractId(created);

        mockMvc.perform(get("/api/diagrams/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("demo")));

        String updateBody = """
                {"name":"renamed","xml":%s}
                """.formatted(quote(MINIMAL_XML));
        mockMvc.perform(put("/api/diagrams/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("renamed")));

        mockMvc.perform(delete("/api/diagrams/" + id))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/diagrams/" + id))
                .andExpect(status().isNotFound());
    }

    private static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    private static Long extractId(String json) {
        int idx = json.indexOf("\"id\":");
        int start = idx + 5;
        int end = start;
        while (end < json.length() && Character.isDigit(json.charAt(end))) end++;
        return Long.parseLong(json.substring(start, end));
    }
}
