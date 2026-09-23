package com.cbs.kernel.domain.base;

import java.time.Instant;
import java.util.UUID;

/**
 * Marker interface for all domain entities. Domain entities have identity,
 * lifecycle and are persisted.
 */
public interface AggregateRoot<ID> {

    ID getId();

    Instant getCreatedAt();

    String getCreatedBy();

    Instant getUpdatedAt();

    String getUpdatedBy();

    Instant getDeletedAt();

    boolean isDeleted();
}
