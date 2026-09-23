# Phase 1 · ER Diagram

The complete entity-relationship model for the Core Banking Platform. The diagram is written in
**Mermaid** so it can be rendered on GitHub, GitLab, IDEs, and most static-site generators.

> Mermaid renders `erDiagram` natively. To preview locally use any Mermaid live editor or the
> `docs-renderer` script we ship in Phase 10.

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : has
    ROLES ||--o{ USER_ROLES : grants
    ROLES ||--o{ ROLE_PERMISSIONS : grants
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "in"
    USERS ||--o| EMPLOYEES : "may be"
    CUSTOMERS ||--o| USERS : "may be"
    EMPLOYEES }o--|| BRANCHES : "works at"
    BRANCHES ||--o{ BRANCH_EMPLOYEES : staffs
    BRANCHES ||--o{ BRANCH_CASH_DRAWERS : "has"

    CUSTOMERS ||--o{ CUSTOMER_ADDRESSES : has
    CUSTOMERS ||--o{ CUSTOMER_NOMINEES : has
    CUSTOMERS ||--o{ CUSTOMER_DOCUMENTS : uploads
    CUSTOMERS ||--o{ CUSTOMER_TIMELINE : tracks
    CUSTOMERS ||--o{ ACCOUNTS : owns
    CUSTOMERS ||--o{ BENEFICIARIES : adds
    CUSTOMERS ||--o{ LOAN_APPLICATIONS : applies
    CUSTOMERS ||--o{ CARDS : holds
    CUSTOMERS ||--o{ CHEQUE_BOOKS : requests

    ACCOUNTS ||--o{ TRANSACTIONS : "from/to"
    ACCOUNTS ||--o{ ACCOUNT_INTEREST_LEDGER : posts
    ACCOUNTS ||--o{ CARDS : "linked to"
    ACCOUNTS ||--o{ CHEQUE_BOOKS : "issues"
    ACCOUNTS ||--o{ FIXED_DEPOSITS : "may be"
    ACCOUNTS ||--o{ RECURRING_DEPOSITS : "may be"

    BENEFICIARIES ||--o{ TRANSACTIONS : "used in"
    TRANSACTIONS ||--o{ LEDGER_ENTRIES : "double entry"
    TRANSACTIONS ||--o{ TRANSACTION_RECEIPTS : generates
    TRANSACTIONS ||--o{ OTP_VERIFICATIONS : requires

    LOAN_PRODUCTS ||--o{ LOAN_APPLICATIONS : "applied for"
    LOAN_APPLICATIONS ||--|| LOAN_ACCOUNTS : "becomes"
    LOAN_ACCOUNTS ||--o{ LOAN_REPAYMENT_SCHEDULE : schedules
    LOAN_ACCOUNTS ||--o{ LOAN_REPAYMENTS : receives
    LOAN_ACCOUNTS ||--o{ LOAN_FORECLOSURES : "may foreclose"

    FIXED_DEPOSITS ||--o{ FD_INTEREST_POSTINGS : posts
    FIXED_DEPOSITS ||--o{ FD_PREMATURE_CLOSURES : "may close"
    FIXED_DEPOSITS ||--o{ FD_RENEWALS : renews

    RECURRING_DEPOSITS ||--o{ RD_INSTALLMENTS : schedules
    RECURRING_DEPOSITS ||--o{ AUTO_DEBIT_MANDATES : "auto debits"

    CARDS ||--o{ CARD_PIN_HISTORY : rotates
    CARDS ||--o{ CARD_LIMITS : sets
    CARDS ||--o{ CARD_REPLACEMENTS : replaces
    CARDS ||--o{ CARD_TRANSACTIONS : "posts"

    CHEQUE_BOOKS ||--o{ CHEQUE_LEAVES : contains
    CHEQUE_LEAVES ||--o{ STOP_PAYMENT_REQUESTS : "may stop"
    CHEQUE_LEAVES ||--o{ CHEQUE_CLEARING : clears

    NOTIFICATION_TEMPLATES ||--o{ NOTIFICATIONS : renders
    NOTIFICATIONS ||--o{ NOTIFICATION_DISPATCH_LOG : logs

    REPORTS ||--o{ REPORT_RUNS : runs

    AUDIT_LOG }o--o| USERS : "by"
    AUDIT_LOG }o--o| BRANCHES : "at"

    IDEMPOTENCY_KEYS }o--o| USERS : "by"

    CURRENCIES ||--o{ ACCOUNTS : denominates
    CURRENCIES ||--o{ TRANSACTIONS : denominates
    FX_RATES }o--|| CURRENCIES : "from"
    FX_RATES }o--|| CURRENCIES : "to"

    USERS {
        bigint id PK
        varchar username UK
        varchar email UK
        varchar phone UK
        varchar password_hash
        varchar preferred_locale
        boolean mfa_enabled
        timestamp last_login_at
        boolean locked
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    ROLES {
        bigint id PK
        varchar name UK
        varchar description
        boolean system
    }

    PERMISSIONS {
        bigint id PK
        varchar name UK
        varchar description
    }

    USER_ROLES {
        bigint user_id PK,FK
        bigint role_id PK,FK
    }

    ROLE_PERMISSIONS {
        bigint role_id PK,FK
        bigint permission_id PK,FK
    }

    EMPLOYEES {
        bigint id PK
        bigint user_id FK
        bigint branch_id FK
        varchar employee_code UK
        varchar designation
        date date_of_joining
        numeric salary
        varchar salary_currency
        varchar status
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    BRANCHES {
        bigint id PK
        varchar code UK
        varchar ifsc UK
        varchar name
        varchar address_line1
        varchar address_line2
        varchar city
        varchar state
        varchar postal_code
        varchar country
        varchar phone
        bigint manager_employee_id FK
        jsonb working_hours
        varchar status
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    BRANCH_EMPLOYEES {
        bigint branch_id PK,FK
        bigint employee_id PK,FK
    }

    BRANCH_CASH_DRAWERS {
        bigint id PK
        bigint branch_id FK
        varchar currency_code FK
        bigint balance_minor
        bigint version
    }

    CUSTOMERS {
        bigint id PK
        bigint user_id FK
        varchar customer_type "RETAIL|CORPORATE"
        varchar full_name
        date date_of_birth
        varchar gender
        varchar email
        varchar phone
        varchar pan UK
        varchar aadhaar UK
        varchar passport
        varchar occupation
        bigint income_minor
        varchar income_currency
        varchar risk_category "LOW|MEDIUM|HIGH"
        int credit_score
        varchar kyc_status "PENDING|IN_PROGRESS|VERIFIED|REJECTED|EXPIRED"
        timestamp kyc_verified_at
        bigint branch_id FK
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    CUSTOMER_ADDRESSES {
        bigint id PK
        bigint customer_id FK
        varchar address_type "HOME|OFFICE|MAILING|PERMANENT"
        text address_line1
        text address_line2
        varchar city
        varchar state
        varchar postal_code
        varchar country
        boolean primary
    }

    CUSTOMER_NOMINEES {
        bigint id PK
        bigint customer_id FK
        varchar full_name
        date date_of_birth
        varchar relationship
        numeric share_percent
        varchar id_type
        varchar id_number
    }

    CUSTOMER_DOCUMENTS {
        bigint id PK
        bigint customer_id FK
        varchar doc_type
        varchar storage_key
        varchar content_type
        bigint size_bytes
        varchar uploaded_by
        timestamp uploaded_at
    }

    CUSTOMER_TIMELINE {
        bigint id PK
        bigint customer_id FK
        varchar event_type
        jsonb payload
        varchar actor
        timestamp occurred_at
    }

    CURRENCIES {
        varchar code PK
        varchar name
        int numeric_code UK
        int minor_unit
        boolean active
    }

    FX_RATES {
        bigint id PK
        varchar from_currency FK
        varchar to_currency FK
        numeric rate
        timestamp effective_at
    }

    ACCOUNTS {
        bigint id PK
        varchar account_number UK
        bigint customer_id FK
        varchar account_type "SAVINGS|CURRENT|SALARY|NRE|NRO|FD|RD"
        varchar status "PENDING|ACTIVE|DORMANT|CLOSED|FROZEN"
        varchar currency_code FK
        bigint balance_minor
        bigint available_balance_minor
        numeric interest_rate
        timestamp opened_at
        timestamp closed_at
        bigint branch_id FK
        bigint version
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }

    ACCOUNT_INTEREST_LEDGER {
        bigint id PK
        bigint account_id FK
        date posting_date
        bigint amount_minor
        varchar currency_code FK
        numeric rate
        text description
    }

    TRANSACTIONS {
        bigint id PK
        varchar txn_reference UK
        bigint from_account_id FK
        bigint to_account_id FK
        bigint customer_id FK
        varchar type "DEPOSIT|WITHDRAWAL|TRANSFER|UPI|NEFT|RTGS|IMPS|CARD_PAYMENT|INTEREST_CREDIT|SERVICE_CHARGE"
        varchar status "PENDING|SUCCESS|FAILED|REVERSED"
        bigint amount_minor
        varchar currency_code FK
        bigint fee_minor
        varchar mode
        varchar channel "BRANCH|WEB|MOBILE|API"
        bigint beneficiary_id FK
        text narration
        varchar idempotency_key
        timestamp initiated_at
        timestamp completed_at
        bigint initiated_by FK
        bigint branch_id FK
        bigint version
    }

    LEDGER_ENTRIES {
        bigint id PK
        bigint transaction_id FK
        bigint account_id FK
        varchar entry_type "DEBIT|CREDIT"
        bigint amount_minor
        varchar currency_code FK
        bigint balance_after_minor
    }

    TRANSACTION_RECEIPTS {
        bigint id PK
        bigint transaction_id FK
        varchar storage_key
        varchar format
        timestamp generated_at
    }

    OTP_VERIFICATIONS {
        bigint id PK
        varchar purpose "TXN|LOGIN|REGISTER|TRANSFER"
        bigint reference_id
        varchar channel "SMS|EMAIL|TOTP"
        varchar code_hash
        timestamp expires_at
        timestamp consumed_at
        int attempts
    }

    BENEFICIARIES {
        bigint id PK
        bigint customer_id FK
        varchar name
        varchar account_number
        varchar ifsc
        varchar bank_name
        varchar mode "INTERNAL|UPI|NEFT|RTGS|IMPS"
        varchar status "PENDING|VERIFIED|INACTIVE"
        boolean favorite
        timestamp verified_at
    }

    LOAN_PRODUCTS {
        bigint id PK
        varchar code UK
        varchar name
        varchar type "PERSONAL|HOME|VEHICLE|BUSINESS|EDUCATION|GOLD"
        numeric min_amount
        numeric max_amount
        int min_tenure_months
        int max_tenure_months
        numeric base_interest_rate
        jsonb fee_config
        boolean active
    }

    LOAN_APPLICATIONS {
        bigint id PK
        varchar application_number UK
        bigint product_id FK
        bigint customer_id FK
        bigint requested_amount_minor
        varchar requested_currency
        int requested_tenure_months
        varchar status "SUBMITTED|CREDIT_CHECK|RISK_ASSESSMENT|APPROVED|REJECTED|DISBURSED|ACTIVE|CLOSED"
        int credit_score
        varchar risk_band
        numeric approved_rate
        bigint approved_amount_minor
        bigint branch_id FK
        bigint assigned_officer_id FK
        timestamp submitted_at
        timestamp decided_at
    }

    LOAN_ACCOUNTS {
        bigint id PK
        varchar loan_account_number UK
        bigint application_id FK
        bigint customer_id FK
        bigint principal_minor
        varchar currency_code FK
        numeric interest_rate
        int tenure_months
        bigint emi_minor
        bigint outstanding_principal_minor
        bigint outstanding_interest_minor
        date disbursement_date
        date maturity_date
        varchar status "ACTIVE|CLOSED|FORECLOSED|WRITTEN_OFF"
        bigint disbursement_account_id FK
    }

    LOAN_REPAYMENT_SCHEDULE {
        bigint id PK
        bigint loan_account_id FK
        int installment_no
        date due_date
        bigint principal_due_minor
        bigint interest_due_minor
        bigint emi_minor
        bigint principal_paid_minor
        bigint interest_paid_minor
        varchar status "PENDING|PAID|OVERDUE|PARTIAL"
    }

    LOAN_REPAYMENTS {
        bigint id PK
        bigint loan_account_id FK
        bigint schedule_id FK
        bigint amount_minor
        varchar currency_code FK
        bigint transaction_id FK
        timestamp paid_at
        bigint received_by FK
    }

    LOAN_FORECLOSURES {
        bigint id PK
        bigint loan_account_id FK
        date request_date
        bigint payoff_amount_minor
        bigint transaction_id FK
        varchar status "REQUESTED|APPROVED|COMPLETED|REJECTED"
    }

    FIXED_DEPOSITS {
        bigint id PK
        varchar fd_number UK
        bigint account_id FK
        bigint principal_minor
        varchar currency_code FK
        numeric interest_rate
        int tenure_months
        date start_date
        date maturity_date
        bigint maturity_amount_minor
        varchar status "ACTIVE|MATURED|PREMATURE_CLOSED|RENEWED"
        varchar renewal_mode
        bigint linked_account_id FK
    }

    FD_INTEREST_POSTINGS {
        bigint id PK
        bigint fd_id FK
        date posting_date
        bigint amount_minor
        varchar currency_code FK
        numeric rate
    }

    FD_PREMATURE_CLOSURES {
        bigint id PK
        bigint fd_id FK
        date closure_date
        bigint payout_minor
        numeric penalty_rate
        bigint transaction_id FK
    }

    FD_RENEWALS {
        bigint id PK
        bigint old_fd_id FK
        bigint new_fd_id FK
        date renewed_on
        numeric new_rate
    }

    RECURRING_DEPOSITS {
        bigint id PK
        varchar rd_number UK
        bigint customer_id FK
        bigint account_id FK
        bigint monthly_installment_minor
        varchar currency_code FK
        numeric interest_rate
        int tenure_months
        date start_date
        date maturity_date
        bigint maturity_amount_minor
        varchar status "ACTIVE|MATURED|DEFAULTED|CLOSED"
    }

    RD_INSTALLMENTS {
        bigint id PK
        bigint rd_id FK
        int installment_no
        date due_date
        bigint amount_minor
        varchar status "PAID|MISSED|PENDING"
        bigint transaction_id FK
    }

    AUTO_DEBIT_MANDATES {
        bigint id PK
        bigint rd_id FK
        bigint from_account_id FK
        varchar mandate_reference
        varchar status
        date authorized_on
        date revoked_on
    }

    CARDS {
        bigint id PK
        varchar card_number_hash UK
        varchar last4
        varchar card_type "DEBIT|CREDIT"
        bigint account_id FK
        bigint customer_id FK
        varchar status "ISSUED|ACTIVE|BLOCKED|REPLACED|EXPIRED"
        date issue_date
        date expiry_date
        varchar network "VISA|MASTERCARD|RUPAY|AMEX"
        varchar embossed_name
        int credit_limit_minor
        varchar currency_code FK
    }

    CARD_PIN_HISTORY {
        bigint id PK
        bigint card_id FK
        varchar pin_hash
        timestamp set_at
        timestamp revoked_at
    }

    CARD_LIMITS {
        bigint id PK
        bigint card_id FK
        varchar limit_type "ATM|POS|ECOM|INTERNATIONAL"
        bigint daily_minor
        bigint monthly_minor
    }

    CARD_REPLACEMENTS {
        bigint id PK
        bigint old_card_id FK
        bigint new_card_id FK
        varchar reason
        timestamp requested_at
        timestamp completed_at
    }

    CARD_TRANSACTIONS {
        bigint id PK
        bigint card_id FK
        bigint amount_minor
        varchar currency_code FK
        varchar merchant_category
        timestamp posted_at
    }

    CHEQUE_BOOKS {
        bigint id PK
        varchar book_number UK
        bigint account_id FK
        bigint customer_id FK
        varchar series_from
        varchar series_to
        int leaf_count
        varchar status "REQUESTED|ISSUED|IN_USE|EXHAUSTED|EXPIRED"
        timestamp issued_at
    }

    CHEQUE_LEAVES {
        bigint id PK
        bigint cheque_book_id FK
        varchar leaf_number UK
        bigint amount_minor
        varchar payee_name
        date issue_date
        date clearing_date
        varchar status "ISSUED|CLEARED|BOUNCED|STOPPED|EXPIRED|UNCLEARED"
        bigint clearing_transaction_id FK
    }

    STOP_PAYMENT_REQUESTS {
        bigint id PK
        bigint cheque_leaf_id FK
        varchar reason
        timestamp requested_at
        bigint requested_by FK
        varchar status "ACTIVE|REVOKED|EXPIRED"
    }

    CHEQUE_CLEARING {
        bigint id PK
        bigint cheque_leaf_id FK
        date batch_date
        varchar clearing_status
        text clearing_response
    }

    NOTIFICATION_TEMPLATES {
        bigint id PK
        varchar code UK
        varchar channel "EMAIL|SMS|PUSH|INAPP"
        varchar subject
        text body
        varchar locale
    }

    NOTIFICATIONS {
        bigint id PK
        bigint user_id FK
        varchar channel
        varchar template_code
        jsonb params
        varchar status "PENDING|SENT|FAILED"
        timestamp scheduled_at
        timestamp sent_at
        int attempts
    }

    NOTIFICATION_DISPATCH_LOG {
        bigint id PK
        bigint notification_id FK
        varchar provider
        text provider_response
        timestamp attempted_at
        varchar status
    }

    REPORTS {
        bigint id PK
        varchar code UK
        varchar name
        text description
        jsonb params_schema
    }

    REPORT_RUNS {
        bigint id PK
        bigint report_id FK
        bigint run_by FK
        jsonb params
        varchar format "PDF|XLSX|CSV"
        varchar storage_key
        varchar status "QUEUED|RUNNING|COMPLETED|FAILED"
        timestamp started_at
        timestamp completed_at
    }

    AUDIT_LOG {
        bigint id PK
        varchar entity_type
        bigint entity_id
        varchar action
        jsonb old_value
        jsonb new_value
        bigint user_id FK
        bigint branch_id FK
        varchar ip_address
        varchar user_agent
        timestamp occurred_at
    }

    IDEMPOTENCY_KEYS {
        bigint id PK
        varchar key
        varchar endpoint
        varchar request_hash
        jsonb response
        int status
        bigint user_id FK
        timestamp created_at
    }
```

## Notes on the Model

- **Soft delete** is implemented via `deleted_at` columns on the major entities (users,
  employees, branches, customers, accounts). Other transactional entities use hard delete
  (e.g. OTP records) for compliance reasons.
- **Money** is stored as `bigint` **minor units** (e.g. paise) plus a `currency_code` FK.
  The application layer never uses `float`/`double` for money.
- **Optimistic locking** is on `accounts` and `transactions` (`version` column).
- **Pessimistic locks** are acquired inside transaction services when mutating an account
  balance (see LLD §5).
- **Audit log** is append-only; `old_value`/`new_value` are JSONB.
- **Idempotency keys** are unique per `(user_id, endpoint, key)`.
