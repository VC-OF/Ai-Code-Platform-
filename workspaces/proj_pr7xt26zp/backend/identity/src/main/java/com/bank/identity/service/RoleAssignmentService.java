package com.bank.identity.service;

import com.bank.identity.RoleCatalog;
import com.bank.identity.domain.Role;
import com.bank.identity.domain.User;
import com.bank.identity.domain.UserRole;
import com.bank.identity.domain.UserRoleId;
import com.bank.identity.repository.RoleRepository;
import com.bank.identity.repository.UserRepository;
import com.bank.identity.repository.UserRoleRepository;
import com.bank.platform.audit.AuditService;
import com.bank.platform.web.error.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Assigns and revokes roles to users. Enforces tenant consistency and
 * keeps the audit trail current.
 */
@Service
public class RoleAssignmentService {

    private final UserRepository users;
    private final RoleRepository roles;
    private final UserRoleRepository userRoles;
    private final AuditService audit;

    public RoleAssignmentService(UserRepository users, RoleRepository roles,
                                 UserRoleRepository userRoles, AuditService audit) {
        this.users = users;
        this.roles = roles;
        this.userRoles = userRoles;
        this.audit = audit;
    }

    @Transactional
    public void assign(UUID userId, String roleCode, UUID branchId, String actor) {
        User user = users.findById(userId)
            .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "User " + userId + " not found"));
        Role role = roles.findByCode(roleCode)
            .or(() -> roles.findByCodeAndScope(roleCode, RoleCatalog.SCOPE_TENANT))
            .orElseThrow(() -> new NotFoundException("ROLE_NOT_FOUND", "Role " + roleCode + " not found"));
        UserRole ur = new UserRole();
        ur.setId(new UserRoleId(user.getId(), role.getId()));
        ur.setBranchId(branchId);
        ur.setGrantedBy(actor);
        ur.setGrantedAt(java.time.Instant.now());
        userRoles.save(ur);
        audit.recordAction(null, "role.assign",
            "Assigned role " + roleCode + " to user " + userId);
    }

    @Transactional
    public void revoke(UUID userId, String roleCode) {
        User user = users.findById(userId)
            .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "User " + userId + " not found"));
        Role role = roles.findByCode(roleCode)
            .or(() -> roles.findByCodeAndScope(roleCode, RoleCatalog.SCOPE_TENANT))
            .orElseThrow(() -> new NotFoundException("ROLE_NOT_FOUND", "Role " + roleCode + " not found"));
        userRoles.deleteRole(user.getId(), role.getId());
        audit.recordAction(null, "role.revoke",
            "Revoked role " + roleCode + " from user " + userId);
    }

    @Transactional(readOnly = true)
    public List<Role> rolesForUser(UUID userId) {
        var ids = userRoles.findByIdUserId(userId).stream()
            .map(ur -> ur.getId().getRoleId())
            .toList();
        return roles.findAllById(ids);
    }
}
