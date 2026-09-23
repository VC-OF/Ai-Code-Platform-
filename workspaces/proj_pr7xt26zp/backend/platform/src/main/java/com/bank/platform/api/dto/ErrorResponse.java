package com.bank.platform.api.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Lightweight error envelope returned by the {@code GlobalExceptionHandler}.
 * Maps to {@code application/problem+json}.
 */
public record ErrorResponse(
        String type,
        String title,
        int status,
        String detail,
        String instance,
        String code,
        Instant timestamp,
        List<FieldError> errors,
        Map<String, Object> extra
) {
    public record FieldError(String field, String message, Object rejectedValue) {}
}
