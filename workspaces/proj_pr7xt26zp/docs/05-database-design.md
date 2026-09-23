# Phase 1 — Database Design (PostgreSQL 16)

> Normalized to 3NF. All tables inherit `id BIGSERIAL/BIGINT`, audit columns, `deleted BOOLEAN`, optimistic `version BIGINT`. Money is `NUMERIC(19,4)`. Timestamps are `TIMESTAMPTZ` (UTC). FKs have explicit `ON DELETE` policy. Indexes are listed per table.

## 4.1 Conventions

- Schema: `bank` (default), migrations under `db/migration`
- Primary key: `BIGINT GENERATED ALWAYS AS IDENTITY`
- Names: `snake_case`, plural table names, singular columns
- Soft delete: `deleted BOOLEAN NOT NULL DEFAULT FALSE`; queries always filter unless noted
- Audit columns on every table: `created_at, created_by, updated_at, updated_by`
- Encoding: `UTF8`, collation: `en_US.utf8` (configurable per locale)
- UUID used for external IDs (`uuid` column + unique index)
- Multi-tenancy: not in Phase 1 (single bank); reserved `tenant_id` column on top-level tables

## 4.2 Tables (DDL summary; full SQL delivered in Phase 2)

### Platform / Identity

- `users (id, uuid, username UNIQUE, email UNIQUE, phone, password_hash, principal_type, status, mfa_enabled, mfa_secret_enc, last_login_at, failed_login_count, locked_until, locale, theme, tenant_id, ...)`
- `roles (id, code UNIQUE, name, description, is_system)`
- `permissions (id, code UNIQUE, description, module)`
- `role_permissions (role_id, permission_id)` PK(role_id, permission_id)
- `user_roles (user_id, role_id, branch_id NULL)` PK(user_id, role_id, branch_id)
- `branches (id, code UNIQUE, name, ifsc UNIQUE, address_json, phone, email, manager_id, cash_balance, working_hours_json, status, opened_at, tenant_id)`
- `employees (id, user_id UNIQUE, employee_code UNIQUE, branch_id, designation, department, joining_date, leaving_date, salary, status, manager_id)`
- `refresh_tokens (id, user_id, token_hash UNIQUE, device_id, issued_at, expires_at, revoked_at, replaced_by_id, ip, user_agent)`
- `devices (id, user_id, fingerprint, name, os, browser, ip, trusted, last_seen_at)`

### Customer

- `customers (id, uuid, customer_code UNIQUE, full_name, dob, gender, email, phone, pan_enc, aadhaar_enc, passport_enc, occupation, annual_income, risk_category, credit_score, kyc_status, kyc_verified_at, kyc_verified_by, branch_id, status, nominee_json, address_json, tenant_id)`
- `kyc_documents (id, customer_id, doc_type, doc_number_enc, file_path, content_hash, mime, size, expires_at, status, uploaded_at, verified_at, verified_by)`
- `customer_events (id, customer_id, type, payload_json, actor_id, occurred_at)`
- `addresses (id, owner_type, owner_id, line1, line2, city, state, country, postal_code, is_primary)`

### Account

- `account_products (id, code UNIQUE, name, type, currency, interest_rate, min_balance, max_withdrawal_daily, min_age, ...)`
- `accounts (id, uuid, account_number UNIQUE, customer_id, product_id, branch_id, currency, balance, available_balance, hold_amount, status, opened_at, closed_at, interest_rate, nominee_json, tenant_id)`
- `fd_accounts (id, account_id, principal, rate, tenure_months, start_date, maturity_date, maturity_amount, premature_allowed, auto_renew)`
- `rd_accounts (id, account_id, monthly_installment, rate, tenure_months, start_date, maturity_date, maturity_amount, missed_count)`
- `account_holds (id, account_id, amount, reason, placed_at, released_at, status)`

### Beneficiary

- `beneficiaries (id, customer_id, nickname, account_number, ifsc, bank_name, type, is_favorite, is_verified, verified_at, last_used_at)`

### Transaction & Ledger

- `transactions (id, uuid, txn_number UNIQUE, type, channel, status, amount, currency, from_account_id, to_account_id, beneficiary_id, branch_id, initiated_by, authorized_by, description, metadata_json, failure_reason, completed_at)`
- `ledger_accounts (id, code UNIQUE, name, type, currency, parent_id)`
- `ledger_entries (id, transaction_id, ledger_account_id, dc, amount, currency, value_date, posted_at, reverses_entry_id)` — DC ∈ {DEBIT, CREDIT}; `CHECK (amount > 0)`; partial unique `(transaction_id, ledger_account_id, dc)` not required (multi-leg allowed)
- `idempotency_keys (key PRIMARY KEY, user_id, request_hash, response_status, response_body, created_at, expires_at)`
- `transaction_limits (id, scope, scope_id, type, daily_count, daily_amount, per_txn_max)`

### Loan

- `loan_products (id, code UNIQUE, name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, base_rate, processing_fee_pct)`
- `loan_applications (id, application_no UNIQUE, customer_id, product_id, principal, tenure_months, rate, status, branch_id, assigned_to, decision_at, decision_by, decision_notes)`
- `loan_credit_checks (id, application_id, provider, score, risk_band, payload_json, checked_at)`
- `loan_accounts (id, application_id UNIQUE, account_id, principal_disbursed, rate, tenure_months, emi_amount, disbursed_at, outstanding_principal, status)`
- `emi_schedules (id, loan_account_id, installment_no, due_date, principal_due, interest_due, total_due, paid_amount, paid_at, status)`
- `loan_repayments (id, loan_account_id, amount, principal_part, interest_part, penalty, txn_id, paid_at)`
- `loan_foreclosures (id, loan_account_id, requested_at, approved_at, outstanding, interest_payable, processed_by, status)`

### Card

- `cards (id, card_number_hash, pan_masked, customer_id, account_id, type, brand, status, issued_at, expires_at, pin_hash, daily_limit, monthly_limit, international_allowed, contactless)`
- `card_lifecycle_events (id, card_id, event, actor_id, occurred_at, reason)`

### Cheque

- `cheque_books (id, account_id, from_number, to_number, issued_at, status)`
- `cheques (id, cheque_book_id, cheque_number, amount, payee, status, presented_at, cleared_at, bounced_reason, image_path)`
- `stop_payment_requests (id, account_id, from_number, to_number, reason, requested_by, requested_at, status, valid_until)`

### FX

- `currencies (code PK, name, symbol, decimal_places, is_active)`
- `exchange_rates (id, base_currency, quote_currency, rate, effective_date, source)` UNIQUE(base, quote, effective_date)

### Notification

- `notification_templates (id, code UNIQUE, channel, locale, subject, body, variables_json)`
- `notification_logs (id, recipient_user_id, channel, template_code, payload_json, status, sent_at, error)`

### Audit

- `audit_log (id, entity_type, entity_id, action, old_value_json, new_value_json, actor_id, actor_ip, user_agent, occurred_at, signature_hmac)`

### Reporting (read models)

- `mv_daily_branch_summary (branch_id, day, txn_count, debit_total, credit_total, fees_total)` — MATERIALIZED VIEW
- `mv_customer_growth (month, new_customers, active_customers)` — MATERIALIZED VIEW
- `mv_loan_portfolio (month, product_id, disbursed, outstanding, npa_amount)` — MATERIALIZED VIEW

## 4.3 Key Indexes

```sql
-- users
CREATE UNIQUE INDEX ux_users_username ON users(username) WHERE deleted = FALSE;
CREATE UNIQUE INDEX ux_users_email    ON users(email)    WHERE deleted = FALSE;
CREATE INDEX ix_users_phone ON users(phone);

-- customers
CREATE INDEX ix_customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX ix_customers_phone ON customers(phone);
CREATE INDEX ix_customers_branch ON customers(branch_id) WHERE deleted = FALSE;

-- accounts
CREATE UNIQUE INDEX ux_accounts_number ON accounts(account_number);
CREATE INDEX ix_accounts_customer ON accounts(customer_id);
CREATE INDEX ix_accounts_branch_status ON accounts(branch_id, status);

-- transactions
CREATE INDEX ix_txn_completed_at ON transactions(completed_at DESC);
CREATE INDEX ix_txn_from ON transactions(from_account_id, completed_at DESC);
CREATE INDEX ix_txn_to   ON transactions(to_account_id,   completed_at DESC);
CREATE INDEX ix_txn_status_type ON transactions(status, type);

-- ledger_entries
CREATE INDEX ix_ledger_acct ON ledger_entries(ledger_account_id, posted_at);
CREATE INDEX ix_ledger_txn  ON ledger_entries(transaction_id);

-- loans
CREATE INDEX ix_loan_app_status ON loan_applications(status, branch_id);
CREATE INDEX ix_loan_account_status ON loan_accounts(status);

-- audit
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id, occurred_at DESC);
```

## 4.4 Constraints / Checks

- `accounts`: `CHECK (balance >= 0)` (overdraft handled by product flag + limit)
- `ledger_entries`: `CHECK (amount > 0)`, `CHECK (dc IN ('DEBIT','CREDIT'))`
- `transactions`: `CHECK (amount > 0)`, `CHECK (status IN ('PENDING','SUCCESS','FAILED','REVERSED'))`
- `loan_repayments`: `CHECK (amount > 0)`, `CHECK (principal_part + interest_part + penalty = amount)`
- `emi_schedules`: `CHECK (total_due = principal_due + interest_due)`
- `users`: `CHECK (failed_login_count >= 0)`
- `idempotency_keys`: `expires_at` indexed; nightly purge
- FKs: most `ON DELETE RESTRICT`; audit `ON DELETE RESTRICT` (immutability)

## 4.5 Soft Delete Pattern

- All mutable tables: `deleted BOOLEAN NOT NULL DEFAULT FALSE` + index
- Hibernate `@SQLDelete(sql="UPDATE x SET deleted=TRUE WHERE id=?")` + `@Where(clause="deleted=false")`
- Admin endpoints may bypass via `nativeQuery=true` and `deleted=true` filter

## 4.6 Encryption-at-Rest

- PII columns: `pan_enc BYTEA`, `aadhaar_enc BYTEA`, `passport_enc BYTEA`, `card_number_hash BYTEA`
- Encryption: AES-256-GCM with per-column IV; key from `KMS_KEY` env (or Vault later)
- Hashing: BCrypt strength 12 for passwords; SHA-256 + salt for PAN retrieval token (never log)

## 4.7 ER Diagram (textual)

```
                ┌──────────────┐         ┌──────────────┐
                │   branches   │◄────────│  employees   │
                └──────┬───────┘   1   N └──────┬───────┘
                       │                        │
                       │ 1                      │ 1
                       ▼ N                      ▼ 1
                ┌──────────────┐         ┌──────────────┐
                │  customers   │         │    users     │
                └──────┬───────┘         └──────┬───────┘
                       │ 1                      │ 1
                       ▼ N                      ▼ N
                ┌──────────────┐         ┌──────────────┐
                │   accounts   │◄────────┤  user_roles  │
                └──────┬───────┘   N  1  └──────┬───────┘
                       │ 1                      │ N
                       │                        │ 1
                       ▼ N                      ▼ N
                ┌──────────────┐         ┌──────────────┐
                │transactions  │         │    roles     │
                └──────┬───────┘         └──────┬───────┘
                       │ 1                      │ N
                       │                        │ N
                       ▼ N                      ▼ N
                ┌──────────────┐         ┌──────────────┐
                │ledger_entries│         │ permissions  │
                └──────┬───────┘         └──────────────┘
                       │ N
                       │ 1
                       ▼
                ┌──────────────┐
                │ledger_accts  │
                └──────────────┘

beneficiaries ──► customers (N:1)
loan_applications ──► customers, loan_products, branches
loan_accounts ──► loan_applications, accounts
emi_schedules ──► loan_accounts
loan_repayments ──► loan_accounts, transactions
cards ──► customers, accounts
cheques ──► cheque_books ──► accounts
kyc_documents ──► customers
fx_rates ──► (currency pairs)
audit_log ──► polymorphic (entity_type, entity_id)
notification_logs ──► users
```

## 4.8 Flyway Strategy

- `db/migration/V1__init_platform.sql`
- `V2__identity.sql`
- `V3__customer.sql`
- `V4__account.sql`
- `V5__txn_ledger.sql`
- `V6__loan.sql`
- `V7__card_cheque_fx.sql`
- `V8__notification_audit.sql`
- `V9__seed_roles_permissions.sql`
- `V10__seed_currencies.sql`
- `V11__reporting_views.sql`
- `R__refresh_reporting_views.sql` (repeatable)

## 4.9 Backup / DR

- Daily full backup + WAL archiving
- PITR: 7 days
- Test restore: monthly
- RPO ≤ 5 min, RTO ≤ 30 min
