package com.cbs.common.security;

import java.util.List;
import java.util.UUID;

/**
 * Authenticated principal exposed in Spring Security. Replaces the
 * default UserDetails. Stored in {@code Authentication#getPrincipal()}.
 */
public record AuthenticatedUser(
        UUID userId,
        String username,
        UUID branchId,
        List<String> permissions
) {
    public boolean hasPermission(String permission) {
        return permissions != null && permissions.contains(permission);
    }
}
