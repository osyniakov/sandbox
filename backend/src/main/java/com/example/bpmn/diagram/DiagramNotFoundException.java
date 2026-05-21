package com.example.bpmn.diagram;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.NOT_FOUND)
public class DiagramNotFoundException extends RuntimeException {
    public DiagramNotFoundException(Long id) {
        super("Diagram not found: " + id);
    }
}
