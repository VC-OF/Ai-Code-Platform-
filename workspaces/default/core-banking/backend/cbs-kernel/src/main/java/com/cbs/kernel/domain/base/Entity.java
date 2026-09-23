package com.cbs.kernel.domain.base;

/**
 * Marker interface for entities. Entities have identity, not lifecycle.
 */
public interface Entity<ID> {
    ID getId();
}
