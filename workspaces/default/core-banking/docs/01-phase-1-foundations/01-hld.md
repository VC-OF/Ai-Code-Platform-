# Phase 1 · High-Level Design (HLD)

**Project:** Core Banking Platform (CBP)
**Audience:** Engineering, Architecture, Security, Product, Operations
**Status:** Phase 1 — Foundations (design complete, implementation begins Phase 2)

---

## 1. Purpose & Scope

The Core Banking Platform (CBP) is a web-based, multi-tenant, multi-branch banking
application that supports **Retail**, **Corporate**, and **Branch** banking operations from a
single, modular codebase.

### 1.1 In Scope (MVP + first release)

- Customer onboarding & KYC (Retail + Corporate)
- Branch and employee management
- Savings, Current, Salary, NRE, NRO, FD, RD accounts
- Deposits, withdrawals, internal transfers, UPI, NEFT, RTGS, IMPS, card payments
- Beneficiaries
- Personal, Home, Vehicle, Business, Education, Gold loans with full lifecycle
- Cheque book request, stop payment, clearing
- Cards (debit/credit): activation, block, replacement, PIN, limits
- Role-Based Access Control for 9 roles
- MFA-ready authentication, refresh tokens, session management
- Audit trail for every state-changing operation
- Notifications: in-app, email, SMS, push
- Reports: PDF, Excel, CSV
- Multi-currency, multi-language, multi-branch
- Analytics dashboard

### 1.2 Out of Scope (Phase 1)

- SWIFT / cross-border wires
- Treasury & ALM
- Core banking switch / ATM driving
- Mobile native apps (responsive web only)
- Blockchain / CBDC

---

## 2. Stakeholders

| Stakeholder       | Concern                                                |
| ----------------- | ------------------------------------------------------ |
| Bank Admin        | Multi-branch oversight, user management, configuration |
| Branch Manager    | Branch KPIs, employee management, approvals            |
| Teller            | Day-to-day cash operations, customer servicing         |
| Loan Officer      | Loan origination, appraisal, disbursement              |
| Customer Service  | Account servicing, dispute intake                      |
| Operations        | Reconciliation, EOD batch, report generation           |
| Auditor           | Read-only access to logs and reports                   |
| Customer          | Self-service banking via web                           |
| Regulator (audit) | Audit logs, compliance reports                         |

---

## 3. System Context

```
                            ┌──────────────────────────┐
                            │      Browser (SPA)       │
                            │  React 19 + Vite + TS    │
                            └──────────────┬───────────┘
                                           │ HTTPS / JWT
                                           ▼
                            ┌──────────────────────────┐
                            │    API Gateway / Edge    │
                            │  (Nginx / Spring Cloud   │
                            │   Gateway in prod)       │
                            └──────────────┬───────────┘
                                           │
                                           ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                  Spring Boot Monolith (modular)             │
       │                                                             │
       │  Modules: auth, customer, branch, employee, account,         │
       │           transaction, beneficiary, loan, fixed-deposit,     │
       │           recurring-deposit, card, cheque, notification,     │
       │           report, audit, dashboard, common                   │
       └──────┬─────────────────┬──────────────────┬─────────────────┘
              │                 │                  │
              ▼                 ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────────┐
        │PostgreSQL│      │  Redis   │      │  Object Store│
        │ (system  │      │ (cache,  │      │  (S3/MinIO)  │
        │  of record)│    │ sessions,│      │  for KYC/    │
        └──────────┘      │  ratelmt)│      │  documents   │
                          └──────────┘      └──────────────┘
                                                       ▲
                                                       │
                              ┌────────────────────────┴──────────┐
                              │   External: Email/SMS/Push gateway │
                              └───────────────────────────────────┘
```

---

## 4. Architectural Style

- **Modular Monolith** (initially) with strict module boundaries enforced by
  Maven modules + Spring's `@ApplicationModule` style. Each module is self-contained and can
  be lifted into a microservice later without rewrites.
- **Clean Architecture / Hexagonal** inside each module:
  - `domain` — entities, value objects, domain events, ports
  - `application` — use cases, command/query handlers, DTOs
  - `infrastructure` — JPA repositories, REST controllers, config, adapters
  - `api` — module-public DTOs and ports (no leakage of JPA entities)
- **DDD** — bounded contexts per module, ubiquitous language, aggregate roots.
- **CQRS-lite** — separate write models (JPA entities) and read models (projection entities /
  DTOs assembled by query services). No event sourcing in Phase 1.
- **REST** as the primary API contract; OpenAPI 3.1 generated and committed.
- **JWT** stateless auth with Redis-backed refresh tokens and session tracking.

### 4.1 Cross-cutting Concerns

| Concern        | Approach                                                      |
| -------------- | ------------------------------------------------------------- |
| Logging        | SLF4J + Logback JSON appender, MDC with `traceId`, `userId`   |
| Tracing        | OpenTelemetry → OTLP (Jaeger/Tempo)                           |
| Metrics        | Micrometer → Prometheus                                       |
| Error handling | `@RestControllerAdvice` global handler, RFC 7807 problem      |
| Validation     | Jakarta Bean Validation + Zod on frontend                     |
| Security       | Spring Security filter chain, method security, BCrypt         |
| Rate limiting  | Bucket4j backed by Redis                                      |
| i18n           | Backend: `MessageSource`; Frontend: `i18next`                 |
| Multi-currency | `Money` value object + per-account currency + FX service      |
| Auditing       | JPA `@EntityListeners` + `audit_log` table                    |
| Soft delete    | `deleted_at TIMESTAMP NULL` + Hibernate `@SQLDelete`/`@Where` |
| Migrations     | Flyway, versioned `V<ts>__<name>.sql`                         |
| Config         | Spring profiles: `dev`, `test`, `staging`, `prod`             |

---

## 5. Deployment Topology

- **Dev:** `docker-compose up` brings up postgres, redis, minio, mailhog, backend, frontend.
- **Staging/Prod:** Kubernetes, 2+ replicas per stateless service, single-writer batch jobs.
- **Database:** Single primary, read-replicas for reporting queries (Phase 9).
- **Object storage:** MinIO (dev) / S3 (prod) for KYC documents, exports.

---

## 6. Non-Functional Requirements

| NFR            | Target                                                     |
| -------------- | ---------------------------------------------------------- |
| Availability   | 99.9% business hours, 99.5% overall                        |
| Latency (p95)  | Read API ≤ 200 ms, Write API ≤ 400 ms (under nominal load) |
| Throughput     | 200 RPS sustained, 500 RPS peak                            |
| Concurrency    | 5,000 concurrent web sessions                              |
| Data integrity | ACID, no money lost, all writes audited                    |
| Security       | OWASP ASVS L2, no critical CVEs in dependencies            |
| Compliance     | Audit log retention ≥ 7 years, PII encrypted at rest       |
| i18n           | English (default), Hindi, Spanish (extensible)             |
| Browser        | Latest 2 versions of Chrome, Edge, Firefox, Safari         |

---

## 7. Risks & Mitigations

| Risk                               | Mitigation                                                |
| ---------------------------------- | --------------------------------------------------------- |
| Money-double-spend race conditions | Pessimistic locking on account rows; idempotency keys     |
| Coupling between modules           | Maven module boundaries + package-private internals       |
| Migration risk on schema changes   | Flyway, expand-contract migrations, no destructive drops  |
| KYC document PII leak              | Encrypted at rest, signed URLs, role-gated download       |
| JWT revocation                     | Short access TTL (15 min) + Redis refresh token blocklist |
| Clock skew on transactions         | DB-side `transaction_date` defaulted by DB, not app       |

---
