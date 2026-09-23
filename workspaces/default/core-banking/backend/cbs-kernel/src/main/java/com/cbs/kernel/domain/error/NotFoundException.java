package com.cbs.kernel.domain.error;

/**
 * Thrown when a domain entity cannot be found.
 */
public class NotFoundException extends DomainException {
    public NotFoundException(String resource, Object id) {
        super("RESOURCE_NOT_FOUND", "%s with id %s was not found".formatted(resource, id));
    }
}
