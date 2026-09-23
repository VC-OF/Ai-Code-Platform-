package com.cbs.common.security;

import com.cbs.kernel.domain.error.ForbiddenException;
import com.cbs.kernel.domain.error.NotFoundException;
import com.cbs.kernel.domain.error.ValidationException;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Global exception handler. Maps domain exceptions to RFC 7807 problem
 * details responses. Should be imported by every module that exposes
 * a REST API.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @Getter
    @Builder
    @AllArgsConstructor
    public static class ApiError {
        private Instant timestamp;
        private int status;
        private String code;
        private String message;
        private String path;
        private List<Map<String, String>> fieldErrors;
    }

    @ExceptionHandler(NotFoundException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleNotFound(
            NotFoundException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.NOT_FOUND, ex.getCode(), ex.getMessage(), request, null);
    }

    @ExceptionHandler(ValidationException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleValidation(
            ValidationException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.BAD_REQUEST, ex.getCode(), ex.getMessage(), request, null);
    }

    @ExceptionHandler(ForbiddenException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleForbidden(
            ForbiddenException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.FORBIDDEN, ex.getCode(), ex.getMessage(), request, null);
    }

    @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleBeanValidation(
            org.springframework.web.bind.MethodArgumentNotValidException ex,
            org.springframework.web.context.request.WebRequest request) {
        List<Map<String, String>> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> Map.of("field", e.getField(), "message", e.getDefaultMessage()))
                .toList();
        return build(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                "Request validation failed", request, errors);
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleAccessDenied(
            org.springframework.security.access.AccessDeniedException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.FORBIDDEN, "ACCESS_DENIED", ex.getMessage(), request, null);
    }

    @ExceptionHandler(org.springframework.security.authentication.BadCredentialsException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleBadCredentials(
            org.springframework.security.authentication.BadCredentialsException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "Invalid username or password", request, null);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public org.springframework.http.ResponseEntity<ApiError> handleIllegalArgument(
            IllegalArgumentException ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.BAD_REQUEST, "ILLEGAL_ARGUMENT", ex.getMessage(), request, null);
    }

    @ExceptionHandler(Exception.class)
    public org.springframework.http.ResponseEntity<ApiError> handleAny(
            Exception ex,
            org.springframework.web.context.request.WebRequest request) {
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "An unexpected error occurred", request, null);
    }

    private org.springframework.http.ResponseEntity<ApiError> build(
            HttpStatus status, String code, String message,
            org.springframework.web.context.request.WebRequest request,
            List<Map<String, String>> fieldErrors) {
        String path = request.getDescription(false).replace("uri=", "");
        ApiError body = ApiError.builder()
                .timestamp(Instant.now())
                .status(status.value())
                .code(code)
                .message(message)
                .path(path)
                .fieldErrors(fieldErrors)
                .build();
        return org.springframework.http.ResponseEntity.status(status).body(body);
    }
}
