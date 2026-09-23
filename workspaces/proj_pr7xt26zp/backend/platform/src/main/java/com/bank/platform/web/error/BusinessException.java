package com.bank.platform.web.error;

import org.springframework.http.HttpStatus;

/**
 * Base class for all business exceptions. Subclasses carry a stable error
 * code (used by clients) and an HTTP status.
 */
public abstract class BusinessException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    protected BusinessException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    protected BusinessException(HttpStatus status, String code, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
}
