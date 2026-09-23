# Phase 1 · Database Schema (PostgreSQL)

This document specifies the **canonical** PostgreSQL schema for the Core Banking Platform.
It is the source of truth for Flyway migrations starting Phase 2. The DDL here is
**illustrative** (Phase 1 is design only); actual `V<ts>__*.sql` files are authored in
Phase 2+ and committed under `backend/src/main/resources/db/migration/`.

---

## Conventions

- All tables: `snake_case`, plural nouns.
- Primary keys: `bigint GENERATED ALWAYS AS IDENTITY` (BIGINT in app code).
- All timestamps: `TIMESTAMPTZ` (UTC). Money minor units: `BIGINT`. Rates: `NUMERIC(10,6)`.
- Soft delete: `deleted_at TIMESTAMPTZ NULL` on major entities.
- Audit columns: `created_at`, `updated_at`, `created_by`, `updated_by`, `version BIGINT`.
- Foreign keys: `ON DELETE RESTRICT` for ledger, `ON DELETE CASCADE` for child rows of an
  owned parent.
- Indexes: every FK column gets an index. Composite indexes on common filter/sort columns.
- All `*_id` FKs declared `BIGINT NOT NULL REFERENCES ...(id) ON DELETE RESTRICT`.
- Unique constraints are explicit (`UNIQUE`); partial unique indexes for soft-deletable
  entities (`WHERE deleted_at IS NULL`).

---

## DDL Outline (Phase 1 — Overview)

The full DDL is in `db/migration/V000__phase1_overview.sql` (deferred to Phase 2). Below
is a high-fidelity outline with the most important fields. Naming matches the ER diagram.

```sql
-- 0. Reference / lookup
CREATE TABLE currencies (
  code         CHAR(3) PRIMARY KEY,
  name         VARCHAR(64) NOT NULL,
  numeric_code INTEGER NOT NULL UNIQUE,
  minor_unit   SMALLINT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE fx_rates (
  id              BIGINT PRIMARY KEY,
  from_currency   CHAR(3) NOT NULL REFERENCES currencies(code),
  to_currency     CHAR(3) NOT NULL REFERENCES currencies(code),
  rate            NUMERIC(20,10) NOT NULL,
  effective_at    TIMESTAMPTZ NOT NULL,
  CONSTRAINT fx_rates_pair UNIQUE (from_currency, to_currency, effective_at)
);

-- 1. Identity & access
CREATE TABLE users (
  id                 BIGINT PRIMARY KEY,
  username           VARCHAR(64) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(20),
  password_hash      VARCHAR(255) NOT NULL,
  preferred_locale   VARCHAR(8) NOT NULL DEFAULT 'en',
  mfa_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc     VARCHAR(255),
  last_login_at      TIMESTAMPTZ,
  locked             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         VARCHAR(64),
  updated_by         VARCHAR(64),
  deleted_at         TIMESTAMPTZ,
  version            BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT users_username_uniq UNIQUE (username),
  CONSTRAINT users_email_uniq    UNIQUE (email)
);
CREATE UNIQUE INDEX users_phone_uniq_active
  ON users(phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE roles (
  id          BIGINT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255),
  system      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE permissions (
  id          BIGINT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255)
);

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 2. Branches & employees
CREATE TABLE branches (
  id                BIGINT PRIMARY KEY,
  code              VARCHAR(16) NOT NULL UNIQUE,
  ifsc              VARCHAR(11) NOT NULL UNIQUE,
  name              VARCHAR(128) NOT NULL,
  address_line1     VARCHAR(255) NOT NULL,
  address_line2     VARCHAR(255),
  city              VARCHAR(64) NOT NULL,
  state             VARCHAR(64) NOT NULL,
  postal_code       VARCHAR(16) NOT NULL,
  country           VARCHAR(64) NOT NULL,
  phone             VARCHAR(20),
  manager_employee_id BIGINT,
  working_hours     JSONB NOT NULL,
  status            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        VARCHAR(64),
  updated_by        VARCHAR(64),
  deleted_at        TIMESTAMPTZ,
  version           BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE employees (
  id              BIGINT PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id),
  branch_id       BIGINT NOT NULL REFERENCES branches(id),
  employee_code   VARCHAR(32) NOT NULL UNIQUE,
  designation     VARCHAR(64) NOT NULL,
  date_of_joining DATE NOT NULL,
  salary_minor    BIGINT,
  salary_currency CHAR(3) REFERENCES currencies(code),
  status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  version         BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE branches
  ADD CONSTRAINT branches_manager_fk FOREIGN KEY (manager_employee_id) REFERENCES employees(id);

-- 3. Customers
CREATE TABLE customers (
  id               BIGINT PRIMARY KEY,
  user_id          BIGINT REFERENCES users(id),
  customer_type    VARCHAR(16) NOT NULL CHECK (customer_type IN ('RETAIL','CORPORATE')),
  full_name        VARCHAR(160) NOT NULL,
  date_of_birth    DATE,
  gender           VARCHAR(16),
  email            VARCHAR(255),
  phone            VARCHAR(20),
  pan              VARCHAR(16),
  aadhaar          VARCHAR(16),
  passport         VARCHAR(20),
  occupation       VARCHAR(64),
  income_minor     BIGINT,
  income_currency  CHAR(3) REFERENCES currencies(code),
  risk_category    VARCHAR(16) NOT NULL DEFAULT 'LOW',
  credit_score     INTEGER,
  kyc_status       VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  kyc_verified_at  TIMESTAMPTZ,
  branch_id        BIGINT REFERENCES branches(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       VARCHAR(64),
  updated_by       VARCHAR(64),
  deleted_at       TIMESTAMPTZ,
  version          BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX customers_pan_uniq_active
  ON customers(pan) WHERE pan IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE customer_addresses (
  id           BIGINT PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_type VARCHAR(16) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city         VARCHAR(64) NOT NULL,
  state        VARCHAR(64) NOT NULL,
  postal_code  VARCHAR(16) NOT NULL,
  country      VARCHAR(64) NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE customer_nominees (
  id            BIGINT PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name     VARCHAR(160) NOT NULL,
  date_of_birth DATE,
  relationship  VARCHAR(32),
  share_percent NUMERIC(5,2) NOT NULL,
  id_type       VARCHAR(16),
  id_number     VARCHAR(32)
);

CREATE TABLE customer_documents (
  id           BIGINT PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  doc_type     VARCHAR(32) NOT NULL,
  storage_key  VARCHAR(512) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  size_bytes   BIGINT NOT NULL,
  uploaded_by  VARCHAR(64) NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_timeline (
  id           BIGINT PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type   VARCHAR(64) NOT NULL,
  payload      JSONB NOT NULL,
  actor        VARCHAR(64) NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_timeline_cust_occurred ON customer_timeline(customer_id, occurred_at DESC);

-- 4. Accounts
CREATE TABLE accounts (
  id                    BIGINT PRIMARY KEY,
  account_number        VARCHAR(32) NOT NULL,
  customer_id           BIGINT NOT NULL REFERENCES customers(id),
  account_type          VARCHAR(16) NOT NULL CHECK (account_type IN
    ('SAVINGS','CURRENT','SALARY','NRE','NRO','FD','RD')),
  status                VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  currency_code         CHAR(3) NOT NULL REFERENCES currencies(code),
  balance_minor         BIGINT NOT NULL DEFAULT 0,
  available_balance_minor BIGINT NOT NULL DEFAULT 0,
  interest_rate         NUMERIC(10,6),
  opened_at             TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  branch_id             BIGINT REFERENCES branches(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            VARCHAR(64),
  updated_by            VARCHAR(64),
  deleted_at            TIMESTAMPTZ,
  version               BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX accounts_number_uniq ON accounts(account_number) WHERE deleted_at IS NULL;
CREATE INDEX accounts_customer ON accounts(customer_id);
CREATE INDEX accounts_branch   ON accounts(branch_id);

CREATE TABLE account_interest_ledger (
  id            BIGINT PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id),
  posting_date  DATE NOT NULL,
  amount_minor  BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  rate          NUMERIC(10,6) NOT NULL,
  description   TEXT
);
CREATE INDEX account_interest_account_date ON account_interest_ledger(account_id, posting_date DESC);

-- 5. Transactions
CREATE TABLE transactions (
  id                 BIGINT PRIMARY KEY,
  txn_reference      VARCHAR(48) NOT NULL UNIQUE,
  from_account_id    BIGINT REFERENCES accounts(id),
  to_account_id      BIGINT REFERENCES accounts(id),
  customer_id        BIGINT NOT NULL REFERENCES customers(id),
  type               VARCHAR(32) NOT NULL,
  status             VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  amount_minor       BIGINT NOT NULL CHECK (amount_minor > 0),
  currency_code      CHAR(3) NOT NULL REFERENCES currencies(code),
  fee_minor          BIGINT NOT NULL DEFAULT 0,
  mode               VARCHAR(32),
  channel            VARCHAR(16) NOT NULL,
  beneficiary_id     BIGINT REFERENCES beneficiaries(id),
  narration          TEXT,
  idempotency_key    VARCHAR(80),
  initiated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  initiated_by       BIGINT NOT NULL REFERENCES users(id),
  branch_id          BIGINT REFERENCES branches(id),
  version            BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT transactions_idem_uniq UNIQUE (initiated_by, idempotency_key)
);
CREATE INDEX transactions_status_initiated ON transactions(status, initiated_at DESC);
CREATE INDEX transactions_customer_initiated ON transactions(customer_id, initiated_at DESC);
CREATE INDEX transactions_from ON transactions(from_account_id, initiated_at DESC);
CREATE INDEX transactions_to   ON transactions(to_account_id,   initiated_at DESC);

CREATE TABLE ledger_entries (
  id                  BIGINT PRIMARY KEY,
  transaction_id      BIGINT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id          BIGINT NOT NULL REFERENCES accounts(id),
  entry_type          VARCHAR(8) NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  currency_code       CHAR(3) NOT NULL REFERENCES currencies(code),
  balance_after_minor BIGINT NOT NULL
);
CREATE INDEX ledger_account_posting ON ledger_entries(account_id, transaction_id DESC);

CREATE TABLE transaction_receipts (
  id             BIGINT PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  storage_key    VARCHAR(512) NOT NULL,
  format         VARCHAR(8) NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_verifications (
  id            BIGINT PRIMARY KEY,
  purpose       VARCHAR(16) NOT NULL,
  reference_id  BIGINT,
  channel       VARCHAR(8) NOT NULL,
  code_hash     VARCHAR(255) NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX otp_purpose_ref ON otp_verifications(purpose, reference_id);

-- 6. Beneficiaries
CREATE TABLE beneficiaries (
  id            BIGINT PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name          VARCHAR(160) NOT NULL,
  account_number VARCHAR(32) NOT NULL,
  ifsc          VARCHAR(11),
  bank_name     VARCHAR(128),
  mode          VARCHAR(16) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  favorite      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at   TIMESTAMPTZ
);
CREATE INDEX beneficiaries_customer ON beneficiaries(customer_id);

-- 7. Loans
CREATE TABLE loan_products (
  id                  BIGINT PRIMARY KEY,
  code                VARCHAR(32) NOT NULL UNIQUE,
  name                VARCHAR(128) NOT NULL,
  type                VARCHAR(16) NOT NULL,
  min_amount_minor    BIGINT NOT NULL,
  max_amount_minor    BIGINT NOT NULL,
  min_tenure_months   INTEGER NOT NULL,
  max_tenure_months   INTEGER NOT NULL,
  base_interest_rate  NUMERIC(10,6) NOT NULL,
  fee_config          JSONB NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE loan_applications (
  id                       BIGINT PRIMARY KEY,
  application_number       VARCHAR(32) NOT NULL UNIQUE,
  product_id               BIGINT NOT NULL REFERENCES loan_products(id),
  customer_id              BIGINT NOT NULL REFERENCES customers(id),
  requested_amount_minor   BIGINT NOT NULL,
  requested_currency       CHAR(3) NOT NULL REFERENCES currencies(code),
  requested_tenure_months  INTEGER NOT NULL,
  status                   VARCHAR(24) NOT NULL,
  credit_score             INTEGER,
  risk_band                VARCHAR(16),
  approved_rate            NUMERIC(10,6),
  approved_amount_minor    BIGINT,
  branch_id                BIGINT REFERENCES branches(id),
  assigned_officer_id      BIGINT REFERENCES employees(id),
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at               TIMESTAMPTZ
);
CREATE INDEX loan_apps_status ON loan_applications(status, submitted_at DESC);

CREATE TABLE loan_accounts (
  id                          BIGINT PRIMARY KEY,
  loan_account_number         VARCHAR(32) NOT NULL UNIQUE,
  application_id              BIGINT NOT NULL UNIQUE REFERENCES loan_applications(id),
  customer_id                 BIGINT NOT NULL REFERENCES customers(id),
  principal_minor             BIGINT NOT NULL,
  currency_code               CHAR(3) NOT NULL REFERENCES currencies(code),
  interest_rate               NUMERIC(10,6) NOT NULL,
  tenure_months               INTEGER NOT NULL,
  emi_minor                   BIGINT NOT NULL,
  outstanding_principal_minor BIGINT NOT NULL,
  outstanding_interest_minor  BIGINT NOT NULL,
  disbursement_date           DATE NOT NULL,
  maturity_date               DATE NOT NULL,
  status                      VARCHAR(16) NOT NULL,
  disbursement_account_id     BIGINT REFERENCES accounts(id)
);

CREATE TABLE loan_repayment_schedule (
  id                    BIGINT PRIMARY KEY,
  loan_account_id       BIGINT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  installment_no        INTEGER NOT NULL,
  due_date              DATE NOT NULL,
  principal_due_minor   BIGINT NOT NULL,
  interest_due_minor    BIGINT NOT NULL,
  emi_minor             BIGINT NOT NULL,
  principal_paid_minor  BIGINT NOT NULL DEFAULT 0,
  interest_paid_minor   BIGINT NOT NULL DEFAULT 0,
  status                VARCHAR(16) NOT NULL,
  UNIQUE (loan_account_id, installment_no)
);

CREATE TABLE loan_repayments (
  id              BIGINT PRIMARY KEY,
  loan_account_id BIGINT NOT NULL REFERENCES loan_accounts(id),
  schedule_id     BIGINT REFERENCES loan_repayment_schedule(id),
  amount_minor    BIGINT NOT NULL,
  currency_code   CHAR(3) NOT NULL REFERENCES currencies(code),
  transaction_id  BIGINT REFERENCES transactions(id),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by     BIGINT REFERENCES users(id)
);

CREATE TABLE loan_foreclosures (
  id                 BIGINT PRIMARY KEY,
  loan_account_id    BIGINT NOT NULL REFERENCES loan_accounts(id),
  request_date       DATE NOT NULL,
  payoff_amount_minor BIGINT NOT NULL,
  transaction_id     BIGINT REFERENCES transactions(id),
  status             VARCHAR(16) NOT NULL
);

-- 8. Fixed Deposits
CREATE TABLE fixed_deposits (
  id                   BIGINT PRIMARY KEY,
  fd_number            VARCHAR(32) NOT NULL UNIQUE,
  account_id           BIGINT NOT NULL REFERENCES accounts(id),
  principal_minor      BIGINT NOT NULL,
  currency_code        CHAR(3) NOT NULL REFERENCES currencies(code),
  interest_rate        NUMERIC(10,6) NOT NULL,
  tenure_months        INTEGER NOT NULL,
  start_date           DATE NOT NULL,
  maturity_date        DATE NOT NULL,
  maturity_amount_minor BIGINT NOT NULL,
  status               VARCHAR(16) NOT NULL,
  renewal_mode         VARCHAR(16),
  linked_account_id    BIGINT REFERENCES accounts(id)
);

CREATE TABLE fd_interest_postings (
  id           BIGINT PRIMARY KEY,
  fd_id        BIGINT NOT NULL REFERENCES fixed_deposits(id) ON DELETE CASCADE,
  posting_date DATE NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  rate         NUMERIC(10,6) NOT NULL
);

CREATE TABLE fd_premature_closures (
  id              BIGINT PRIMARY KEY,
  fd_id           BIGINT NOT NULL REFERENCES fixed_deposits(id),
  closure_date    DATE NOT NULL,
  payout_minor    BIGINT NOT NULL,
  penalty_rate    NUMERIC(10,6) NOT NULL,
  transaction_id  BIGINT REFERENCES transactions(id)
);

CREATE TABLE fd_renewals (
  id          BIGINT PRIMARY KEY,
  old_fd_id   BIGINT NOT NULL REFERENCES fixed_deposits(id),
  new_fd_id   BIGINT NOT NULL REFERENCES fixed_deposits(id),
  renewed_on  DATE NOT NULL,
  new_rate    NUMERIC(10,6) NOT NULL
);

-- 9. Recurring Deposits
CREATE TABLE recurring_deposits (
  id                       BIGINT PRIMARY KEY,
  rd_number                VARCHAR(32) NOT NULL UNIQUE,
  customer_id              BIGINT NOT NULL REFERENCES customers(id),
  account_id               BIGINT NOT NULL REFERENCES accounts(id),
  monthly_installment_minor BIGINT NOT NULL,
  currency_code            CHAR(3) NOT NULL REFERENCES currencies(code),
  interest_rate            NUMERIC(10,6) NOT NULL,
  tenure_months            INTEGER NOT NULL,
  start_date               DATE NOT NULL,
  maturity_date            DATE NOT NULL,
  maturity_amount_minor    BIGINT NOT NULL,
  status                   VARCHAR(16) NOT NULL
);

CREATE TABLE rd_installments (
  id              BIGINT PRIMARY KEY,
  rd_id           BIGINT NOT NULL REFERENCES recurring_deposits(id) ON DELETE CASCADE,
  installment_no  INTEGER NOT NULL,
  due_date        DATE NOT NULL,
  amount_minor    BIGINT NOT NULL,
  status          VARCHAR(16) NOT NULL,
  transaction_id  BIGINT REFERENCES transactions(id),
  UNIQUE (rd_id, installment_no)
);

CREATE TABLE auto_debit_mandates (
  id                 BIGINT PRIMARY KEY,
  rd_id              BIGINT NOT NULL REFERENCES recurring_deposits(id) ON DELETE CASCADE,
  from_account_id    BIGINT NOT NULL REFERENCES accounts(id),
  mandate_reference  VARCHAR(64) NOT NULL UNIQUE,
  status             VARCHAR(16) NOT NULL,
  authorized_on      DATE NOT NULL,
  revoked_on         DATE
);

-- 10. Cards
CREATE TABLE cards (
  id                  BIGINT PRIMARY KEY,
  card_number_hash    VARCHAR(255) NOT NULL UNIQUE,
  last4               CHAR(4) NOT NULL,
  card_type           VARCHAR(8) NOT NULL CHECK (card_type IN ('DEBIT','CREDIT')),
  account_id          BIGINT NOT NULL REFERENCES accounts(id),
  customer_id         BIGINT NOT NULL REFERENCES customers(id),
  status              VARCHAR(16) NOT NULL,
  issue_date          DATE NOT NULL,
  expiry_date         DATE NOT NULL,
  network             VARCHAR(16) NOT NULL,
  embossed_name       VARCHAR(64) NOT NULL,
  credit_limit_minor  BIGINT,
  currency_code       CHAR(3) NOT NULL REFERENCES currencies(code)
);

CREATE TABLE card_pin_history (
  id         BIGINT PRIMARY KEY,
  card_id    BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  pin_hash   VARCHAR(255) NOT NULL,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX card_pin_card ON card_pin_history(card_id, set_at DESC);

CREATE TABLE card_limits (
  id            BIGINT PRIMARY KEY,
  card_id       BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  limit_type    VARCHAR(16) NOT NULL,
  daily_minor   BIGINT NOT NULL,
  monthly_minor BIGINT NOT NULL
);

CREATE TABLE card_replacements (
  id            BIGINT PRIMARY KEY,
  old_card_id   BIGINT NOT NULL REFERENCES cards(id),
  new_card_id   BIGINT REFERENCES cards(id),
  reason        VARCHAR(255) NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE card_transactions (
  id               BIGINT PRIMARY KEY,
  card_id          BIGINT NOT NULL REFERENCES cards(id),
  amount_minor     BIGINT NOT NULL,
  currency_code    CHAR(3) NOT NULL REFERENCES currencies(code),
  merchant_category VARCHAR(64),
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_txn_card_posted ON card_transactions(card_id, posted_at DESC);

-- 11. Cheques
CREATE TABLE cheque_books (
  id           BIGINT PRIMARY KEY,
  book_number  VARCHAR(32) NOT NULL UNIQUE,
  account_id   BIGINT NOT NULL REFERENCES accounts(id),
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  series_from  VARCHAR(16) NOT NULL,
  series_to    VARCHAR(16) NOT NULL,
  leaf_count   INTEGER NOT NULL,
  status       VARCHAR(16) NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cheque_leaves (
  id                       BIGINT PRIMARY KEY,
  cheque_book_id           BIGINT NOT NULL REFERENCES cheque_books(id) ON DELETE CASCADE,
  leaf_number              VARCHAR(16) NOT NULL,
  amount_minor             BIGINT,
  payee_name               VARCHAR(160),
  issue_date               DATE,
  clearing_date            DATE,
  status                   VARCHAR(16) NOT NULL,
  clearing_transaction_id  BIGINT REFERENCES transactions(id),
  UNIQUE (cheque_book_id, leaf_number)
);

CREATE TABLE stop_payment_requests (
  id            BIGINT PRIMARY KEY,
  cheque_leaf_id BIGINT NOT NULL REFERENCES cheque_leaves(id),
  reason        VARCHAR(255) NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by  BIGINT NOT NULL REFERENCES users(id),
  status        VARCHAR(16) NOT NULL
);

CREATE TABLE cheque_clearing (
  id              BIGINT PRIMARY KEY,
  cheque_leaf_id  BIGINT NOT NULL REFERENCES cheque_leaves(id),
  batch_date      DATE NOT NULL,
  clearing_status VARCHAR(16) NOT NULL,
  clearing_response TEXT
);

-- 12. Notifications
CREATE TABLE notification_templates (
  id        BIGINT PRIMARY KEY,
  code      VARCHAR(64) NOT NULL,
  channel   VARCHAR(8)  NOT NULL,
  subject   VARCHAR(255),
  body      TEXT NOT NULL,
  locale    VARCHAR(8)  NOT NULL,
  UNIQUE (code, channel, locale)
);

CREATE TABLE notifications (
  id            BIGINT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  channel       VARCHAR(8) NOT NULL,
  template_code VARCHAR(64) NOT NULL,
  params        JSONB NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  scheduled_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notifications_user_status ON notifications(user_id, status);

CREATE TABLE notification_dispatch_log (
  id              BIGINT PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  provider        VARCHAR(32) NOT NULL,
  provider_response TEXT,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          VARCHAR(16) NOT NULL
);

-- 13. Reports
CREATE TABLE reports (
  id            BIGINT PRIMARY KEY,
  code          VARCHAR(64) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  description   TEXT,
  params_schema JSONB NOT NULL
);

CREATE TABLE report_runs (
  id            BIGINT PRIMARY KEY,
  report_id     BIGINT NOT NULL REFERENCES reports(id),
  run_by        BIGINT NOT NULL REFERENCES users(id),
  params        JSONB NOT NULL,
  format        VARCHAR(8) NOT NULL,
  storage_key   VARCHAR(512),
  status        VARCHAR(16) NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- 14. Audit
CREATE TABLE audit_log (
  id           BIGINT PRIMARY KEY,
  entity_type  VARCHAR(64) NOT NULL,
  entity_id    BIGINT,
  action       VARCHAR(64) NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  user_id      BIGINT REFERENCES users(id),
  branch_id    BIGINT REFERENCES branches(id),
  ip_address   INET,
  user_agent   VARCHAR(255),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_occurred ON audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_user_occurred ON audit_log(user_id, occurred_at DESC);

-- 15. Idempotency
CREATE TABLE idempotency_keys (
  id           BIGINT PRIMARY KEY,
  key          VARCHAR(80) NOT NULL,
  endpoint     VARCHAR(128) NOT NULL,
  request_hash VARCHAR(128) NOT NULL,
  response     JSONB,
  status       INTEGER,
  user_id      BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, endpoint)
);
```

## Indexes & Constraints Summary

- Every FK column is indexed.
- Soft-deletable entities have partial unique indexes (`WHERE deleted_at IS NULL`).
- Money columns are `BIGINT` (minor units) + `currency_code` FK — no `DECIMAL` for money.
- Audit log is append-only with descending-time composite indexes for fast range reads.
- `transactions (initiated_by, idempotency_key)` is `UNIQUE` for replay safety.
- `accounts.account_number`, `users.username`, `users.email`, `customers.pan`, `branches.ifsc`,
  `branches.code`, `loan_accounts.loan_account_number`, `fixed_deposits.fd_number`,
  `recurring_deposits.rd_number` are `UNIQUE`.

## Roles Seeded by Migration

- `SUPER_ADMIN`, `BANK_ADMIN`, `BRANCH_MANAGER`, `TELLER`, `LOAN_OFFICER`,
  `CUSTOMER_SERVICE`, `OPERATIONS`, `AUDITOR`, `CUSTOMER` — created in `V001__seed_roles.sql`
  in Phase 2.

## Currencies Seeded

`INR`, `USD`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`, `SGD`, `AED`, `CNY` — in
`V002__seed_currencies.sql` in Phase 2.
