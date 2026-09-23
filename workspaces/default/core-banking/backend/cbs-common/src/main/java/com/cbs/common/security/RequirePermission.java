package com.cbs.common.security;

import org.springframework.security.access.prepost.PreAuthorize;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Annotation to require a specific permission. The {@link PermissionAspect}
 * resolves the {@code PERM_*} granted authority and throws
 * {@code AccessDeniedException} if missing.
 *
 * <p>Use as {@code @RequirePermission("users.read")}.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@PreAuthorize("hasAuthority('PERM_#permission')")
public @interface RequirePermission {
    String value();
}
