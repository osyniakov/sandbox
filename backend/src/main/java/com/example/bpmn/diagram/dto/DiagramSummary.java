package com.example.bpmn.diagram.dto;

import com.example.bpmn.diagram.Diagram;

import java.time.Instant;

public record DiagramSummary(
        Long id,
        String name,
        Instant createdAt,
        Instant updatedAt
) {
    public static DiagramSummary from(Diagram d) {
        return new DiagramSummary(d.getId(), d.getName(), d.getCreatedAt(), d.getUpdatedAt());
    }
}
