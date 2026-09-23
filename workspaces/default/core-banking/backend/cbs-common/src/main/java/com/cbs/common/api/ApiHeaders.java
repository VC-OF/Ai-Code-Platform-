package com.cbs.common.api;

/**
 * Read & write headers used across the API.
 */
public final class ApiHeaders {

    public static final String REQUEST_ID = "X-Request-Id";
    public static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    public static final String TENANT = "X-Tenant-Id";

    private ApiHeaders() {
    }
}
