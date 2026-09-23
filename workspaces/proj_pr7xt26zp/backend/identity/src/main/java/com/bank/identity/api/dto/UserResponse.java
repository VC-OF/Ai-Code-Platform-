package com.bank.identity.api.dto;

import com.bank.identity.domain.User;
import com.bank.platform.domain.EncryptedStringConverter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record UserResponse(
        UUID id,
        UUID tenantId,
        UUID branchId,
        String username,
        String displayName,
        String email,
        String status,
        boolean mfaEnabled,
        Instant lastLoginAt,
        Instant createdAt,
        List<String> roles
) {
    public static UserResponse from(User user, List<String> roleCodes) {
        return new UserResponse(
            user.getId(),
            user.getTenantId(),
            user.getBranchId(),
            user.getUsername(),
            user.getDisplayName(),
            user.getEmail(),
            user.getStatus(),
            user.isMfaEnabled(),
            user.getLastLoginAt(),
            user.getCreatedAt(),
            roleCodes
        );
    }
}
