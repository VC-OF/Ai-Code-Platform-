# ADR-0005 · Soft Delete with `deleted_at`

- **Status:** Accepted

## Decision

Major entities (users, employees, branches, customers, accounts) implement soft delete via
a `deleted_at TIMESTAMPTZ` column. Hibernate filters (`@Where(clause="deleted_at IS NULL")`)
hide them by default. The application provides `findByIdIncludingDeleted` for the auditor
role and reconciliation jobs.

Transactional entities (transactions, ledger entries, audit log, OTP records) are **hard
deleted** for compliance.

## Consequences

- Preserves referential history for users, customers, accounts.
- Unique constraints require partial unique indexes (`WHERE deleted_at IS NULL`).
- Reports must be aware of soft-deleted rows in certain aggregations.
