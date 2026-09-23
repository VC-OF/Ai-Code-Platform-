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
 * Catalog of every permission recognised by the platform. Role-permission
 * mapping lives in {@link RolePermission}.
 */
@Entity
@Table(name = "permission",
    uniqueConstraints = @UniqueConstraint(name = "uk_permission_code", columnNames = {"code"}),
    indexes = @Index(name = "idx_permission_category", columnList = "category"))
@Getter
@Setter
@NoArgsConstructor
public class Permission extends Auditable {

    @jakarta.persistence.Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "code", nullable = false, length = 96)
    private String code; // e.g. "customer.read", "transaction.create"

    @Column(name = "name", nullable = false, length = 128)
    private String name;

    @Column(name = "category", nullable = false, length = 32)
    private String category;

    @Column(name = "description", length = 256)
    private String description;

    @Override
    public UUID getId() { return id; }

    public void newId() { this.id = UUID.randomUUID(); }
}
