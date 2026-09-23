package com.bank.platform.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Convenience accessors for the current {@link AuthenticatedUser}.
 */
@Component
public class CurrentUser {

    public Optional<AuthenticatedUser> get() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a != null && a.getPrincipal() instanceof AuthenticatedUser u) {
            return Optional.of(u);
        }
        return Optional.empty();
    }

    public AuthenticatedUser require() {
        return get().orElseThrow(() ->
            new IllegalStateException("No authenticated user in security context"));
    }
}
