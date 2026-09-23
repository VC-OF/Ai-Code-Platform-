package com.bank.platform.audit;

import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;
import java.util.UUID;

/**
 * Persists audit events emitted by {@link AuditService}. This component
 * will be replaced by a real audit log table in a later phase; the current
 * shape logs to slf4j at INFO so the rest of the platform can already wire
 * up the calls.
 */
@Component
public class AuditEventListener {

    private static final org.slf4j.Logger log =
        org.slf4j.LoggerFactory.getLogger(AuditEventListener.class);

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onChange(AuditService.AuditChangeEvent event) {
        log.info("AUDIT_CHANGE actor={} entity={} entityId={} action={} ip={}",
            event.actorId(), event.entity(), event.entityId(), event.action(), event.ip());
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onAction(AuditService.AuditActionEvent event) {
        log.info("AUDIT_ACTION actor={} action={} detail={} ip={}",
            event.actorId(), event.action(), event.detail(), event.ip());
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onFailure(AuditService.AuditFailureEvent event) {
        log.warn("AUDIT_FAILURE actor={} action={} detail={} ip={}",
            event.actorId(), event.action(), event.detail(), event.ip());
    }
}
