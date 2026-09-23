package com.cbs.kernel.domain.error;

/**
 * Thrown when an actor is authenticated but not authorized to perform an action.
 */
public class ForbiddenException extends DomainException {
    public ForbiddenException(String message) {
        super("FORBIDDEN", message);
    }
}
