package com.cbs.usermgmt.role;

import com.cbs.usermgmt.role.domain.Permission;
import com.cbs.usermgmt.role.domain.PermissionRepository;
import com.cbs.usermgmt.role.domain.Role;
import com.cbs.usermgmt.role.domain.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Seeds default roles and permissions on first start-up. The list of
 * permissions here is the source of truth — it is referenced by
 * {@code @RequirePermission} annotations across the codebase.
 */
@Component
@RequiredArgsConstructor
public class PermissionCatalogSeeder {

    private final PermissionRepository permissionRepository;
    private final RoleRepository roleRepository;

    /** All permissions recognised by the system. */
    public static final List<PermissionDef> PERMISSIONS = List.of(
            new PermissionDef("users.read", "View users", "USER"),
            new PermissionDef("users.write", "Create/edit users", "USER"),
            new PermissionDef("users.delete", "Delete users", "USER"),
            new PermissionDef("users.assign_roles", "Assign roles to users", "USER"),

            new PermissionDef("roles.read", "View roles", "ROLE"),
            new PermissionDef("roles.write", "Create/edit roles", "ROLE"),
            new PermissionDef("roles.delete", "Delete roles", "ROLE"),

            new PermissionDef("branches.read", "View branches", "BRANCH"),
            new PermissionDef("branches.write", "Create/edit branches", "BRANCH"),
            new PermissionDef("branches.delete", "Delete branches", "BRANCH"),

            new PermissionDef("employees.read", "View employees", "EMPLOYEE"),
            new PermissionDef("employees.write", "Create/edit employees", "EMPLOYEE"),
            new PermissionDef("employees.salary.read", "View employee salaries", "EMPLOYEE"),

            new PermissionDef("dashboard.read", "View analytics dashboard", "DASHBOARD"),

            new PermissionDef("customers.read", "View customers", "CUSTOMER"),
            new PermissionDef("customers.write", "Create/edit customers", "CUSTOMER"),
            new PermissionDef("customers.kyc.approve", "Approve KYC", "CUSTOMER"),

            new PermissionDef("accounts.read", "View accounts", "ACCOUNT"),
            new PermissionDef("accounts.write", "Create/edit accounts", "ACCOUNT"),
            new PermissionDef("accounts.freeze", "Freeze/unfreeze accounts", "ACCOUNT"),
            new PermissionDef("accounts.close", "Close accounts", "ACCOUNT"),

            new PermissionDef("transactions.read", "View transactions", "TRANSACTION"),
            new PermissionDef("transactions.deposit", "Process deposits", "TRANSACTION"),
            new PermissionDef("transactions.withdraw", "Process withdrawals", "TRANSACTION"),
            new PermissionDef("transactions.transfer", "Initiate transfers", "TRANSACTION"),
            new PermissionDef("transactions.reverse", "Reverse transactions", "TRANSACTION"),

            new PermissionDef("loans.read", "View loans", "LOAN"),
            new PermissionDef("loans.write", "Create loan applications", "LOAN"),
            new PermissionDef("loans.approve", "Approve loans", "LOAN"),
            new PermissionDef("loans.disburse", "Disburse loans", "LOAN"),

            new PermissionDef("fd.read", "View FDs", "FD"),
            new PermissionDef("fd.write", "Create FDs", "FD"),

            new PermissionDef("rd.read", "View RDs", "RD"),
            new PermissionDef("rd.write", "Create RDs", "RD"),

            new PermissionDef("cards.read", "View cards", "CARD"),
            new PermissionDef("cards.write", "Issue cards", "CARD"),
            new PermissionDef("cards.block", "Block cards", "CARD"),

            new PermissionDef("cheques.read", "View cheques", "CHEQUE"),
            new PermissionDef("cheques.stop", "Stop payment", "CHEQUE"),

            new PermissionDef("beneficiaries.read", "View beneficiaries", "BENEFICIARY"),
            new PermissionDef("beneficiaries.write", "Manage beneficiaries", "BENEFICIARY"),

            new PermissionDef("notifications.read", "View notifications", "NOTIFICATION"),
            new PermissionDef("notifications.send", "Send notifications", "NOTIFICATION"),

            new PermissionDef("reports.read", "View reports", "REPORT"),
            new PermissionDef("reports.generate", "Generate reports", "REPORT"),

            new PermissionDef("audit.read", "View audit logs", "AUDIT"),
            new PermissionDef("audit.export", "Export audit logs", "AUDIT")
    );

    /** Default roles and the permissions they receive. */
    private static final Map<String, Set<String>> DEFAULT_ROLES = Map.of(
            "SUPER_ADMIN", Set.of(".*"),
            "BANK_ADMIN", Set.of(
                    "users.*", "roles.read", "branches.*", "employees.*",
                    "dashboard.*", "customers.*", "accounts.*", "transactions.*",
                    "loans.*", "fd.*", "rd.*", "cards.*", "cheques.*",
                    "beneficiaries.*", "notifications.*", "reports.*", "audit.*"
            ),
            "BRANCH_MANAGER", Set.of(
                    "users.read", "branches.read", "employees.read",
                    "dashboard.*", "customers.*", "accounts.*", "transactions.*",
                    "loans.read", "loans.approve", "fd.*", "rd.*",
                    "cards.read", "cheques.read", "beneficiaries.*",
                    "notifications.*", "reports.*", "audit.read"
            ),
            "TELLER", Set.of(
                    "dashboard.read", "customers.read", "accounts.read",
                    "transactions.deposit", "transactions.withdraw",
                    "transactions.read", "beneficiaries.read", "notifications.read"
            ),
            "LOAN_OFFICER", Set.of(
                    "dashboard.read", "customers.read", "accounts.read",
                    "loans.*", "fd.read", "rd.read", "notifications.read", "reports.read"
            ),
            "CUSTOMER_SERVICE", Set.of(
                    "dashboard.read", "customers.read", "customers.write",
                    "accounts.read", "transactions.read",
                    "cards.read", "cards.block", "cheques.*",
                    "beneficiaries.*", "notifications.*", "reports.read"
            ),
            "OPERATIONS", Set.of(
                    "dashboard.*", "branches.read", "employees.read",
                    "accounts.*", "transactions.read", "transactions.reverse",
                    "loans.read", "cards.*", "cheques.*", "reports.*", "audit.*"
            ),
            "AUDITOR", Set.of(
                    "dashboard.read", "audit.*", "reports.*", "transactions.read",
                    "accounts.read", "loans.read", "customers.read"
            ),
            "CUSTOMER", Set.of(
                    "accounts.read", "transactions.read", "transactions.transfer",
                    "beneficiaries.*", "fd.read", "rd.read",
                    "cards.read", "cheques.read", "notifications.read"
            )
    );

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void seed() {
        // 1. Seed permissions
        var existing = permissionRepository.findAll().stream()
                .map(Permission::getCode).toList();
        for (PermissionDef def : PERMISSIONS) {
            if (!existing.contains(def.code)) {
                permissionRepository.save(Permission.builder()
                        .code(def.code)
                        .name(def.name)
                        .category(def.category)
                        .description(def.name)
                        .build());
            }
        }
        // 2. Seed roles
        var allPermissions = permissionRepository.findAll();
        for (var entry : DEFAULT_ROLES.entrySet()) {
            String roleCode = entry.getKey();
            Role role = roleRepository.findByCode(roleCode).orElseGet(() ->
                    roleRepository.save(Role.builder()
                            .code(roleCode)
                            .name(humanize(roleCode))
                            .description("Built-in role: " + humanize(roleCode))
                            .scope(mapScope(roleCode))
                            .system(true)
                            .build())
            );
            // 3. Assign matching permissions
            for (Permission p : allPermissions) {
                boolean matches = entry.getValue().stream().anyMatch(pat ->
                        p.getCode().equals(pat) ||
                        (pat.endsWith(".*") && p.getCode().startsWith(pat.substring(0, pat.length() - 2)))
                );
                if (matches) {
                    role.getPermissions().add(p);
                }
            }
            roleRepository.save(role);
        }
    }

    private static Role.RoleScope mapScope(String code) {
        return switch (code) {
            case "SUPER_ADMIN", "BANK_ADMIN" -> Role.RoleScope.GLOBAL;
            case "CUSTOMER" -> Role.RoleScope.SELF;
            default -> Role.RoleScope.BRANCH;
        };
    }

    private static String humanize(String code) {
        StringBuilder sb = new StringBuilder();
        for (String part : code.toLowerCase().split("_")) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return sb.toString();
    }

    public record PermissionDef(String code, String name, String category) {
    }
}
