package com.cbs.kernel.domain.error;

/**
 * Thrown when a domain operation conflicts with the current state of the system
 * (e.g. unique constraint violations, optimistic locking failures).
 */
public class ConflictException extends DomainException {
    public ConflictException(String message) {
        super("RESOURCE_CONFLICT", message);
    }
}
