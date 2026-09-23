# Phase 1 — Development Roadmap

> Sequenced delivery plan. Each phase is independently verifiable. We pause for sign-off after each.

## Roadmap Overview

| Phase | Title                                         | Duration (target) | Exit criteria                                           |
| ----- | --------------------------------------------- | ----------------- | ------------------------------------------------------- |
| **1** | **Foundations (HLD/LLD/DB/ER/Structure)**     | ✅ This phase     | Architecture approved, ER ratified, structure committed |
| 2     | Platform + Auth + Identity + Audit            | 1.5 w             | Login, RBAC, refresh, audit, OpenAPI live               |
| 3     | Customer + Branch + Employee                  | 1 w               | CRUD, KYC upload, timeline, branch cash                 |
| 4     | Account + Beneficiary + Transactions + Ledger | 2 w               | Savings, transfers, idempotency, ledger recon           |
| 5     | Loan + FD + RD + Card + Cheque                | 2 w               | Full lifecycle for each, EMI scheduler                  |
| 6     | Notification + Reporting + Dashboard + i18n   | 1.5 w             | Email/SMS/in-app, exports, charts                       |
| 7     | Hardening + K8s + CI/CD + Observability       | 1.5 w             | CI green, SBOM, OWASP dep-check, k8s manifests          |
| 8     | Performance + Security testing + UAT          | 1 w               | p95 budgets met, OWASP ZAP clean, UAT sign-off          |

**Total: ~10.5 weeks for v1.0**

## Phase 1 Deliverables (this submission)

- [x] `docs/01-requirements-analysis.md` — Functional + NFRs + traceability
- [x] `docs/02-system-architecture.md` — C4 L1/L2, ADRs, security
- [x] `docs/03-hld.md` — Modules, responsibilities, key journeys
- [x] `docs/04-lld.md` — Package layout, sequences, ledger, RBAC, frontend LLD
- [x] `docs/05-database-design.md` — All tables, indexes, constraints, encryption
- [x] `docs/06-er-diagram.mmd` — Mermaid ER for all entities
- [x] `docs/07-folder-structure.md` — Backend + Frontend + DevOps tree
- [x] `docs/08-roadmap.md` — This file
- [x] `README.md` — Top-level orientation

## Phase 2 — Platform, Auth, Identity, Audit (preview)

**Backend**

- Initialize parent POM + `platform` module: `PlatformApplication`, `SecurityConfig`, `JwtService`, `JwtAuthFilter`, `RateLimitFilter`, `GlobalExceptionHandler`, `ProblemDetailFactory`, `AuditAspect`, `Money` VO, `BaseEntity`, Flyway baseline `V1__init_platform.sql`, `V9__seed_roles_permissions.sql`
- `authentication` module: `AuthController`, `LoginService`, `RefreshService`, `PasswordService`, `MfaService` (TOTP), `DeviceService`
- `identity` module: `User`, `Role`, `Permission`, `Branch`, `Employee` entities + CRUD
- Seed: 9 roles, ~60 permissions, default super-admin user, 3 demo branches, demo currencies

**Frontend**

- Vite scaffold, Tailwind, ShadCN init, React Router, TanStack Query, Axios client with interceptors
- Auth pages: login, forgot/reset password, MFA challenge
- App shell: sidebar + topbar, theme toggle, locale switcher
- Users / Roles / Branches / Employees CRUD pages with data tables, filters, pagination

**Tests**

- JUnit 5 + Mockito unit tests for `LoginService`, `RefreshService`, `JwtService`
- Testcontainers integration: full login → refresh → me flow against real PG + Redis
- Frontend: Vitest + Testing Library for `LoginPage`, `RoleGuard`, `useAuth`

**Docker**

- `deploy/docker/docker-compose.yml` brings up PG, Redis, MailHog, MinIO, backend, frontend
- Seed script `scripts/seed-dev.sh`

**Verification**

- `docker compose up` → `curl /actuator/health` returns UP
- `curl -X POST /api/auth/login` returns 200 + tokens
- `curl /api/admin/users` with `ROLE_SUPER_ADMIN` returns list
- `curl` without role returns 403 and an `audit_log` row exists
- Coverage report ≥ 80% line for `platform`, `authentication`, `identity`

## Phase 3 — Customer, Branch, Employee (preview)

- Customer CRUD, KYC document upload (S3-compatible), timeline events
- Branch cash balance ops, employee attendance
- Frontend: customers list with advanced filter, detail with tabs (profile, KYC, accounts, timeline)

## Phase 4 — Account, Beneficiary, Transactions, Ledger (preview)

- Savings / Current account opening, FD/RD stubs
- Transfers (internal, NEFT, IMPS, UPI mock), Deposits, Withdrawals
- Ledger service with double-entry, reconciliation job
- Idempotency + rate limiting + daily limits

## Phase 5 — Loan, FD, RD, Card, Cheque

- Loan origination saga, EMI scheduler, foreclosure
- FD premature closure, RD auto-debit, missed installments
- Card issuance, activation, block, PIN reset, limits
- Cheque book request, stop payment, clearing status

## Phase 6 — Notification, Reporting, Dashboard, i18n

- Templates per channel, async send via outbox + worker
- PDF/Excel/CSV exports via OpenCSV + Apache POI + OpenPDF
- Dashboard with Recharts: monthly txn, customer growth, loan portfolio, deposits vs withdrawals
- 6 locales wired end-to-end

## Phase 7 — Hardening, K8s, CI/CD, Observability

- GitHub Actions: backend (mvn verify, OWASP dep-check, SBOM), frontend (lint, test, build), docker buildx push
- Kubernetes manifests with HPA, PDB, NetworkPolicies, Ingress, cert-manager
- Prometheus + Grafana dashboards, Loki + Promtail, Tempo for traces
- Snyk / Trivy scans, signed images, Cosign

## Phase 8 — Performance, Security, UAT

- k6 / Gatling perf test to hit p95 budgets
- OWASP ZAP baseline scan
- Penetration test checklist (auth, RBAC, IDOR, SSRF, file upload, SQLi, XSS)
- UAT scripts per role, defect burn-down

## Risks & Dependencies

- **External:** SMS/Email providers need credentials before Phase 6
- **Compliance:** Legal sign-off on KYC doc retention policy before Phase 3
- **Infra:** PostgreSQL HA design required before Phase 7
- **Data:** FX rate source (e.g., openexchangerates.org) key needed before Phase 5

## Roles & Responsibilities

| Role          | Owner                                |
| ------------- | ------------------------------------ |
| Product Owner | Bank representative                  |
| Tech Lead     | Solution architect (this engagement) |
| Backend       | Java/Spring team                     |
| Frontend      | React team                           |
| QA            | QA lead + automation engineer        |
| DevOps        | SRE                                  |
| Security      | AppSec reviewer                      |
