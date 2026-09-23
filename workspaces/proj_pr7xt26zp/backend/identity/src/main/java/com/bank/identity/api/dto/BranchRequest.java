package com.bank.identity.api.dto;

import com.bank.identity.domain.Branch;
import com.bank.platform.domain.EncryptedStringConverter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record BranchRequest(
        @NotBlank @Size(max = 16) String code,
        @NotBlank @Size(max = 128) String name,
        @NotBlank @Pattern(regexp = "^[A-Z]{4}0[A-Z0-9]{6}$") String ifsc,
        String micr,
        @Size(max = 128) String email,
        @Size(max = 32) String phone,
        @NotBlank @Size(max = 256) String addressLine1,
        @Size(max = 256) String addressLine2,
        @NotBlank @Size(max = 64) String city,
        @NotBlank @Size(max = 64) String state,
        @NotBlank @Size(max = 16) String postalCode,
        @NotBlank @Size(min = 2, max = 2) String countryCode,
        UUID managerUserId
) {
    public Branch toEntity(UUID tenantId) {
        Branch b = new Branch();
        b.setTenantId(tenantId);
        b.setCode(code);
        b.setName(name);
        b.setIfsc(ifsc);
        b.setMicr(micr);
        b.setEmail(email);
        b.setPhone(phone);
        b.setAddressLine1(addressLine1);
        b.setAddressLine2(addressLine2);
        b.setCity(city);
        b.setState(state);
        b.setPostalCode(postalCode);
        b.setCountryCode(countryCode);
        b.setManagerUserId(managerUserId);
        b.setStatus("ACTIVE");
        return b;
    }
}
