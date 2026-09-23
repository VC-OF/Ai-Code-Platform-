package com.bank.identity.service;

import com.bank.identity.PermissionCatalog;
import com.bank.identity.RoleCatalog;
import com.bank.identity.domain.Permission;
import com.bank.identity.domain.Role;
import com.bank.identity.domain.RolePermission;
import com.bank.identity.domain.RolePermissionId;
import com.bank.identity.repository.PermissionRepository;
import com.bank.identity.repository.RolePermissionRepository;
import com.bank.identity.repository.RoleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Bootstraps the role and permission catalogues on first launch and keeps
 * them synchronised on subsequent restarts. Idempotent: existing rows are
 * updated rather than duplicated.
 */
@Service
public class RoleBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(RoleBootstrapService.class);

    private final RoleRepository roles;
    private final PermissionRepository permissions;
    private final RolePermissionRepository rolePermissions;

    public RoleBootstrapService(RoleRepository roles,
                                PermissionRepository permissions,
                                RolePermissionRepository rolePermissions) {
        this.roles = roles;
        this.permissions = permissions;
        this.rolePermissions = rolePermissions;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void seed() {
        seedPermissions();
        seedRoles();
        seedRolePermissions();
    }

    private void seedPermissions() {
        for (var spec : PermissionCatalog.all()) {
            Permission existing = permissions.findByCode(spec.code()).orElseGet(() -> {
                Permission p = new Permission();
                p.newId();
                p.setCode(spec.code());
                return p;
            });
            existing.setName(spec.name());
            existing.setCategory(spec.category());
            existing.setDescription(spec.description());
            permissions.save(existing);
        }
    }

    private void seedRoles() {
        for (var spec : RoleCatalog.defaults()) {
            Role role = roles.findByCodeAndScope(spec.code(), spec.scope())
                .orElseGet(() -> {
                    Role r = new Role();
                    r.newId();
                    r.setCode(spec.code());
                    r.setScope(spec.scope());
                    return r;
                });
            role.setName(spec.name());
            role.setDescription(spec.description());
            role.setSystem(spec.system());
            if (RoleCatalog.SCOPE_GLOBAL.equals(spec.scope())) {
                role.setTenantId(null);
            } else {
                role.setTenantId(UUID.fromString("00000000-0000-0000-0000-000000000001"));
            }
            roles.save(role);
        }
    }

    private void seedRolePermissions() {
        Map<String, List<String>> map = PermissionCatalog.defaultRolePermissions();
        for (var entry : map.entrySet()) {
            Role role = roles.findByCodeAndScope(entry.getKey(), RoleCatalog.SCOPE_GLOBAL)
                .or(() -> roles.findByCodeAndScope(entry.getKey(), RoleCatalog.SCOPE_TENANT))
                .orElseThrow(() -> new IllegalStateException("Role not seeded: " + entry.getKey()));
            Set<UUID> desired = new HashSet<>();
            for (String code : entry.getValue()) {
                Permission p = permissions.findByCode(code)
                    .orElseThrow(() -> new IllegalStateException("Permission not seeded: " + code));
                desired.add(p.getId());
            }
            List<RolePermission> current = rolePermissions.findByRoleId(role.getId());
            for (var rp : current) {
                if (!desired.contains(rp.getId().getPermissionId())) {
                    rolePermissions.delete(rp);
                }
            }
            Set<UUID> have = new HashSet<>();
            current.forEach(rp -> have.add(rp.getId().getPermissionId()));
            for (UUID permissionId : desired) {
                if (!have.contains(permissionId)) {
                    RolePermission rp = new RolePermission();
                    rp.setId(new RolePermissionId(role.getId(), permissionId));
                    rolePermissions.save(rp);
                }
            }
        }
        log.info("Role/permission bootstrap complete");
    }
}
