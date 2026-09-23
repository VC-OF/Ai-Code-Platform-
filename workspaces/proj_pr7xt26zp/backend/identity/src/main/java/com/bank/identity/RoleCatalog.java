package com.bank.identity;

import java.util.List;
import java.util.Map;

/**
 * Catalogue of every role recognised by the platform. Each role is a
 * permission bucket; concrete role-permission wiring lives in
 * {@link PermissionCatalog}.
 */
public final class RoleCatalog {

    private RoleCatalog() {}

    public static final String SCOPE_GLOBAL = "GLOBAL";
    public static final String SCOPE_TENANT = "TENANT";

    public static final String SUPER_ADMIN     = "SUPER_ADMIN";
    public static final String BANK_ADMIN      = "BANK_ADMIN";
    public static final String BRANCH_MANAGER  = "BRANCH_MANAGER";
    public static final String TELLER          = "TELLER";
    public static final String LOAN_OFFICER    = "LOAN_OFFICER";
    public static final String CUSTOMER_SERVICE = "CUSTOMER_SERVICE";
    public static final String OPERATIONS      = "OPERATIONS";
    public static final String AUDITOR         = "AUDITOR";
    public static final String CUSTOMER        = "CUSTOMER";

    public record RoleSpec(String code, String name, String description, String scope, boolean system) {}

    public static List<RoleSpec> defaults() {
        return List.of(
            new RoleSpec(SUPER_ADMIN,      "Super Administrator", "Global platform administrator",       SCOPE_GLOBAL, true),
            new RoleSpec(BANK_ADMIN,       "Bank Administrator",  "Tenant administrator",                SCOPE_TENANT, true),
            new RoleSpec(BRANCH_MANAGER,   "Branch Manager",      "Manages a single branch",              SCOPE_TENANT, true),
            new RoleSpec(TELLER,           "Teller",              "Handles cash transactions at a branch",SCOPE_TENANT, true),
            new RoleSpec(LOAN_OFFICER,     "Loan Officer",        "Manages the loan lifecycle",           SCOPE_TENANT, true),
            new RoleSpec(CUSTOMER_SERVICE, "Customer Service",    "Front-line customer support",          SCOPE_TENANT, true),
            new RoleSpec(OPERATIONS,       "Operations",          "Back-office operations",               SCOPE_TENANT, true),
            new RoleSpec(AUDITOR,          "Auditor",             "Read-only auditor",                    SCOPE_TENANT, true),
            new RoleSpec(CUSTOMER,         "Customer",            "End customer",                         SCOPE_TENANT, true)
        );
    }
}
