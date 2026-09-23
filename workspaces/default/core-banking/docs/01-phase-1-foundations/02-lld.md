# Phase 1 · Low-Level Design (LLD)

This document captures the cross-cutting internal design decisions that apply to **every**
module. Module-specific LLDs live alongside the module's source code.

---

## 1. Request Lifecycle

```
Client
  │  HTTPS + Authorization: Bearer <accessJwt>
  ▼
[1] Nginx / Edge
  │   - TLS termination
  │   - Rate limit (per IP)
  │   - Adds X-Request-Id
  ▼
[2] Spring Security Filter Chain
  │   - JwtAuthenticationFilter
  │   - extracts claims, loads user context
  │   - sets SecurityContext
  ▼
[3] RequestLoggingFilter
  │   - MDC: traceId, userId, branchId
  │   - logs request + response status
  ▼
[4] Controller
  │   - @Valid on request DTO (Bean Validation)
  │   - delegates to application service
  ▼
[5] Application Service (use case)
  │   - enforces business invariants
  │   - publishes domain events
  ▼
[6] Domain / Aggregate
  │   - executes business rules
  │   - emits domain events
  ▼
[7] Repository (port) → JPA Adapter
  │   - persists via Hibernate
  ▼
[8] Transactional Commit
  │   - audit log writer (afterCommit)
  │   - notification dispatch (afterCommit)
  ▼
[9] @RestControllerAdvice
  │   - maps Result/Throwable → RFC 7807 problem
  ▼
Client ← JSON
```

---

## 2. Error Model (RFC 7807)

All errors are returned as `application/problem+json`:

```json
{
  "type": "https://errors.cbp.bank/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "code": "INSUFFICIENT_FUNDS",
  "detail": "Account ... has balance 100.00 INR, attempted debit 250.00 INR",
  "instance": "/api/v1/transactions/withdraw",
  "traceId": "8f2...",
  "errors": [{ "field": "amount", "message": "must be greater than 0" }]
}
```

Java side: a sealed `DomainException` hierarchy with a `Problem` builder.

---

## 3. API Conventions

- **Base path:** `/api/v1`
- **Versioning:** URI segment
- **Resources:** plural nouns (`/customers`, `/accounts/{id}/transactions`)
- **HTTP verbs:** strict REST mapping
- **Filtering:** `?filter[field]=value` and `?search=...`
- **Sorting:** `?sort=field,direction` (multi-sort supported)
- **Pagination:** `?page=0&size=20&cursor=...` (page/size for tables, cursor for streams)
- **Idempotency:** `Idempotency-Key` header on POSTs that move money
- **Timestamps:** ISO-8601 UTC in JSON, `TIMESTAMPTZ` in DB
- **Money:** integer minor units + ISO 4217 currency code (e.g. `{"amount": 10000, "currency": "INR"}`)
- **Locale:** `Accept-Language` header; default `en`

A separate document `06-api-conventions.md` details the conventions. The full OpenAPI spec
is generated from controllers and committed to `docs/api/openapi.yaml`.

---

## 4. Domain Primitives

### 4.1 Money

```java
public record Money(BigDecimal amount, String currency) implements Serializable {
  public static Money of(String amount, String currency) { ... }
  public Money add(Money other) { /* same currency, scale normalize */ }
  public Money subtract(Money other) { ... }
  public boolean isPositive() { ... }
}
```

All account/transaction monetary fields use `BIGINT` minor units (e.g. paise) to avoid
floating-point errors. A `Currency` enum + `currency` table drive ISO 4217 codes.

### 4.2 Entity Base

All JPA entities extend `AuditableEntity`:

```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class AuditableEntity {
  @Id @GeneratedValue(strategy = IDENTITY) private Long id;
  @CreatedDate  private Instant createdAt;
  @LastModifiedDate private Instant updatedAt;
  @CreatedBy    private String createdBy;
  @LastModifiedBy private String updatedBy;
  @Column(name = "deleted_at") private Instant deletedAt; // soft delete
  @Version      private Long version; // optimistic lock
}
```

### 4.3 Soft Delete

A Hibernate `@SQLDelete(sql="UPDATE ... SET deleted_at = now() WHERE id = ? AND version = ?")`
plus `@Where(clause="deleted_at IS NULL")` on entities; queries in services explicitly use
`findByIdIncludingDeleted` where needed (auditor role).

---

## 5. Persistence

- **JPA + Hibernate 6**, `ddl-auto=validate`, Flyway owns schema.
- **Repository pattern:** Spring Data JPA interfaces are **adapters**, not ports. Domain code
  depends on repository **ports** defined in `domain.repository`; infrastructure provides
  JPA-backed adapters. This keeps the domain free of Spring Data annotations.
- **Pessimistic locks** for account balance updates:
  `SELECT ... FOR UPDATE` via `@Lock(LockModeType.PESSIMISTIC_WRITE)`.
- **Idempotency:** `idempotency_keys(key, request_hash, response, status, created_at)`
  unique-constrained on `(key, endpoint)`.
- **Audit log:** a single `audit_log` table populated by an `AuditLogger` component called
  in `@TransactionalEventListener(phase = AFTER_COMMIT)`.

---

## 6. Security (Module-Internal)

- `SecurityFilterChain` config in `auth` module.
- `JwtService` signs HS256 in dev, RS256 in prod (key from env / KMS).
- `RefreshTokenService` stores opaque tokens in Redis with TTL = 7 days, rotated on use.
- Method security: `@PreAuthorize("hasAuthority('ACCOUNT_CREATE')")` using
  permission strings, **not** role names, to support fine-grained RBAC.
- Password hashing: BCrypt strength 12.
- CORS: allowlist in `application.yml`, env-driven in prod.
- CSRF: disabled for stateless JWT APIs; enabled for any cookie-based endpoints.

Detail in `07-security-model.md`.

---

## 7. Multi-Currency

- Each account has a `currency_code` (FK to `currencies`).
- All money in transactions is stored in the source account's currency.
- Internal transfers between currencies use an `fx_rates` table (admin-maintained) and
  create two ledger entries (debit/credit) with explicit FX.
- A scheduled job refreshes FX rates from a provider (Phase 9).

---

## 8. Multi-Language

- **Backend:** `MessageSource` with property files per locale under `i18n/messages_{locale}.properties`.
- **Frontend:** `i18next` with `en`, `hi`, `es` bundles; user preference stored in `users.preferred_locale`.
- All user-facing strings in the UI are keys; all backend error messages are codes + localized
  via `MessageSource`.

---

## 9. Notifications

- `NotificationService` is a port; adapters: `EmailNotificationAdapter` (SMTP/SES),
  `SmsNotificationAdapter` (provider-agnostic interface), `PushNotificationAdapter` (FCM),
  `InAppNotificationAdapter` (DB).
- Outbound messages are enqueued in a `notification_outbox` table inside the same
  transaction (transactional outbox pattern) and dispatched by a scheduled poller — guarantees
  at-least-once delivery.

---

## 10. Audit Logging

Every state-changing operation publishes a `DomainEvent`. An `AuditLogger` listener:

```java
@Async @TransactionalEventListener(phase = AFTER_COMMIT)
public void on(DomainEvent e) {
  auditLogRepository.save(AuditLog.of(
    e.aggregateType(), e.aggregateId(),
    e.action(), e.userId(), e.branchId(),
    e.oldValue(), e.newValue(),
    e.ipAddress(), e.userAgent(), Instant.now()
  ));
}
```

The API endpoint reads these via the auditor role; no entity exposes `oldValue/newValue` in
write APIs.

---

## 11. Testing Strategy

| Layer          | Tool                              | Target coverage |
| -------------- | --------------------------------- | --------------- |
| Domain         | JUnit 5                           | 95%             |
| Application    | JUnit 5 + Mockito                 | 90%             |
| Infrastructure | JUnit 5 + Mockito                 | 80%             |
| Repository     | @DataJpaTest + Testcontainers     | 80%             |
| Web (slice)    | @WebMvcTest                       | 85%             |
| E2E (backend)  | Spring Boot Test + Testcontainers | key flows       |
| Frontend units | Vitest + Testing Library          | 80%             |
| Frontend e2e   | Playwright                        | key flows       |

CI runs all tests; coverage gate = 80% lines on changed files.

---

## 12. Observability

- Logs: JSON, shipped via stdout to the platform log aggregator.
- Metrics: `/actuator/prometheus`.
- Traces: OTLP HTTP exporter, sampled 10% in prod, 100% in dev.
- Health: `/actuator/health/liveness` and `/readiness` (checks DB + Redis).
