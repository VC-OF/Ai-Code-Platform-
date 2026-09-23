package com.bank.identity.service;

import com.bank.identity.domain.User;
import com.bank.identity.repository.PermissionRepository;
import com.bank.identity.repository.UserRepository;
import com.bank.platform.audit.AuditService;
import com.bank.platform.security.CurrentUser;
import com.bank.platform.security.encryption.ColumnEncryptor;
import com.bank.platform.web.error.BadRequestException;
import com.bank.platform.web.error.ConflictException;
import com.bank.platform.web.error.NotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * User management operations: create, update, status changes, role
 * assignment, and lock/unlock. All mutations are recorded by
 * {@link AuditService}.
 */
@Service
public class UserService {

    private static final int MAX_FAILED_LOGINS = 5;
    private static final long LOCK_DURATION_SECONDS = 900; // 15 minutes

    private final UserRepository users;
    private final PermissionRepository permissions;
    private final PasswordEncoder passwordEncoder;
    private final ColumnEncryptor encryptor;
    private final AuditService audit;
    private final CurrentUser currentUser;

    public UserService(UserRepository users,
                       PermissionRepository permissions,
                       PasswordEncoder passwordEncoder,
                       ColumnEncryptor encryptor,
                       AuditService audit,
                       CurrentUser currentUser) {
        this.users = users;
        this.permissions = permissions;
        this.passwordEncoder = passwordEncoder;
        this.encryptor = encryptor;
        this.audit = audit;
        this.currentUser = currentUser;
    }

    @Transactional
    public User create(UUID tenantId, String username, String email, String displayName,
                       String password, UUID branchId) {
        if (users.existsByTenantIdAndUsername(tenantId, username)) {
            throw new ConflictException("USER_DUPLICATE_USERNAME", "Username already taken");
        }
        if (users.existsByTenantIdAndEmail(tenantId, email)) {
            throw new ConflictException("USER_DUPLICATE_EMAIL", "Email already in use");
        }
        if (password == null || password.length() < 12) {
            throw new BadRequestException("PASSWORD_TOO_WEAK",
                "Password must be at least 12 characters long");
        }
        User u = new User();
        u.newId();
        u.setTenantId(tenantId);
        u.setUsername(username.toLowerCase());
        u.setEmail(email.toLowerCase());
        u.setEmailEncrypted(encryptor.encrypt(email.toLowerCase()));
        u.setDisplayName(displayName);
        u.setBranchId(branchId);
        u.setPasswordHash(passwordEncoder.encode(password));
        u.setPasswordChangedAt(Instant.now());
        u.setPasswordExpiresAt(Instant.now().plusSeconds(90L * 24 * 3600));
        User saved = users.save(u);
        UUID actor = currentUser.get().map(cu -> cu.getUserId()).orElse(null);
        audit.recordAction(actor, "user.create",
            "Created user " + saved.getId() + " (" + saved.getUsername() + ")");
        return saved;
    }

    @Transactional(readOnly = true)
    public User get(UUID id) {
        return users.findById(id)
            .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND", "User " + id + " not found"));
    }

    @Transactional(readOnly = true)
    public List<String> permissionsForUser(UUID userId) {
        return permissions.findPermissionsForUser(userId).stream()
            .map(p -> p.getCode())
            .toList();
    }

    @Transactional(readOnly = true)
    public Page<User> list(UUID tenantId, Pageable pageable) {
        return users.findByTenantId(tenantId, pageable);
    }

    @Transactional(readOnly = true)
    public Page<User> search(UUID tenantId, String q, Pageable pageable) {
        return users.search(tenantId, q, pageable);
    }

    @Transactional
    public void recordLoginSuccess(UUID userId, String ip) {
        users.recordLogin(userId, Instant.now(), ip);
    }

    @Transactional
    public void recordLoginFailure(UUID userId) {
        User u = get(userId);
        int count = u.getFailedLoginCount() + 1;
        Instant lockedUntil = count >= MAX_FAILED_LOGINS
            ? Instant.now().plusSeconds(LOCK_DURATION_SECONDS)
            : null;
        users.updateFailedLoginCount(userId, count, lockedUntil);
    }

    @Transactional
    public void changePassword(UUID userId, String oldPassword, String newPassword) {
        User u = get(userId);
        if (!passwordEncoder.matches(oldPassword, u.getPasswordHash())) {
            throw new BadRequestException("BAD_PASSWORD", "Old password is incorrect");
        }
        if (newPassword == null || newPassword.length() < 12) {
            throw new BadRequestException("PASSWORD_TOO_WEAK",
                "Password must be at least 12 characters long");
        }
        u.setPasswordHash(passwordEncoder.encode(newPassword));
        u.setPasswordChangedAt(Instant.now());
        u.setPasswordExpiresAt(Instant.now().plusSeconds(90L * 24 * 3600));
        u.setMustResetPassword(false);
        users.save(u);
    }

    @Transactional
    public void unlock(UUID userId) {
        User u = get(userId);
        u.setFailedLoginCount(0);
        u.setLockedUntil(null);
        users.save(u);
    }
}
