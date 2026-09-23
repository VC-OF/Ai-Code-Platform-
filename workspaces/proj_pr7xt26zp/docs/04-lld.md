# Phase 1 — Low-Level Design (LLD)

> Per-module class design, key flows, sequence diagrams (textual), and contracts.

## 3.1 Backend Package Layout (canonical)

```
com.bank.platform
  ├── PlatformApplication.java
  ├── config/                  # SecurityConfig, JpaConfig, RedisConfig, OpenApiConfig
  ├── security/                # JwtService, JwtAuthFilter, PasswordEncoderConfig
  ├── audit/                   # AuditAspect, AuditService, AuditLog
  ├── error/                   # GlobalExceptionHandler, ApiError, BusinessException
  ├── i18n/                    # MessageSourceConfig, locale resolver
  ├── observability/           # TraceFilter, MetricsConfig
  └── common/                  # Money, BaseEntity, PageRequest, ApiResponse, Result

com.bank.authentication
  ├── api/                     # AuthController, AuthApi (interface)
  ├── application/             # LoginService, RefreshService, PasswordService, MfaService
  ├── domain/                  # AuthSession, RefreshToken, Device
  └── infrastructure/          # AuthPersistence, JwtTokenAdapter, DeviceRepository

com.bank.identity
  ├── api/                     # UserController, RoleController, BranchController, EmployeeController
  ├── application/             # UserService, RoleService, BranchService, EmployeeService
  ├── domain/                  # User, Role, Permission, Branch, Employee
  └── infrastructure/          # JPA repositories, BCrypt adapter

com.bank.customer
  ├── api/                     # CustomerController
  ├── application/             # CustomerService, KycService, DocumentService
  ├── domain/                  # Customer, KycDocument, CustomerEvent
  └── infrastructure/

com.bank.account
  ├── api/                     # AccountController, ProductController
  ├── application/             # AccountService, ProductService
  ├── domain/                  # Account (aggregate), AccountProduct, FdAccount, RdAccount
  └── infrastructure/

com.bank.transaction
  ├── api/                     # TransactionController
  ├── application/             # TransferService, DepositService, WithdrawalService
  ├── domain/                  # Transaction, LedgerEntry, IdempotencyKey
  ├── ledger/                  # LedgerService, Posting, BalanceCalculator
  └── infrastructure/

com.bank.loan
  ├── api/
  ├── application/             # LoanApplicationService, DisbursementSaga, EmiService
  ├── domain/                  # LoanApplication, LoanAccount, EmiSchedule, Repayment
  └── infrastructure/

com.bank.card
com.bank.beneficiary
com.bank.cheque
com.bank.fx
com.bank.notification
com.bank.reporting
```

### Frontend Folder Layout

```
frontend/src
  ├── app/                     # bootstrap, providers, router
  ├── pages/                   # route components
  ├── features/                # feature slices
  │   ├── auth/
  │   ├── dashboard/
  │   ├── customers/
  │   ├── accounts/
  │   ├── transactions/
  │   ├── loans/
  │   └── ...
  ├── components/              # shared UI (shadcn)
  ├── layouts/                 # AppShell, AuthLayout
  ├── hooks/                   # custom hooks
  ├── services/                # axios clients, API modules
  ├── stores/                  # zustand stores
  ├── lib/                     # utils, formatters, money
  ├── schemas/                 # zod schemas
  ├── i18n/                    # i18next config
  ├── types/                   # generated types
  └── styles/                  # tailwind
```

## 3.2 Core Domain Primitives

### Money Value Object

```java
public record Money(BigDecimal amount, String currency) {
  public static final int SCALE = 4;
  public static final RoundingMode ROUNDING = RoundingMode.HALF_EVEN;
  public Money {
    Objects.requireNonNull(amount);
    Objects.requireNonNull(currency);
    amount = amount.setScale(SCALE, ROUNDING);
  }
  public Money plus(Money other) { requireSameCurrency(other); return new Money(amount.add(other.amount), currency); }
  public Money negate() { return new Money(amount.negate(), currency); }
  public boolean isPositive() { return amount.signum() > 0; }
}
```

### BaseEntity (audit + soft delete)

```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class BaseEntity {
  @Id @GeneratedValue(strategy = IDENTITY) private Long id;
  @CreatedDate private Instant createdAt;
  @CreatedBy  private String createdBy;
  @LastModifiedDate private Instant updatedAt;
  @LastModifiedBy  private String updatedBy;
  @Version private long version;            // optimistic lock
  @Column(nullable = false) private boolean deleted;   // soft delete
}
```

### ApiResponse envelope

```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 0, "size": 20, "totalElements": 123, "totalPages": 7 },
  "traceId": "8f3c..."
}
```

## 3.3 Sequence — Funds Transfer (internal)

```
Customer -> TxController: POST /api/transactions/transfers {from, to, amount}
TxController -> IdempotencyService: lookupOrReserve(Idempotency-Key)
alt key exists & completed
    IdempotencyService --> TxController: cached ResponseEntity
else proceed
    TxController -> TransferService: transfer(cmd)
    TransferService -> BeneficiaryAcl: validate(to)
    TransferService -> AccountRepo: lock(from)
    TransferService -> AccountRepo: lock(to)
    TransferService -> LedgerService: post(debit from, credit to)
    LedgerService -> LedgerRepo: insert(2 entries, sum=0)
    TransferService -> TxRepo: save(Transaction status=SUCCESS)
    TransferService -> Outbox: append(TransferCompleted)
    TransferService --> TxController: TransactionDto
end
TxController -> Notifier: emit event
TxController --> Customer: 201 Created + TransactionDto
```

## 3.4 Ledger (double-entry) Design

- `ledger_account(id, code, type, currency)` — e.g. `ASSET.CASH.VAULT.BRANCH_001`, `LIABILITY.CUSTOMER.SAVINGS`
- `ledger_entry(id, txn_id, ledger_account_id, dc, amount, currency, value_date, posted_at)`
- `dc` ∈ {`DEBIT`, `CREDIT`}; every transaction inserts entries where `SUM(debit) = SUM(credit)` per currency.
- `Balance` is a derived projection, recomputable from entries (materialized view per ledger account).
- Reversal: create a new `reverses_entry_id` linkage; never update prior entries.

## 3.5 Security Pipeline

```
Request
  → SecurityFilterChain
      → CORS / CSRF (cookie=false; stateless)
      → RateLimitFilter (Redis)
      → JwtAuthFilter (parse, validate, set SecurityContext)
      → AuditContextFilter (set MDC)
      → AuthorizationFilter
  → Controller
      → @PreAuthorize("hasAuthority('TXN_CREATE')")
      → @Valid DTO (Bean Validation)
      → @Idempotent  (custom AOP)
  → Service (transactional, @Transactional)
      → Domain logic
      → Outbox append
      → Audit append
  → Response (ApiResponse / ProblemDetail)
```

## 3.6 RBAC Model

- `permission(id, code, description)` — e.g. `TXN_CREATE`, `LOAN_APPROVE`, `CUST_READ`
- `role(id, code, name)` — `SUPER_ADMIN`, `BANK_ADMIN`, `BRANCH_MANAGER`, `TELLER`, `LOAN_OFFICER`, `CUSTOMER_SERVICE`, `OPERATIONS`, `AUDITOR`, `CUSTOMER`
- `role_permissions(role_id, permission_id)`
- `user_roles(user_id, role_id, branch_id)` — branch-scoped
- `users.principal_type` ∈ {`EMPLOYEE`, `CUSTOMER`} to allow a single `users` table for both portals with role-based menus

## 3.7 Frontend Architecture (LLD)

- **Routing:** React Router v6 with role-aware guards (`<RequireRole roles={['TELLER']}/>`)
- **Data:** TanStack Query with default `staleTime: 30s`, retries with backoff, optimistic updates for txn rows
- **Forms:** React Hook Form + Zod resolver; one zod schema per DTO, shared types from `openapi-typescript`
- **State:** Zustand for cross-cutting (auth, theme, locale); avoid Redux
- **UI:** ShadCN primitives in `components/ui`; feature components in `features/<x>/components`
- **Theming:** Tailwind dark mode via `class`; persisted to `localStorage`
- **i18n:** i18next + `i18next-browser-languagedetector`; namespaces per feature
- **Charts:** Recharts, encapsulated in `<ChartCard/>`
- **Error boundary** at route + global; toast via `sonner`
- **Skeleton** placeholders for every list/detail
- **A11y:** keyboard nav, `aria-*`, focus rings; tested with `@testing-library/jest-dom`

## 3.8 Cross-Cutting Error Codes (typed)

| Code                      | HTTP | When                              |
| ------------------------- | ---- | --------------------------------- |
| `VALIDATION_FAILED`       | 400  | Bean Validation failure           |
| `MISSING_IDEMPOTENCY_KEY` | 400  | Required header absent            |
| `INVALID_IDEMPOTENCY_KEY` | 400  | Key reused with different payload |
| `UNAUTHORIZED`            | 401  | Missing/invalid JWT               |
| `TOKEN_EXPIRED`           | 401  | Refresh required                  |
| `FORBIDDEN`               | 403  | RBAC deny                         |
| `NOT_FOUND`               | 404  | Resource absent                   |
| `CONFLICT`                | 409  | Optimistic lock / duplicate       |
| `INSUFFICIENT_FUNDS`      | 422  | Balance check failed              |
| `LIMIT_EXCEEDED`          | 422  | Daily / per-txn limit             |
| `KYC_INCOMPLETE`          | 422  | Restricted operation              |
| `RATE_LIMITED`            | 429  | Token-bucket exhausted            |
| `INTERNAL_ERROR`          | 500  | Unhandled                         |

## 3.9 Observability (LLD)

- **Logs:** JSON; fields `ts, level, msg, traceId, spanId, userId, branchId, route, status, latencyMs`
- **Metrics:**
  - HTTP: `http_server_requests_seconds{uri,method,status}`
  - DB: `hikaricp_connections_active`, custom `db_query_seconds`
  - Custom: `txn_total{kind,status}`, `loan_pipeline_total{stage,outcome}`, `interest_accrual_seconds`
- **Traces:** OTel auto-instrumentation for HTTP, JDBC, Redis; manual spans around ledger postings, EMI schedule, FX conversion
- **Audit:** `audit_log` DB table + structured log line; queryable by admin

## 3.10 Performance Budgets (LLD)

| Endpoint                           | p95 target | Notes                                     |
| ---------------------------------- | ---------- | ----------------------------------------- |
| `POST /api/auth/login`             | 250 ms     | bcrypt cost 12 ≈ 200ms                    |
| `GET /api/accounts/{id}`           | 80 ms      | Redis cache 60s                           |
| `POST /api/transactions/transfers` | 400 ms     | Two row locks + 2 ledger inserts + outbox |
| `GET /api/reports/daily`           | 800 ms     | Materialized view                         |
| `GET /api/dashboard/summary`       | 300 ms     | Single read query with joins              |
