package com.bank.platform.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Public entry point for the audit subsystem. Components call
 * {@link #recordChange}, {@link #recordAction} or {@link #recordFailure}.
 * Persistence happens asynchronously after the originating transaction
 * commits to avoid polluting the unit of work.
 */
@Service
public class AuditService {

    private final ApplicationEventPublisher publisher;

    public AuditService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    public void recordChange(UUID actorId, String entity, UUID entityId, String action,
                             Map<String, Object> oldValues, Map<String, Object> newValues) {
        publisher.publishEvent(new AuditChangeEvent(
            actorId, entity, entityId, action,
            toJson(oldValues), toJson(newValues), clientIp()));
    }

    public void recordAction(UUID actorId, String action, String detail) {
        publisher.publishEvent(new AuditActionEvent(actorId, action, detail, clientIp()));
    }

    public void recordFailure(UUID actorId, String action, Throwable error) {
        publisher.publishEvent(new AuditFailureEvent(
            actorId, action, error.getMessage(), clientIp()));
    }

    private static String clientIp() {
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes)
                RequestContextHolder.getRequestAttributes();
            if (attrs == null) return null;
            String xff = attrs.getRequest().getHeader("X-Forwarded-For");
            if (xff != null && !xff.isBlank()) {
                int comma = xff.indexOf(',');
                return (comma > 0 ? xff.substring(0, comma) : xff).trim();
            }
            return attrs.getRequest().getRemoteAddr();
        } catch (Exception e) {
            return null;
        }
    }

    private static String toJson(Map<String, Object> map) {
        if (map == null) return null;
        try {
            return new ObjectMapper().writeValueAsString(map);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    /* -------- Events -------- */

    public record AuditChangeEvent(UUID actorId, String entity, UUID entityId, String action,
                                   String oldJson, String newJson, String ip) {}
    public record AuditActionEvent(UUID actorId, String action, String detail, String ip) {}
    public record AuditFailureEvent(UUID actorId, String action, String detail, String ip) {}
}
