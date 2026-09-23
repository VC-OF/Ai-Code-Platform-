package com.cbs.common.audit;

import com.cbs.common.context.RequestContext;
import com.cbs.common.context.RequestContextHolder;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * In-memory audit log publisher. Persists audit events to the
 * {@code audit_log} table via an out-of-band consumer (Phase 2 uses
 * async logging only; full persistence is wired in Phase 7).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditLogger {

    private final ObjectMapper objectMapper;

    public void record(String action, String entityType, UUID entityId,
                       Object before, Object after) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("ts", Instant.now().toString());
        RequestContext ctx = RequestContextHolder.get();
        entry.put("userId", ctx == null ? "system" : ctx.userId().toString());
        entry.put("ip", ctx == null ? "internal" : ctx.ipAddress());
        entry.put("action", action);
        entry.put("entityType", entityType);
        entry.put("entityId", entityId == null ? null : entityId.toString());
        try {
            entry.put("before", before == null ? null : objectMapper.writeValueAsString(before));
            entry.put("after", after == null ? null : objectMapper.writeValueAsString(after));
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize audit entry", e);
        }
        // Fire-and-forget. In Phase 7 this writes to audit_log table.
        CompletableFuture.runAsync(() -> log.info("AUDIT {}", entry));
    }
}
