package com.cbs.kernel.domain.base;

import java.time.Instant;
import java.util.UUID;

/**
 * Marker interface for all domain events. Domain events represent
 * things that have happened in the past.
 */
public interface DomainEvent {
    UUID eventId();
    Instant occurredAt();
    String eventType();
}
