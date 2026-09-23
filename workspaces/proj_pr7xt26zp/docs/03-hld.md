# Phase 1 — High-Level Design (HLD)

> Decomposition of the system into modules, their responsibilities, contracts, and interactions.

## 2.1 Module Map

```
                    ┌──────────────────────────────────────┐
                    │              PLATFORM                │
                    │ (security, audit, i18n, errors, obs) │
                    └────────────────┬─────────────────────┘
                                     │
   ┌──────────────┬──────────────────┼──────────────────┬──────────────┐
   │              │                  │                  │              │
┌──▼───┐    ┌────▼────┐       ┌─────▼─────┐      ┌─────▼────┐    ┌────▼────┐
│ AUTH │    │ IDENTITY│       │ CUSTOMER  │      │   FX     │    │  NOTIF  │
└──┬───┘    └────┬────┘       └─────┬─────┘      └─────┬────┘    └────┬────┘
   │             │                  │                  │              │
   │             │            ┌─────▼─────┐      ┌─────▼────┐         │
   │             │            │  ACCOUNT  │◄─────┤   LOAN   │         │
   │             │            └─────┬─────┘      └─────┬────┘         │
   │             │                  │                  │              │
   │             │            ┌─────▼─────┐      ┌─────▼────┐         │
   │             └───────────►│ TRANSACTION├─────►│   CARD   │         │
   │                          └─────┬─────┘      └──────────┘         │
   │                                │                                  │
   │                          ┌─────▼─────┐                            │
   │                          │BENEFICIARY│                            │
   │                          └───────────┘                            │
   │                                                                   │
   │       ┌───────────┐    ┌──────────┐    ┌──────────┐              │
   └──────►│ REPORTING │    │  CHEQUE  │    │SCHEDULER │◄─────────────┘
           └───────────┘    └──────────┘    └──────────┘
```

## 2.2 Module Responsibilities

| #   | Module             | Purpose                                        | Key Aggregates                                        | Public API surface                               |
| --- | ------------------ | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| 1   | **platform**       | Cross-cutting                                  | —                                                     | `ErrorTranslator`, `AuditService`, `CurrentUser` |
| 2   | **authentication** | Login, refresh, MFA, sessions                  | `AuthSession`, `RefreshToken`, `Device`               | `/api/auth/**`                                   |
| 3   | **identity**       | Users, roles, permissions, branches, employees | `User`, `Role`, `Permission`, `Branch`, `Employee`    | `/api/admin/**`                                  |
| 4   | **customer**       | Customer profile, KYC, documents, timeline     | `Customer`, `KycDocument`, `CustomerEvent`            | `/api/customers/**`                              |
| 5   | **account**        | Account lifecycle, balances, FD/RD             | `Account`, `AccountProduct`, `FdAccount`, `RdAccount` | `/api/accounts/**`                               |
| 6   | **transaction**    | Money movement, ledger, idempotency            | `Transaction`, `LedgerEntry`, `IdempotencyKey`        | `/api/transactions/**`                           |
| 7   | **beneficiary**    | Payee management                               | `Beneficiary`, `BeneficiaryVerification`              | `/api/beneficiaries/**`                          |
| 8   | **loan**           | Loan origination, EMI, closure                 | `LoanApplication`, `LoanAccount`, `EmiSchedule`       | `/api/loans/**`                                  |
| 9   | **card**           | Card issuance, lifecycle                       | `Card`, `CardPin`, `CardLimit`                        | `/api/cards/**`                                  |
| 10  | **cheque**         | Book requests, stop payment, clearing          | `ChequeBook`, `Cheque`, `StopPaymentRequest`          | `/api/cheques/**`                                |
| 11  | **fx**             | Currencies, rates, conversion                  | `Currency`, `ExchangeRate`                            | `/api/fx/**`                                     |
| 12  | **notification**   | Multi-channel delivery                         | `NotificationTemplate`, `NotificationLog`             | `/api/notifications/**`                          |
| 13  | **reporting**      | Read models, exports                           | `*ReportView`                                         | `/api/reports/**`                                |
| 14  | **scheduler**      | Cron jobs, batch ops                           | `JobRun`                                              | internal only                                    |

## 2.3 Inter-Module Communication

- **Synchronous:** method calls via public module APIs (no entity leaks)
- **Asynchronous:** Spring `ApplicationEventPublisher` (in-JVM) with a transactional outbox table for guaranteed delivery
- **Future Kafka topics:** `account.events`, `transaction.events`, `loan.events`, `customer.events`, `notification.send`
- **Anti-corruption layer (ACL):** each module translates foreign concepts via DTOs/mappers; never imports another module's entities

## 2.4 API Conventions (REST)

- Base path: `/api`
- Versioning: header `API-Version: 1` (URL fallback `/api/v1`)
- Auth: `Authorization: Bearer <jwt>`; refresh via `/api/auth/refresh`
- Idempotency: `Idempotency-Key: <uuid>` required on `POST`/`PUT`/`PATCH`
- Locale: `Accept-Language: en-US`
- Pagination: `?page=0&size=20&sort=createdAt,desc`
- Filtering: `?filter[status]=ACTIVE&filter[branchId]=...`
- Date/time: ISO-8601 UTC (`2025-01-15T10:30:00Z`)
- Error: `application/problem+json` (RFC 7807)

## 2.5 Key User Journeys (HLD)

### J1 — Customer opens Savings Account

1. Customer logs in (AUTH)
2. Submits KYC (CUSTOMER) → `kyc_status=PENDING`
3. Operations approves KYC (CUSTOMER) → `VERIFIED`
4. Customer selects product (ACCOUNT) → submits application
5. ACCOUNT raises `AccountOpened` event
6. NOTIF sends welcome email + SMS
7. CARD auto-issues a debit card (CARD)
8. Reporting projects daily account open count

### J2 — Internal Transfer

1. Customer initiates transfer (TRANSACTION)
2. BENEFICIARY validation
3. Idempotency check (Redis + DB)
4. Account debit + credit (TRANSACTION + LEDGER)
5. NOTIF + receipt (TRANSACTION → NOTIF)
6. Audit (PLATFORM)

### J3 — Home Loan Disbursement

1. Apply (LOAN) → `application_no`
2. CIBIL hook (LOAN)
3. Risk scoring (LOAN)
4. Approval workflow (LOAN + IDENTITY roles)
5. Disbursement saga: ACCOUNT credit + TRANSACTION ledger + LOAN EMI schedule
6. NOTIF + schedule generation
7. Audit + report updates

## 2.6 Technology Decisions (ADR-style)

| ID      | Decision                     | Rationale                                         | Alternatives considered                     |
| ------- | ---------------------------- | ------------------------------------------------- | ------------------------------------------- |
| ADR-001 | Modular monolith first       | Faster delivery, lower ops, easier refactor to µs | Pure microservices                          |
| ADR-002 | JWT HS256 dev / RS256 prod   | Stateless, scalable                               | Sessions in Redis only                      |
| ADR-003 | Double-entry ledger          | Auditability, integrity                           | Single balance column (rejected)            |
| ADR-004 | Flyway for migrations        | Versioned, repeatable                             | Liquibase (overkill)                        |
| ADR-005 | Redis for idempotency keys   | Fast lookup with TTL                              | DB-only (slower)                            |
| ADR-006 | Spring Boot 3 + Java 21      | LTS, virtual threads ready                        | Quarkus, Micronaut (rejected for ecosystem) |
| ADR-007 | React 19 + Vite              | Mature, fast HMR, ecosystem                       | Next.js (SSR not needed for dashboard)      |
| ADR-008 | TanStack Query               | Caching, retries, suspense                        | Redux Toolkit Query (rejected)              |
| ADR-009 | ShadCN UI                    | Accessible, themeable, copy-paste                 | MUI, AntD (heavier)                         |
| ADR-010 | BigDecimal scale=4 HALF_EVEN | Banking precision                                 | Double (rejected)                           |
