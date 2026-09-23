# Phase 1 · Module Breakdown

The backend is organized as a **Maven multi-module project**. Each Maven module is a
bounded context. Frontend features mirror the same boundaries.

> **Rule:** Modules communicate only through their public `api` package (DTOs + ports).
> Internal packages are not accessible to other modules (enforced by ArchUnit tests in CI).

---

## Module Map

| #   | Module             | Maven artifact          | Bounded Context    | Public Capabilities                                                        |
| --- | ------------------ | ----------------------- | ------------------ | -------------------------------------------------------------------------- |
| 0   | `common`           | `cbp-common`            | Cross-cutting      | Money, Page, Result, exceptions, i18n, base entities, utilities            |
| 1   | `auth`             | `cbp-auth`              | Identity & Access  | Login, logout, refresh, password reset, MFA, device tracking, sessions     |
| 2   | `user`             | `cbp-user`              | User & RBAC        | Users, roles, permissions, employees                                       |
| 3   | `branch`           | `cbp-branch`            | Branches           | Branches, branch employees, working hours, cash drawer                     |
| 4   | `customer`         | `cbp-customer`          | Customer (KYC)     | Customer CRUD, KYC, nominees, documents, timeline                          |
| 5   | `account`          | `cbp-account`           | Accounts           | Savings/Current/Salary/NRE/NRO/FD/RD, balance, interest posting            |
| 6   | `transaction`      | `cbp-transaction`       | Money Movement     | Deposits, withdrawals, transfers, UPI/NEFT/RTGS/IMPS, charges              |
| 7   | `beneficiary`      | `cbp-beneficiary`       | Beneficiaries      | Add/edit/delete/verify/favorite beneficiaries                              |
| 8   | `loan`             | `cbp-loan`              | Lending            | Personal/Home/Vehicle/Business/Education/Gold, EMI, repayment, foreclosure |
| 9   | `fixeddeposit`     | `cbp-fixed-deposit`     | Term Deposits      | FD create, premature closure, renewal, interest calculation                |
| 10  | `recurringdeposit` | `cbp-recurring-deposit` | Recurring Deposits | RD create, auto-debit, missed installment handling, maturity               |
| 11  | `card`             | `cbp-card`              | Cards              | Debit/credit card lifecycle, PIN, limits, block, replace                   |
| 12  | `cheque`           | `cbp-cheque`            | Cheques            | Cheque book request, stop payment, status, clearing                        |
| 13  | `notification`     | `cbp-notification`      | Notifications      | Email/SMS/Push/In-app send, templates, outbox                              |
| 14  | `report`           | `cbp-report`            | Reports            | Customer/loan/revenue/audit/branch/transaction reports, PDF/Excel/CSV      |
| 15  | `audit`            | `cbp-audit`             | Audit Trail        | Audit log writer + reader                                                  |
| 16  | `dashboard`        | `cbp-dashboard`         | Analytics          | KPIs, charts, branch performance                                           |
| 17  | `bootstrap`        | `cbp-bootstrap`         | Composition root   | Spring Boot main, configuration, module wiring, Flyway bootstrap           |

The `bootstrap` module is the only one that depends on **all** other modules; everything else
depends only on `common` and (selectively) other modules' `api` packages.

---

## Module Responsibilities

### `common`

- `Money`, `Currency` value types
- `PageRequest`, `PageResponse<T>`, `Sort`
- `Result<T, E>` for explicit success/failure
- `DomainException` hierarchy + `Problem` (RFC 7807) builder
- `BaseEntity` (audit columns, soft delete, version)
- `I18nMessageResolver`
- Common validators (PAN, Aadhaar, IFSC, account number, email, phone)

### `auth`

- `JwtService` (sign/verify access + refresh)
- `RefreshTokenService` (Redis)
- `PasswordService` (BCrypt)
- `MfaService` (TOTP, pluggable)
- `DeviceService` (fingerprint, trust)
- `SessionService` (Redis-backed, multi-device)
- `LoginAttemptService` (rate limit, lockout)
- REST: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/mfa/verify`, `POST /auth/devices`

### `user`

- `User` aggregate (links to `Employee` and/or `Customer`)
- `Role` (static set + admin-defined)
- `Permission` (granular, e.g. `ACCOUNT_CREATE`, `LOAN_APPROVE`)
- `RolePermission` join
- `UserRole`
- REST: `/users`, `/roles`, `/permissions`

### `branch`

- `Branch` (code, name, IFSC, address, manager, working hours, cash balance, status)
- `BranchEmployee` (link)
- `BranchCashDrawer` (denormalized, locked by `branch_id` + `currency`)
- REST: `/branches`, `/branches/{id}/employees`, `/branches/{id}/cash`

### `customer`

- `Customer` (KYC, demographics, risk, credit score)
- `CustomerAddress`, `CustomerNominee`, `CustomerDocument`, `CustomerTimelineEvent`
- `KycStatus` enum
- REST: `/customers`, `/customers/{id}/addresses`, `/customers/{id}/nominees`, `/customers/{id}/documents`, `/customers/{id}/timeline`

### `account`

- `Account` (polymorphic by `account_type`): SAVINGS, CURRENT, SALARY, NRE, NRO, FD, RD
- `AccountInterestLedger`
- `AccountStatus` enum
- `Statement` projection
- REST: `/accounts`, `/accounts/{id}/statement`, `/accounts/{id}/interest`

### `transaction`

- `Transaction` (deposit, withdrawal, internal_transfer, upi, neft, rtgs, imps, card_payment, interest_credit, service_charge)
- `TransactionStatus` (PENDING, SUCCESS, FAILED, REVERSED)
- `LedgerEntry` (double-entry style for transfers)
- `DailyLimit`, `TransactionLimit` per account/customer
- `OtpVerification` (per-transaction OTP)
- `BeneficiaryValidation` (account name verification)
- `Receipt` (PDF generation)
- REST: `/transactions/deposit`, `/transactions/withdraw`, `/transactions/transfer`, `/transactions/{id}`, `/transactions/{id}/receipt`

### `beneficiary`

- `Beneficiary` (per customer, per transfer mode)
- `BeneficiaryStatus` (PENDING_VERIFICATION, VERIFIED, INACTIVE, FAVORITE)
- REST: `/beneficiaries`

### `loan`

- `LoanProduct` (per loan type, with rate, term, fees)
- `LoanApplication` (workflow: SUBMITTED → CREDIT_CHECK → RISK_ASSESSMENT → APPROVED/REJECTED → DISBURSED → ACTIVE → CLOSED)
- `LoanAccount` (post-disbursement)
- `LoanRepaymentSchedule` (EMI schedule)
- `LoanRepayment` (installments)
- `LoanForeclosureRequest`
- REST: `/loans/products`, `/loans/applications`, `/loans/{id}/approve`, `/loans/{id}/disburse`, `/loans/{id}/repayments`, `/loans/{id}/foreclose`

### `fixeddeposit`

- `FixedDeposit` (principal, rate, tenure, maturity_date, status)
- `FdInterestRate` (slab-based)
- `FdPrematureClosure`
- `FdRenewal`
- REST: `/fixed-deposits`, `/fixed-deposits/{id}/close`, `/fixed-deposits/{id}/renew`

### `recurringdeposit`

- `RecurringDeposit` (monthly_installment, tenure, status)
- `RdInstallment` (PAID, MISSED)
- `RdMaturity`
- `AutoDebitMandate`
- REST: `/recurring-deposits`, `/recurring-deposits/{id}/installments`

### `card`

- `Card` (DEBIT, CREDIT)
- `CardStatus` (ISSUED, ACTIVE, BLOCKED, REPLACED, EXPIRED)
- `CardPin` (hashed, never stored plain)
- `CardLimit`
- `CardReplacementRequest`
- REST: `/cards`, `/cards/{id}/activate`, `/cards/{id}/block`, `/cards/{id}/replace`, `/cards/{id}/pin`

### `cheque`

- `ChequeBook` (series, leaf count, status)
- `ChequeLeaf` (per-cheque, status: ISSUED, CLEARED, BOUNCED, STOPPED, EXPIRED)
- `StopPaymentRequest`
- `ChequeClearingBatch`
- REST: `/cheque-books`, `/cheque-books/{id}/leaves`, `/cheque-leaves/{id}/stop-payment`

### `notification`

- `NotificationTemplate` (per channel, per event)
- `Notification` (outbox)
- `NotificationDispatchLog`
- REST (admin): `/notifications/templates`, `/notifications/{id}/resend`
- Triggers: domain events from other modules

### `report`

- `ReportDefinition` (name, query, format, params)
- `ReportRun` (history)
- Adapters: `PdfReportRenderer` (OpenPDF), `ExcelReportRenderer` (Apache POI), `CsvReportRenderer`
- REST: `/reports`, `/reports/{id}/run?format=pdf`

### `audit`

- `AuditLog` (writer used by all modules via Spring event)
- `AuditReaderService` (auditor role only)
- REST: `/audit-logs?entity=...&entityId=...&from=...&to=...`

### `dashboard`

- `DashboardService` (aggregates from multiple modules)
- KPIs: customers, accounts, deposits, withdrawals, transactions, loans, revenue, branch performance
- Charts: monthly txns, customer growth, loan portfolio, revenue, deposits vs withdrawals
- REST: `/dashboard/summary`, `/dashboard/charts/{name}`

### `bootstrap`

- `Application` main class
- `application.yml` + profile-specific overrides
- `WebSecurityConfig`, `OpenApiConfig`, `CorsConfig`, `RateLimitConfig`
- Flyway baseline migration (`V000__init.sql` is created in Phase 2 when actual DDL lands; Phase 1 only documents the schema)

---

## Frontend Module Mirroring

```
frontend/src/
├── app/                      # bootstrapping, providers, router
├── shared/                   # UI kit wrappers, hooks, utils, i18n
│   ├── ui/                   # shadcn-based primitives
│   ├── components/           # AppShell, DataTable, Charts wrappers
│   ├── hooks/
│   ├── lib/                  # axios client, formatters, money
│   └── i18n/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── customers/
│   ├── branches/
│   ├── employees/
│   ├── accounts/
│   ├── transactions/
│   ├── beneficiaries/
│   ├── loans/
│   ├── fixed-deposits/
│   ├── recurring-deposits/
│   ├── cards/
│   ├── cheques/
│   ├── notifications/
│   ├── reports/
│   └── audit/
└── pages/                    # route-level pages that compose features
```

Each `features/<x>` is self-contained: `components/`, `api/`, `hooks/`, `schemas/`, `types.ts`,
`routes.tsx`. Cross-feature imports go through a `shared` contract only.

---

## Permission Catalog (initial)

Permissions are fine-grained strings. Roles are bundles of permissions.

| Permission            | Description                     |
| --------------------- | ------------------------------- |
| `USER_CREATE`         | Create users                    |
| `USER_VIEW`           | View users                      |
| `ROLE_MANAGE`         | Manage roles & permissions      |
| `BRANCH_MANAGE`       | Create/edit branches            |
| `CUSTOMER_CREATE`     | Create customers                |
| `CUSTOMER_VIEW`       | View customers                  |
| `CUSTOMER_VIEW_PII`   | View PII (PAN/Aadhaar/Passport) |
| `ACCOUNT_CREATE`      | Open accounts                   |
| `ACCOUNT_CLOSE`       | Close accounts                  |
| `TXN_DEPOSIT`         | Process deposits                |
| `TXN_WITHDRAW`        | Process withdrawals             |
| `TXN_TRANSFER`        | Process internal transfers      |
| `TXN_UPI`             | Process UPI                     |
| `TXN_NEFT_RTGS`       | Process NEFT/RTGS/IMPS          |
| `TXN_REVERSE`         | Reverse a transaction           |
| `TXN_LIMIT_OVERRIDE`  | Override per-txn limits         |
| `LOAN_CREATE`         | Originate loans                 |
| `LOAN_APPROVE`        | Approve loans                   |
| `LOAN_DISBURSE`       | Disburse loans                  |
| `LOAN_VIEW`           | View loans                      |
| `CARD_ISSUE`          | Issue cards                     |
| `CARD_ACTIVATE`       | Activate cards                  |
| `CARD_BLOCK`          | Block cards                     |
| `CARD_PIN_RESET`      | Reset PIN                       |
| `CHEQUE_STOP_PAYMENT` | Stop payment                    |
| `REPORT_RUN`          | Run reports                     |
| `AUDIT_VIEW`          | View audit logs                 |
| `DASHBOARD_VIEW`      | View dashboard                  |

### Role → Permission Map (summary)

- **Super Admin:** all
- **Bank Admin:** all except `AUDIT_VIEW` override, manages users/roles/branches
- **Branch Manager:** branch-scoped customer/account/txn/loan/card/cheque, branch reports
- **Teller:** `TXN_DEPOSIT`, `TXN_WITHDRAW`, customer view, account view
- **Loan Officer:** `LOAN_*` + customer view
- **Customer Service:** customer view, account view, card block, cheque stop
- **Operations:** reports, txn view, reconciliation
- **Auditor:** `*_VIEW`, `REPORT_RUN`, `AUDIT_VIEW`, no writes
- **Customer:** self-service only (own accounts, own beneficiaries, own txns)

Enforcement is done with `@PreAuthorize("hasAuthority('PERM')")` and a `branchScope()` SpEL
helper for branch-scoped data.
