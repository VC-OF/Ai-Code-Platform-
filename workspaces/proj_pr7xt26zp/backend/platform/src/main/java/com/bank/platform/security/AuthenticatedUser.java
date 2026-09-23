package com.bank.platform.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Principal carried in the {@link org.springframework.security.core.Authentication}
 * for an authenticated user. Wraps the minimal claim set we want to expose
 * inside the application.
 */
public class AuthenticatedUser implements UserDetails {

    private final UUID userId;
    private final UUID tenantId;
    private final UUID branchId;
    private final String username;
    private final String displayName;
    private final String email;
    private final List<String> roles;
    private final List<String> permissions;
    private final boolean mfaAuthenticated;
    private final boolean enabled;

    public AuthenticatedUser(UUID userId, UUID tenantId, UUID branchId,
                             String username, String displayName, String email,
                             List<String> roles, List<String> permissions,
                             boolean mfaAuthenticated, boolean enabled) {
        this.userId = userId;
        this.tenantId = tenantId;
        this.branchId = branchId;
        this.username = username;
        this.displayName = displayName;
        this.email = email;
        this.roles = roles;
        this.permissions = permissions;
        this.mfaAuthenticated = mfaAuthenticated;
        this.enabled = enabled;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return permissions.stream()
            .map(p -> new SimpleGrantedAuthority("PERM_" + p))
            .toList();
    }

    @Override public String getPassword() { return ""; }
    @Override public String getUsername() { return username; }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return enabled; }

    public UUID getUserId() { return userId; }
    public UUID getTenantId() { return tenantId; }
    public UUID getBranchId() { return branchId; }
    public String getDisplayName() { return displayName; }
    public String getEmail() { return email; }
    public List<String> getRoles() { return roles; }
    public List<String> getPermissions() { return permissions; }
    public boolean isMfaAuthenticated() { return mfaAuthenticated; }
}
