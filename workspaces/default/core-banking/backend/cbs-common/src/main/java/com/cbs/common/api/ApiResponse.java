package com.cbs.common.api;

import java.time.Instant;

/**
 * Envelope for single-resource responses. Keeps the response shape
 * consistent across the API.
 */
public record ApiResponse<T>(T data, Instant timestamp) {
    public static <T> ApiResponse<T> of(T data) {
        return new ApiResponse<>(data, Instant.now());
    }
}
