package com.example.bpmn.diagram.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DiagramRequest(
        @NotBlank @Size(max = 255) String name,
        @NotBlank String xml
) {
}
