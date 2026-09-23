package com.bank.identity;

import java.util.List;
import java.util.Map;

/**
 * Catalogue of every permission recognised by the platform plus the
 * default role-to-permission mapping used at bootstrap.
 */
public final class PermissionCatalog {

    private PermissionCatalog() {}

    public static final String CATEGORY_CUSTOMER    = "CUSTOMER";
    public static final String CATEGORY_ACCOUNT     = "ACCOUNT";
    public static final String CATEGORY_TRANSACTION = "TRANSACTION";
    public static final String CATEGORY_BENEFICIARY = "BENEFICIARY";
    public static final String CATEGORY_LOAN        = "LOAN";
    public static final String CATEGORY_DEPOSIT     = "DEPOSIT";
    public static final String CATEGORY_CARD        = "CARD";
    public static final String CATEGORY_CHEQUE      = "CHEQUE";
    public static final String CATEGORY_REPORT      = "REPORT";
    public static final String CATEGORY_BRANCH      = "BRANCH";
    public static final String CATEGORY_EMPLOYEE    = "EMPLOYEE";
    public static final String CATEGORY_AUDIT       = "AUDIT";
    public static final String CATEGORY_SYSTEM      = "SYSTEM";

    public record PermissionSpec(String code, String name, String category, String description) {}

    public static List<PermissionSpec> all() {
        return List.of(
            // CUSTOMER
            perm("customer.read",   "View customer",     CATEGORY_CUSTOMER),
            perm("customer.create", "Create customer",   CATEGORY_CUSTOMER),
            perm("customer.update", "Update customer",   CATEGORY_CUSTOMER),
            perm("customer.delete", "Delete customer",   CATEGORY_CUSTOMER),
            // ACCOUNT
            perm("account.read",   "View account",   CATEGORY_ACCOUNT),
            perm("account.create", "Create account", CATEGORY_ACCOUNT),
            perm("account.update", "Update account", CATEGORY_ACCOUNT),
            perm("account.close",  "Close account",  CATEGORY_ACCOUNT),
            // TRANSACTION
            perm("transaction.read",   "View transaction",   CATEGORY_TRANSACTION),
            perm("transaction.create", "Create transaction", CATEGORY_TRANSACTION),
            perm("transaction.reverse", "Reverse transaction",CATEGORY_TRANSACTION),
            perm("transaction.approve", "Approve transaction",CATEGORY_TRANSACTION),
            // BENEFICIARY
            perm("beneficiary.read",   "View beneficiary",   CATEGORY_BENEFICIARY),
            perm("beneficiary.create", "Add beneficiary",    CATEGORY_BENEFICIARY),
            perm("beneficiary.update", "Edit beneficiary",   CATEGORY_BENEFICIARY),
            perm("beneficiary.delete", "Remove beneficiary", CATEGORY_BENEFICIARY),
            perm("beneficiary.verify", "Verify beneficiary", CATEGORY_BENEFICIARY),
            // LOAN
            perm("loan.read",          "View loan",          CATEGORY_LOAN),
            perm("loan.create",        "Create loan app",    CATEGORY_LOAN),
            perm("loan.approve",       "Approve loan",       CATEGORY_LOAN),
            perm("loan.disburse",      "Disburse loan",      CATEGORY_LOAN),
            perm("loan.foreclose",     "Foreclose loan",     CATEGORY_LOAN),
            // DEPOSIT
            perm("fd.read",   "View FD",  CATEGORY_DEPOSIT),
            perm("fd.create", "Create FD",CATEGORY_DEPOSIT),
            perm("fd.close",  "Close FD", CATEGORY_DEPOSIT),
            perm("rd.read",   "View RD",  CATEGORY_DEPOSIT),
            perm("rd.create", "Create RD",CATEGORY_DEPOSIT),
            // CARD
            perm("card.read",     "View card",     CATEGORY_CARD),
            perm("card.issue",    "Issue card",    CATEGORY_CARD),
            perm("card.activate", "Activate card", CATEGORY_CARD),
            perm("card.block",    "Block card",    CATEGORY_CARD),
            // CHEQUE
            perm("cheque.read",      "View cheque",      CATEGORY_CHEQUE),
            perm("cheque.issue",     "Issue cheque",     CATEGORY_CHEQUE),
            perm("cheque.stop",      "Stop payment",     CATEGORY_CHEQUE),
            perm("cheque.clear",     "Clear cheque",     CATEGORY_CHEQUE),
            // REPORT
            perm("report.customer",  "Customer report",  CATEGORY_REPORT),
            perm("report.loan",      "Loan report",      CATEGORY_REPORT),
            perm("report.revenue",   "Revenue report",   CATEGORY_REPORT),
            perm("report.branch",    "Branch report",    CATEGORY_REPORT),
            perm("report.transaction","Transaction report",CATEGORY_REPORT),
            perm("report.audit",     "Audit report",     CATEGORY_REPORT),
            // BRANCH
            perm("branch.read",   "View branch",   CATEGORY_BRANCH),
            perm("branch.create", "Create branch", CATEGORY_BRANCH),
            perm("branch.update", "Update branch", CATEGORY_BRANCH),
            // EMPLOYEE
            perm("employee.read",   "View employee",   CATEGORY_EMPLOYEE),
            perm("employee.create", "Create employee", CATEGORY_EMPLOYEE),
            perm("employee.update", "Update employee", CATEGORY_EMPLOYEE),
            // AUDIT
            perm("audit.read",      "View audit log",  CATEGORY_AUDIT),
            // SYSTEM
            perm("system.admin",    "System admin",    CATEGORY_SYSTEM),
            perm("system.config",   "System config",   CATEGORY_SYSTEM)
        );
    }

    public static Map<String, List<String>> defaultRolePermissions() {
        return Map.of(
            RoleCatalog.SUPER_ADMIN,      all().stream().map(PermissionSpec::code).toList(),
            RoleCatalog.BANK_ADMIN,       List.of(
                "customer.read","customer.create","customer.update","customer.delete",
                "account.read","account.create","account.update","account.close",
                "transaction.read","transaction.create","transaction.reverse","transaction.approve",
                "beneficiary.read","beneficiary.create","beneficiary.update","beneficiary.delete","beneficiary.verify",
                "loan.read","loan.create","loan.approve","loan.disburse","loan.foreclose",
                "fd.read","fd.create","fd.close","rd.read","rd.create",
                "card.read","card.issue","card.activate","card.block",
                "cheque.read","cheque.issue","cheque.stop","cheque.clear",
                "report.customer","report.loan","report.revenue","report.branch","report.transaction","report.audit",
                "branch.read","branch.create","branch.update",
                "employee.read","employee.create","employee.update",
                "audit.read",
                "system.config"
            ),
            RoleCatalog.BRANCH_MANAGER,   List.of(
                "customer.read","customer.create","customer.update",
                "account.read","account.create","account.update","account.close",
                "transaction.read","transaction.create","transaction.approve",
                "beneficiary.read","beneficiary.create","beneficiary.update","beneficiary.delete","beneficiary.verify",
                "loan.read",
                "fd.read","fd.create","fd.close","rd.read","rd.create",
                "card.read","card.issue","card.activate","card.block",
                "cheque.read","cheque.issue","cheque.stop","cheque.clear",
                "report.branch","report.transaction",
                "branch.read","employee.read"
            ),
            RoleCatalog.TELLER,           List.of(
                "customer.read",
                "account.read","account.update",
                "transaction.read","transaction.create",
                "beneficiary.read",
                "cheque.read","cheque.clear",
                "branch.read"
            ),
            RoleCatalog.LOAN_OFFICER,     List.of(
                "customer.read",
                "account.read",
                "transaction.read",
                "loan.read","loan.create","loan.approve",
                "report.loan"
            ),
            RoleCatalog.CUSTOMER_SERVICE, List.of(
                "customer.read","customer.update",
                "account.read",
                "transaction.read",
                "beneficiary.read","beneficiary.create","beneficiary.update","beneficiary.delete",
                "card.read","card.activate","card.block",
                "cheque.read"
            ),
            RoleCatalog.OPERATIONS,       List.of(
                "customer.read",
                "account.read","account.create","account.update","account.close",
                "transaction.read","transaction.create","transaction.approve","transaction.reverse",
                "loan.read","loan.disburse",
                "fd.read","fd.create","fd.close","rd.read","rd.create",
                "card.read","card.issue","card.activate","card.block",
                "cheque.read","cheque.issue","cheque.stop","cheque.clear",
                "report.customer","report.loan","report.revenue","report.branch","report.transaction",
                "branch.read","employee.read"
            ),
            RoleCatalog.AUDITOR,          List.of(
                "customer.read","account.read","transaction.read",
                "loan.read","fd.read","rd.read","card.read","cheque.read",
                "report.customer","report.loan","report.revenue","report.branch","report.transaction","report.audit",
                "branch.read","employee.read","audit.read"
            ),
            RoleCatalog.CUSTOMER,         List.of(
                "customer.read","customer.update",
                "account.read",
                "transaction.read","transaction.create",
                "beneficiary.read","beneficiary.create","beneficiary.update","beneficiary.delete",
                "loan.read",
                "fd.read","fd.create","rd.read","rd.create",
                "card.read","card.activate","card.block",
                "cheque.read"
            )
        );
    }

    private static PermissionSpec perm(String code, String name, String category) {
        return new PermissionSpec(code, name, category, name);
    }
}
