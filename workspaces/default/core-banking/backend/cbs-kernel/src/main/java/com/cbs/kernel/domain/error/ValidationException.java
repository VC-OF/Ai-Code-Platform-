package com.cbs.kernel.domain.error;

/**
 * Thrown when business validation fails.
 */
public class ValidationException extends DomainException {
    public ValidationException(String message) {
        super("VALIDATION_FAILED", message);
    }
}
