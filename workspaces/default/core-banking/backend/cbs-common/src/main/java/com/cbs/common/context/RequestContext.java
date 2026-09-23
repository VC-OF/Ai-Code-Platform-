package com.cbs.common.context;

import java.util.List;
import java.util.UUID;

/**
 * Per-request context. Set by the {@code JwtAuthenticationFilter} and
 * readable from anywhere via {@link RequestContextHolder}.
 */
public record RequestContext(
        UUID userId,
        String username,
        UUID branchId,
        List<String> permissions,
        String ipAddress
) {
}
