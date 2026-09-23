package com.bank.identity.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record UserCreateRequest(
        @NotBlank @Size(min = 3, max = 64) String username,
        @NotBlank @Email @Size(max = 128) String email,
        @NotBlank @Size(max = 128) String displayName,
        @NotBlank @Size(min = 12, max = 128) String password,
        UUID branchId,
        @NotBlank String roleCode
) {}
