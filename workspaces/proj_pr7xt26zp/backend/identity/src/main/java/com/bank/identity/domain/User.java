package com.bank.identity.domain;

import com.bank.platform.domain.Auditable;
import com.bank.platform.domain.EncryptedStringConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A user account that can sign in to the platform. Users are scoped to a
 * tenant and may optionally be assigned to a single primary branch.
 */
@Entity
@Table(name = "users",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_users_tenant_username", columnNames = {"tenant_id", "username"}),
        @UniqueConstraint(name = "uk_users_tenant_email",    columnNames = {"tenant_id", "email"})
    },
    indexes = {
        @Index(name = "idx_users_tenant", columnList = "tenant_id"),
        @Index(name = "idx_users_branch", columnList = "branch_id"),
        @Index(name = "idx_users_status", columnList = "status")
    })
@Getter
@Setter
@NoArgsConstructor
public class User extends Auditable {

    @jakarta.persistence.Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "username", nullable = false, length = 64)
    private String username;

    @Column(name = "email", nullable = false, length = 128)
    private String email;

    @Column(name = "email_encrypted", length = 256)
    @Convert(converter = EncryptedStringConverter.class)
    private String emailEncrypted; // for full-text PII search

    @Column(name = "display_name", length = 128)
    private String displayName;

    @Column(name = "password_hash", nullable = false, length = 96)
    private String passwordHash;

    @Column(name = "phone", length = 32)
    @Convert(converter = EncryptedStringConverter.class)
    private String phone;

    @Column(name = "status", nullable = false, length = 16)
    private String status = "ACTIVE";

    @Column(name = "mfa_enabled", nullable = false)
    private boolean mfaEnabled = false;

    @Column(name = "mfa_secret", length = 64)
    private String mfaSecret;

    @Column(name = "failed_login_count", nullable = false)
    private int failedLoginCount = 0;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "last_login_ip", length = 64)
    private String lastLoginIp;

    @Column(name = "password_changed_at", nullable = false)
    private Instant passwordChangedAt = Instant.now();

    @Column(name = "password_expires_at")
    private Instant passwordExpiresAt;

    @Column(name = "must_reset_password", nullable = false)
    private boolean mustResetPassword = false;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Column(name = "gender", length = 16)
    private String gender;

    @Column(name = "locale", length = 8)
    private String locale = "en";

    @Column(name = "timezone", length = 64)
    private String timezone = "UTC";

    @Column(name = "avatar_url", length = 512)
    private String avatarUrl;

    @Override
    public UUID getId() { return id; }

    public void newId() { this.id = UUID.randomUUID(); }

    public boolean isLocked() {
        return lockedUntil != null && lockedUntil.isAfter(Instant.now());
    }
}
