# Phase 1 · Development Roadmap

A concrete, time-boxed plan from Phase 2 (first implementation) through Phase 10 (GA release).
The estimates assume a team of 4 backend + 2 frontend + 1 QA + 1 DevOps working in parallel.

---

## Phase 2 — Auth + User Management (≈ 2.5 weeks)

**Goals:** A user can log in, get a JWT, refresh it, and a bank admin can create employees
and assign roles.

**Backend**

- Maven parent + 6 modules: `common`, `auth`, `user`, `branch`, `audit`, `bootstrap`.
- Flyway baseline: `V000__baseline.sql` (users, roles, permissions, branches, employees),
  `V001__seed_roles.sql`, `V002__seed_currencies.sql`, `V003__seed_admin_user.sql`.
- JWT (HS256 dev) + Redis refresh tokens + device tracking.
- BCrypt password hashing, login attempt lockout.
- MFA-ready (TOTP) but not required by default.
- Method security with `branchScope()`.
- Rate limiting on `/auth/login`.
- Global exception handler with RFC 7807.
- Swagger UI.

**Frontend**

- Vite + React 19 + TS + Tailwind + shadcn scaffold.
- Auth feature: login, forgot/reset password, MFA page, refresh interceptor.
- AppShell (sidebar, topbar, theme toggle, language switcher, global search placeholder).
- Settings → Users (list, create, edit, role assignment) and Roles pages.

**Testing**

- Unit: JWT signing/verifying, refresh rotation, password hashing, branch scope.
- Slice: `@WebMvcTest` for auth controller.
- Integration: full login → refresh → logout flow with Testcontainers (Postgres + Redis).

**Verification**

- `mvn verify` green; coverage ≥ 80% on `auth` and `user`.
- `npm run build` green; `vitest` green; Playwright smoke on login.

---

## Phase 3 — Customer & Branch (≈ 2 weeks)

**Goals:** Bank admin creates branches, branch manager manages employees, ops creates
customers with KYC and documents.

**Backend**

- `customer` module (CRUD, KYC, addresses, nominees, documents, timeline).
- `branch` module (CRUD, employees, working hours, cash drawer).
- Document upload → MinIO with signed URLs.
- Customer search (full-text on name/email/phone/pan), pagination, filtering.
- Audit events for all mutations.

**Frontend**

- Customers list page (DataTable with filters, sort, pagination).
- Customer detail page (tabs: profile, addresses, nominees, documents, timeline, accounts).
- Customer create/edit form (React Hook Form + Zod).
- Document uploader component (drag/drop, progress, signed-URL preview).
- Branches list + detail + employee assignment.

**Testing**

- Customer KYC status transitions, document upload, timeline ordering.

---

## Phase 4 — Accounts & Transactions (≈ 4 weeks — largest phase)

**Goals:** Open accounts, deposit/withdraw, internal transfer with double-entry ledger,
UPI/NEFT/RTGS/IMPS adapters (mock in Phase 4, real in Phase 9), beneficiary verification,
OTP-gated transfers, daily limits, receipts.

**Backend**

- `account` module: open/close, interest posting scheduler, statement projection.
- `transaction` module: deposit, withdraw, transfer, mode adapters.
- `beneficiary` module.
- Idempotency keys, optimistic + pessimistic locks on accounts.
- Daily-limit service.
- OTP service (email + SMS adapters, mock provider in dev).
- Receipt PDF generator (OpenPDF).
- Transaction history with cursor pagination.

**Frontend**

- Accounts list, account detail (statement, beneficiaries, cards, FDs/RDs).
- Transfer wizard (beneficiary pick → amount → OTP → review → confirm).
- Deposit / withdrawal screens for branch users.
- Statement page with date range + CSV download.

**Testing**

- Concurrency tests on balance updates (for-eg 100 parallel withdrawals must not
  over-draft).
- Idempotency: same key returns same result on replay.
- OTP expiry / attempt limits.
- Receipt PDF byte-equals snapshot.

---

## Phase 5 — Loans & Cards (≈ 3 weeks)

**Goals:** Full loan lifecycle for at least 3 products (Personal, Home, Gold) and debit
card lifecycle (issue, activate, block, replace, PIN, limits).

**Backend**

- `loan` module: products, applications (workflow states), EMI engine,
  repayment schedule generator, foreclosure, closure.
- `card` module: card issuance (number generated server-side, PAN hashed, last4 only),
  PIN set/change (Argon2 or BCrypt for PIN), block/unblock, limits, replacement.

**Frontend**

- Loan application wizard (product pick → amount/tenure → documents → submit).
- Loan detail: schedule, outstanding, pay-now, foreclosure request.
- Cards list, card detail, PIN change, block, replace.

**Testing**

- EMI math: verify against known amortization tables.
- Card PIN never persisted in plain; never returned in responses.

---

## Phase 6 — Cheques & Beneficiaries (≈ 1.5 weeks)

**Goals:** Request cheque book, stop payment, mark clearing, manage beneficiaries with
verification and favorites.

---

## Phase 7 — Notifications & Reports (≈ 2 weeks)

**Goals:** Send notifications from domain events (transaction success, KYC verified,
loan approved, card blocked). Generate PDF/Excel/CSV reports.

**Backend**

- `notification` module: outbox + dispatcher (email via SMTP, SMS via provider stub,
  push via FCM stub, in-app via DB).
- `report` module: report definitions, async run, renderers (PDF/Excel/CSV), storage.
- Templates with i18n.

**Frontend**

- In-app notifications dropdown + page.
- Reports page: pick report → params → run → download.
- Notification preferences page (per channel toggle).

---

## Phase 8 — Frontend Dashboard & Analytics (≈ 2 weeks)

**Goals:** The dashboard module is the landing page for staff. Charts, KPIs, branch
performance, daily reports.

**Frontend**

- Dashboard layout with KPIs.
- Recharts: monthly txns, customer growth, loan portfolio, revenue, deposits vs withdrawals.
- Branch performance table.
- Daily report widget (downloadable).

---

## Phase 9 — Hardening (≈ 2 weeks)

**Goals:** Security audit, performance, observability, E2E tests.

- OWASP ZAP scan, dependency scan, image scan.
- Load test (k6): 200 RPS sustained, 500 peak.
- PII redaction in logs (verified by a unit test scanning log output).
- OpenTelemetry traces live in Jaeger; dashboards in Grafana.
- Playwright E2E: login, deposit, transfer, loan apply, card block, report run.

---

## Phase 10 — DevOps & Release (≈ 1.5 weeks)

**Goals:** Dockerfiles, compose, Kubernetes manifests, CI/CD, prod configs, README polish.

- Multi-stage Dockerfiles (backend, frontend).
- `docker-compose.yml` (full local stack) and `docker-compose.prod.yml`.
- Kubernetes manifests (Postgres StatefulSet, Redis, backend/frontend Deployments, Ingress,
  ConfigMap, Secret example, HPA).
- GitHub Actions: backend CI (build + test + coverage + OpenAPI diff), frontend CI
  (lint + test + build + bundle-size budget), deploy jobs for staging/prod.
- Production-ready `application-prod.yml` with sane defaults.
- Operator runbook in `docs/runbook.md`.

---

## Definition of Done (per phase)

A phase is **DONE** only when:

1. All design documents for the phase are committed.
2. All code for the phase is merged to `main` with two approvals.
3. CI is green: build, tests, lint, coverage, OpenAPI diff, image build.
4. The phase's verification steps (in the design doc) have been executed and recorded.
5. The `docs/phase-N/04-frontend.md` walkthrough was reviewed by the FE lead.
6. ADR was written for every non-trivial decision.

---

## Milestones

| Date (target)   | Milestone                          |
| --------------- | ---------------------------------- |
| End of Phase 2  | Internal users + auth working      |
| End of Phase 4  | Core banking transactions live     |
| End of Phase 5  | Loan + card flows live             |
| End of Phase 7  | Notifications + reports live       |
| End of Phase 9  | Performance & security accepted    |
| End of Phase 10 | Production release candidate (RC1) |
