package com.cbs.common.audit;

/**
 * Marker annotation for repository / service methods whose state changes
 * must be persisted to the audit log.
 */
public @interface Auditable {
    String action();
    String entityType();
}
