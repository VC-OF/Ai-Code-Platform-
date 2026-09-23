package com.bank.platform.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Domain-facing authorization checks. Callers ask "may I do X?" rather than
 * building complex SpEL expressions.
 */
@Component
public class AuthorizationService {

    public void requirePermission(String permission) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getPrincipal() == null) {
            throw new AccessDeniedException("Not authenticated");
        }
        boolean granted = auth.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("PERM_" + permission)
                        || a.getAuthority().equals("ROLE_SUPER_ADMIN"));
        if (!granted) {
            throw new AccessDeniedException("Missing permission: " + permission);
        }
    }

    public boolean hasPermission(String permission) {
        try {
            requirePermission(permission);
            return true;
        } catch (AccessDeniedException e) {
            return false;
        }
    }

    public void requireRole(String role) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            throw new AccessDeniedException("Not authenticated");
        }
        boolean ok = auth.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals("ROLE_" + role));
        if (!ok) {
            throw new AccessDeniedException("Missing role: " + role);
        }
    }
}
