package com.bank.identity.api.dto;

import com.bank.identity.domain.Branch;

import java.time.Instant;
import java.util.UUID;

public record BranchResponse(
        UUID id,
        UUID tenantId,
        String code,
        String name,
        String ifsc,
        String email,
        String phone,
        String addressLine1,
        String addressLine2,
        String city,
        String state,
        String postalCode,
        String countryCode,
        UUID managerUserId,
        String status,
        long cashBalanceMinor,
        String cashCurrency,
        Instant createdAt
) {
    public static BranchResponse from(Branch b) {
        return new BranchResponse(
            b.getId(), b.getTenantId(), b.getCode(), b.getName(), b.getIfsc(),
            b.getEmail(), b.getPhone(),
            b.getAddressLine1(), b.getAddressLine2(), b.getCity(), b.getState(),
            b.getPostalCode(), b.getCountryCode(), b.getManagerUserId(),
            b.getStatus(), b.getCashBalanceMinor(), b.getCashCurrency(),
            b.getCreatedAt()
        );
    }
}
