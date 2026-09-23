package com.cbs.usermgmt.role.domain;

import com.cbs.kernel.domain.base.AbstractAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * System role. Roles group permissions and are assigned to users.
 * Built-in roles (SUPER_ADMIN, BANK_ADMIN, etc.) are seeded on startup
 * and cannot be deleted.
 */
@Entity
@Table(name = "roles", uniqueConstraints = {
        @UniqueConstraint(name = "uk_roles_code", columnNames = "code")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Role extends AbstractAuditableEntity {

    @Column(name = "code", nullable = false, length = 50)
    private String code;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "description", length = 500)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "scope", nullable = false, length = 20)
    private RoleScope scope;

    @Column(name = "system", nullable = false)
    private boolean system;

    public enum RoleScope {
        /** Super admin: full access. */
        GLOBAL,
        /** Branch-scoped: access limited to a single branch. */
        BRANCH,
        /** Self-service: only own data. */
        SELF
    }
}
