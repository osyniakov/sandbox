package com.example.bpmn.diagram.dto;

import com.example.bpmn.diagram.Diagram;

import java.time.Instant;

public record DiagramResponse(
        Long id,
        String name,
        String xml,
        Instant createdAt,
        Instant updatedAt
) {
    public static DiagramResponse from(Diagram d) {
        return new DiagramResponse(d.getId(), d.getName(), d.getXml(), d.getCreatedAt(), d.getUpdatedAt());
    }
}
