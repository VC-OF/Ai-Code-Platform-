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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalTime;
import java.util.UUID;

/**
 * A branch of a tenant (e.g. a physical bank branch or a virtual branch).
 * Holds the IFSC, address, working hours, and the current cash position.
 */
@Entity
@Table(name = "branch",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_branch_tenant_ifsc", columnNames = {"tenant_id", "ifsc"}),
        @UniqueConstraint(name = "uk_branch_tenant_code", columnNames = {"tenant_id", "code"})
    },
    indexes = {
        @Index(name = "idx_branch_tenant", columnList = "tenant_id"),
        @Index(name = "idx_branch_status", columnList = "status")
    })
@Getter
@Setter
@NoArgsConstructor
public class Branch extends Auditable {

    @jakarta.persistence.Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "code", nullable = false, length = 16)
    private String code;

    @Column(name = "name", nullable = false, length = 128)
    private String name;

    @Column(name = "ifsc", nullable = false, length = 11)
    private String ifsc;

    @Column(name = "micr", length = 9)
    private String micr;

    @Column(name = "email", length = 128)
    private String email;

    @Column(name = "phone", length = 32)
    @Convert(converter = EncryptedStringConverter.class)
    private String phone;

    @Column(name = "address_line1", nullable = false, length = 256)
    private String addressLine1;

    @Column(name = "address_line2", length = 256)
    private String addressLine2;

    @Column(name = "city", nullable = false, length = 64)
    private String city;

    @Column(name = "state", nullable = false, length = 64)
    private String state;

    @Column(name = "postal_code", nullable = false, length = 16)
    private String postalCode;

    @Column(name = "country_code", nullable = false, length = 2)
    private String countryCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "working_hours", columnDefinition = "jsonb")
    private String workingHoursJson;

    @Column(name = "open_time")
    private LocalTime openTime;

    @Column(name = "close_time")
    private LocalTime closeTime;

    @Column(name = "manager_user_id")
    private UUID managerUserId;

    @Column(name = "status", nullable = false, length = 16)
    private String status = "ACTIVE";

    @Column(name = "cash_balance_minor", nullable = false)
    private long cashBalanceMinor = 0;

    @Column(name = "cash_currency", nullable = false, length = 3)
    private String cashCurrency = "USD";

    @Override
    public UUID getId() { return id; }

    public void newId() { this.id = UUID.randomUUID(); }
}
