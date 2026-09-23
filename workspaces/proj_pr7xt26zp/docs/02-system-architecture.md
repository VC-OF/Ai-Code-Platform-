# Phase 1 — System Architecture (HLD)

## 1.1 Context View (C4 Level 1)

```
                        ┌──────────────────────────────┐
                        │       Customer Browser       │
                        │   (React 19 + Vite + SPA)    │
                        └──────────────┬───────────────┘
                                       │ HTTPS / WSS
                                       ▼
              ┌────────────────────────────────────────────┐
              │           NGINX / API Gateway              │
              │  (TLS, CORS, RateLimit, Auth-Edge)         │
              └──────────────┬────────────┬────────────────┘
                             │            │
              ┌──────────────▼──┐   ┌─────▼──────────────┐
              │  Auth Service   │   │  Banking Backend   │
              │  (JWT Issuer)   │   │  (Spring Boot 3)   │
              └─────────────────┘   └─────┬──────────────┘
                                         │
                ┌──────────────┬──────────┼──────────┬──────────────┐
                ▼              ▼          ▼          ▼              ▼
         ┌──────────┐   ┌──────────┐  ┌──────┐  ┌──────────┐  ┌─────────┐
         │PostgreSQL│   │  Redis   │  │ SMTP │  │   SMS    │  │ Object  │
         │  (Bank)  │   │(Cache)   │  │      │  │ Gateway  │  │ Storage │
         └──────────┘   └──────────┘  └──────┘  └──────────┘  └─────────┘
```

## 1.2 Container View (C4 Level 2)

| Container                | Tech                            | Responsibility                                |
| ------------------------ | ------------------------------- | --------------------------------------------- |
| **web**                  | React 19 + Vite                 | SPA, dashboards, forms, charts                |
| **api**                  | Spring Boot 3                   | REST APIs, business logic, ledger             |
| **auth**                 | Spring Boot 3 (same deployable) | JWT issuance/refresh, MFA                     |
| **scheduler**            | Spring `@Scheduled` in `api`    | Interest accrual, EMI debit, statements       |
| **worker** _(future)_    | Spring Cloud Stream / Kafka     | Async notifications, file processing          |
| **postgres**             | PostgreSQL 16                   | System of record                              |
| **redis**                | Redis 7                         | Sessions, rate-limit, cache, idempotency keys |
| **mailhog** _(dev)_      | SMTP catcher                    | Dev emails                                    |
| **minio** _(dev)_        | S3-compatible                   | Document vault                                |
| **prometheus + grafana** | Observability                   | Metrics, dashboards                           |
| **loki**                 | Logs                            | Centralized logs                              |

## 1.3 Component View (Banking Backend, modular monolith)

```
com.bank
├── platform                ← cross-cutting (audit, security, i18n, errors, observability)
├── authentication          ← Auth bounded context
├── identity                ← Users, roles, permissions, employees, branches
├── customer                ← Customer KYC, profile, timeline
├── account                 ← Savings, current, FD, RD accounts
├── transaction             ← Transfers, payments, ledger, idempotency
├── beneficiary             ← Payee management
├── loan                    ← Personal, home, vehicle, business, education, gold
├── card                    ← Debit, credit, lifecycle
├── cheque                  ← Book requests, stop-payment, clearing
├── notification            ← Email/SMS/Push/In-app
├── reporting               ← Read models, exports
└── fx                      ← Currency, rates, conversion
```

Each module is a **Maven sub-module** with its own package, owns its own tables (no cross-module FKs — IDs only), exposes a `*Api` interface, and ships unit + integration tests. This is the **microservice-ready modular monolith**.

## 1.4 Architectural Style

- **Layered + Hexagonal** (Domain core, ports out, adapters in)
- **CQRS-lite**: writes via JPA aggregates, reads via projection repositories
- **Event-driven** internally via `ApplicationEventPublisher`; later via Kafka topics
- **Outbox pattern** for reliable event publication
- **Saga (orchestration)** for cross-module flows (Loan origination)
- **Saga (choreography)** via events for account opening + card issuance

## 1.5 Cross-Cutting Concerns

| Concern       | Implementation                                                         |
| ------------- | ---------------------------------------------------------------------- |
| Logging       | SLF4J + Logback JSON encoder; MDC with `traceId`, `userId`, `branchId` |
| Tracing       | OpenTelemetry → OTLP → Tempo/Jaeger                                    |
| Metrics       | Micrometer → Prometheus (`/actuator/prometheus`)                       |
| Config        | Spring Cloud Config (later) + Env vars + `application-{profile}.yml`   |
| Feature flags | Unleash (later) / in-DB `feature_flag` table (now)                     |
| Caching       | Redis (Lettuce), `@Cacheable` with namespaced keys                     |
| Rate limit    | Redis token-bucket per IP + per user                                   |
| Idempotency   | `idempotency_keys` table, 24h TTL, stores response                     |
| Locking       | `SELECT ... FOR UPDATE` on account rows; pessimistic for monetary      |
| Migrations    | Flyway, versioned `V{n}__{desc}.sql`                                   |
| API docs      | springdoc-openapi → `/swagger-ui.html`                                 |
| Validation    | Jakarta Bean Validation + Zod mirrors on frontend                      |
| Error model   | RFC 7807 `application/problem+json`                                    |
| Security      | Spring Security 6, JWT (HS256 dev / RS256 prod), BCrypt strength 12    |

## 1.6 High-Availability & Resilience

- Stateless API pods behind load balancer; sticky session not required
- PostgreSQL single-writer + read replicas (later)
- Redis Sentinel / Cluster
- Circuit breakers: Resilience4j on FX, SMS, SMTP
- Retries with exponential backoff + jitter (max 3)
- Health checks: `/actuator/health/liveness`, `/actuator/health/readiness`
- Graceful shutdown: `server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s`

## 1.7 Security Architecture

- **Edge:** WAF, TLS 1.3, HSTS
- **Auth:** JWT (access 15 min, refresh 7 d), refresh rotation, reuse detection
- **Authz:** RBAC via `@PreAuthorize("hasAuthority('TXN_CREATE')")` + method security
- **Data:** PII AES-256-GCM; column-level via JPA converters; secrets in Vault (later) / env
- **Transport:** mTLS between services (when split into microservices)
- **Headers:** CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Upload:** MIME sniff, size limits, AV scan (ClamAV adapter), S3 server-side encryption

## 1.8 Data Architecture

- **Source of truth:** PostgreSQL, normalized to 3NF
- **Reporting:** Materialized views in same DB (Phase 1), read replica or ClickHouse (later)
- **Cache:** Redis for hot lookups (customer profile, FX rates)
- **Search:** Postgres `tsvector` for v1; OpenSearch later
- **Ledger:** Append-only `ledger_entry` table; never UPDATE/DELETE; balance = SUM(postings)

## 1.9 Deployment Topology (target)

```
                ┌──────────────────────────┐
                │      CloudFront / CDN    │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │   EKS / GKE / AKS k8s   │
                │  ┌──────┐  ┌─────────┐  │
                │  │ web  │  │ api×N   │  │
                │  └──────┘  └─────────┘  │
                │  Ingress (NGINX)        │
                └─────┬──────────────┬────┘
                      │              │
                 ┌────▼───┐     ┌────▼────┐
                 │ RDS PG │     │ Elasticache Redis│
                 └────────┘     └─────────┘
```

## 1.10 Risks & Mitigations

| Risk                       | Impact   | Mitigation                                                                           |
| -------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Money-movement bugs        | Critical | Double-entry ledger, reconciliation job, 100% integration tests on txn paths         |
| RBAC bypass                | Critical | Method security + integration tests per role matrix + periodic access review         |
| PII leak                   | Critical | Encryption at rest, masking in logs, DLP on exports                                  |
| Idempotency miss           | High     | Mandatory `Idempotency-Key` header on all writes; reject 400 if absent               |
| Time-zone bugs on interest | High     | Store all timestamps UTC; use `ZoneId.of("UTC")`; cron in `TimeZone` aware scheduler |
| Data migration drift       | Medium   | Flyway only; no manual DDL in prod; backward-compatible migrations                   |
| Supply-chain               | Medium   | SBOM, dependency review, OWASP dep-check in CI                                       |
