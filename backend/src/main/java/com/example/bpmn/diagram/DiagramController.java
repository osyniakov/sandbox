package com.example.bpmn.diagram;

import com.example.bpmn.diagram.dto.DiagramRequest;
import com.example.bpmn.diagram.dto.DiagramResponse;
import com.example.bpmn.diagram.dto.DiagramSummary;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/diagrams")
public class DiagramController {

    private final DiagramService service;

    public DiagramController(DiagramService service) {
        this.service = service;
    }

    @GetMapping
    public List<DiagramSummary> list() {
        return service.findAll().stream().map(DiagramSummary::from).toList();
    }

    @GetMapping("/{id}")
    public DiagramResponse get(@PathVariable Long id) {
        return DiagramResponse.from(service.findById(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DiagramResponse create(@Valid @RequestBody DiagramRequest request) {
        return DiagramResponse.from(service.create(request));
    }

    @PutMapping("/{id}")
    public DiagramResponse update(@PathVariable Long id, @Valid @RequestBody DiagramRequest request) {
        return DiagramResponse.from(service.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
