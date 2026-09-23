package com.bank.identity.domain;

import com.bank.platform.domain.Auditable;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

/**
 * A role is a named bucket of permissions. Roles are tenant-scoped to allow
 * per-bank customisation of access. The super-admin role is global and
 * lives in {@link Role#scope} = "GLOBAL".
 */
@Entity
@Table(name = "role",
    uniqueConstraints = @UniqueConstraint(name = "uk_role_tenant_code",
        columnNames = {"tenant_id", "code"}),
    indexes = @Index(name = "idx_role_tenant", columnList = "tenant_id"))
@Getter
@Setter
@NoArgsConstructor
public class Role extends Auditable {

    @jakarta.persistence.Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId; // null for global roles like SUPER_ADMIN

    @Column(name = "code", nullable = false, length = 32)
    private String code;

    @Column(name = "name", nullable = false, length = 96)
    private String name;

    @Column(name = "description", length = 256)
    private String description;

    @Column(name = "scope", nullable = false, length = 16)
    private String scope = "TENANT"; // GLOBAL | TENANT

    @Column(name = "is_system", nullable = false)
    private boolean system = false;

    @Override
    public UUID getId() { return id; }

    public void newId() { this.id = UUID.randomUUID(); }
}
