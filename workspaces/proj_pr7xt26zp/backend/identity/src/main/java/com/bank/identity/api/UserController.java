package com.bank.identity.api;

import com.bank.identity.api.dto.AssignRoleRequest;
import com.bank.identity.api.dto.UserCreateRequest;
import com.bank.identity.api.dto.UserResponse;
import com.bank.identity.domain.Role;
import com.bank.identity.domain.User;
import com.bank.identity.service.RoleAssignmentService;
import com.bank.identity.service.UserService;
import com.bank.platform.api.dto.PageRequest;
import com.bank.platform.api.dto.PageResponse;
import com.bank.platform.security.AuthorizationService;
import com.bank.platform.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users")
@Tag(name = "Users", description = "User management endpoints")
public class UserController {

    private final UserService users;
    private final RoleAssignmentService roles;
    private final AuthorizationService authz;
    private final CurrentUser currentUser;

    public UserController(UserService users, RoleAssignmentService roles,
                          AuthorizationService authz, CurrentUser currentUser) {
        this.users = users;
        this.roles = roles;
        this.authz = authz;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "List users")
    public PageResponse<UserResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "asc") String sortDir,
            @RequestParam(required = false) String q) {
        authz.requirePermission("customer.read");
        var user = currentUser.require();
        PageRequest req = new PageRequest(page, size, sortBy, sortDir, q);
        Page<User> p = req.hasSearch()
            ? users.search(user.getTenantId(), req.search(), req.toSpringPageRequest())
            : users.list(user.getTenantId(), req.toSpringPageRequest());
        return new PageResponse<>(
            p.getContent().stream().map(u -> UserResponse.from(u, List.of())).toList(),
            p.getTotalElements(), p.getTotalPages(), p.getNumber(), p.getSize(),
            p.hasNext(), p.hasPrevious(),
            new PageResponse.Sort(sortBy, sortDir.toUpperCase())
        );
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get user by id")
    public UserResponse get(@PathVariable UUID id) {
        authz.requirePermission("customer.read");
        User u = users.get(id);
        var roleCodes = roles.rolesForUser(u.getId()).stream().map(Role::getCode).toList();
        return UserResponse.from(u, roleCodes);
    }

    @PostMapping
    @Operation(summary = "Create a new user")
    public ResponseEntity<UserResponse> create(@Valid @RequestBody UserCreateRequest req) {
        authz.requirePermission("customer.create");
        var user = currentUser.require();
        User u = users.create(
            user.getTenantId(),
            req.username(),
            req.email(),
            req.displayName(),
            req.password(),
            req.branchId(),
            req.roleCode(),
            user.getUsername()
        );
        if (req.roleCode() != null) {
            roles.assign(u.getId(), req.roleCode(), req.branchId(), user.getUsername());
        }
        return ResponseEntity.created(URI.create("/api/v1/users/" + u.getId()))
            .body(UserResponse.from(u, List.of(req.roleCode())));
    }

    @PostMapping("/{id}/roles")
    @Operation(summary = "Assign a role to a user")
    public ResponseEntity<Void> assignRole(@PathVariable UUID id,
                                           @Valid @RequestBody AssignRoleRequest req) {
        authz.requirePermission("customer.update");
        roles.assign(id, req.roleCode(), req.branchId(), currentUser.require().getUsername());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}/roles/{roleCode}")
    @Operation(summary = "Revoke a role from a user")
    public ResponseEntity<Void> revokeRole(@PathVariable UUID id, @PathVariable String roleCode) {
        authz.requirePermission("customer.update");
        roles.revoke(id, roleCode);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/permissions")
    @Operation(summary = "List a user's effective permissions")
    public List<String> permissions(@PathVariable UUID id) {
        authz.requirePermission("customer.read");
        return users.permissionsForUser(id);
    }

    @PostMapping("/{id}/unlock")
    @Operation(summary = "Unlock a user account")
    public ResponseEntity<Void> unlock(@PathVariable UUID id) {
        authz.requirePermission("customer.update");
        users.unlock(id);
        return ResponseEntity.noContent().build();
    }
}
