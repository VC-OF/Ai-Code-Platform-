# Phase 1 — Requirements Analysis

> Principal Architect sign-off document. Every requirement below is traced to a module, an actor, and an acceptance test.

## 1.1 Functional Scope

### Banking Channels

| Channel           | Description                                            | Primary Modules                       |
| ----------------- | ------------------------------------------------------ | ------------------------------------- |
| Retail Banking    | Individual customers — savings, salary, loans, cards   | Accounts, Loans, Cards, RD/FD         |
| Corporate Banking | Businesses — current accounts, bulk transfers, payroll | Accounts, Transactions, Beneficiaries |
| Branch Banking    | Walk-in operations by tellers / managers               | Teller, Cash, Cheque                  |

### Cross-Cutting Capabilities

- **Multi-Branch:** Every monetary record carries `branch_id`; balances are branch-scoped and consolidated.
- **Multi-Currency:** ISO-4217 currency code on every monetary field; FX service with daily rate snapshot.
- **Multi-Language (i18n):** `messages_{locale}.properties` on backend; `i18next` on frontend. Locales: `en`, `hi`, `ar`, `es`, `fr`, `zh`.
- **Role-Based Access Control (RBAC):** 9 roles, 60+ granular permissions, permission keys used in `@PreAuthorize`.
- **Audit Logging:** Every mutation persists `audit_log` row (old/new JSON, actor, IP, UA, timestamp).
- **Notifications:** Email (SMTP), SMS (provider-agnostic adapter), Push (FCM), In-App (WebSocket + DB queue).

## 1.2 Non-Functional Requirements

| Category        | Target                                                    |
| --------------- | --------------------------------------------------------- |
| Availability    | 99.95%                                                    |
| Latency (p95)   | < 300 ms for reads, < 600 ms for writes                   |
| Throughput      | 500 TPS sustained, 2000 TPS burst (per service)           |
| Data integrity  | ACID for all monetary ops; double-entry ledger            |
| Compliance      | KYC/AML hooks, data residency, PII encryption at rest     |
| Security        | OWASP ASVS L2 baseline                                    |
| Observability   | Structured logs, OpenTelemetry traces, Prometheus metrics |
| Accessibility   | WCAG 2.1 AA on the frontend                               |
| Localization    | 6 locales at launch                                       |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari          |
| Test coverage   | ≥ 80% line, ≥ 75% branch (backend); ≥ 70% (frontend)      |

## 1.3 Actor Catalogue

| Actor                | Description              | Primary Use Cases                               |
| -------------------- | ------------------------ | ----------------------------------------------- |
| **Super Admin**      | Platform owner           | Tenant config, feature flags, global reports    |
| **Bank Admin**       | Bank-level administrator | Branches, employees, roles, limits, currency    |
| **Branch Manager**   | Branch owner             | Approvals, daily reports, cash management       |
| **Teller**           | Front-line staff         | Deposits, withdrawals, cheque ops               |
| **Loan Officer**     | Loan processing          | Loan origination, credit checks, disbursement   |
| **Customer Service** | Support agent            | Customer queries, dispute, freeze accounts      |
| **Operations**       | Back office              | Reconciliations, settlements, batch jobs        |
| **Auditor**          | Read-only across data    | Reports, audit trail, compliance checks         |
| **Customer**         | End user (web)           | Self-service: accounts, transfers, loans, cards |

## 1.4 Regulatory & Compliance Touchpoints

- **KYC:** `kyc_status` on customer; document vault with content-hash and expiry tracking.
- **AML:** Sanctions screening adapter interface; velocity checks on transactions.
- **Data protection:** PII columns encrypted with AES-256-GCM via JPA `AttributeConverter`; column-level KMS.
- **Audit immutability:** `audit_log` is append-only, signed with HMAC chain.
- **PCI-DSS scope minimization:** PAN masked except last 4; CVV never persisted.

## 1.5 Acceptance Criteria (top 10)

1. A customer can open a Savings account with KYC and receive an auto-generated 14-digit account number.
2. A teller can post a cash deposit; ledger is balanced (sum debits = sum credits) at all times.
3. A funds transfer with insufficient balance returns a typed `INSUFFICIENT_FUNDS` error, no money moves, no partial state.
4. All write endpoints require a valid `Idempotency-Key`; replays return the original response.
5. RBAC denies a Teller from approving a Loan; the API returns `403` and the attempt is audited.
6. Every mutation creates an `audit_log` row with `old_value`/`new_value` JSON diffs.
7. Daily-interest accrual job runs at 23:55 server-time, is idempotent for the day, and posts to the ledger.
8. A loan EMI schedule is generated at disbursement; partial payments reduce principal + interest correctly.
9. Currency conversion uses the day's snapshot rate; revaluation job records FX gain/loss in a separate ledger.
10. The system degrades gracefully: Redis down → in-memory rate limiter fallback; SMTP down → in-app notification.

## 1.6 Out of Scope (Phase 1, future backlog)

- Trade finance, treasury, FX trading desk
- Open Banking / PSD2 (planned Phase 7+)
- AI-based credit scoring (hook only)
- Native mobile apps (responsive web only)
- Blockchain / CBDC integration

## 1.7 Traceability Matrix (sample)

| Req ID        | Description                    | Module             | Actor        | Test ID      |
| ------------- | ------------------------------ | ------------------ | ------------ | ------------ |
| REQ-AUTH-001  | Login with username + password | Authentication     | All          | TC-AUTH-001  |
| REQ-CUST-010  | Open savings account           | Customer + Account | Customer     | TC-CUST-010  |
| REQ-TXN-020   | Internal transfer with OTP     | Transactions       | Customer     | TC-TXN-020   |
| REQ-LOAN-030  | Home loan EMI schedule         | Loans              | Loan Officer | TC-LOAN-030  |
| REQ-AUDIT-001 | Audit every mutation           | Audit              | System       | TC-AUDIT-001 |
