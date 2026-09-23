package com.bank.platform.web.error;

import org.springframework.http.HttpStatus;

import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * RFC 7807 problem details body. Built via the static factory methods and
 * serialized to {@code application/problem+json}.
 */
public record ProblemDetail(
        URI type,
        String title,
        HttpStatus status,
        String detail,
        String instance,
        String code,
        List<FieldViolation> errors,
        Map<String, Object> properties
) {
    public static ProblemDetail of(HttpStatus status, String code, String detail) {
        return new ProblemDetail(
            URI.create("about:blank"),
            status.getReasonPhrase(),
            status,
            detail,
            null,
            code,
            List.of(),
            Map.of()
        );
    }

    public static ProblemDetail of(HttpStatus status, String code, String detail,
                                   String instance) {
        return new ProblemDetail(
            URI.create("about:blank"),
            status.getReasonPhrase(),
            status,
            detail,
            instance,
            code,
            List.of(),
            Map.of()
        );
    }

    public static ProblemDetail validation(String detail, List<FieldViolation> violations) {
        return new ProblemDetail(
            URI.create("about:blank"),
            "Validation failed",
            HttpStatus.BAD_REQUEST,
            detail,
            null,
            "VALIDATION_ERROR",
            violations,
            Map.of()
        );
    }

    public record FieldViolation(String field, String message, Object rejectedValue) {}
}
