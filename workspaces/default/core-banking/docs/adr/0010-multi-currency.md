# ADR-0010 · Multi-Currency with FX Service

- **Status:** Accepted

## Decision

Each account has a single currency. Internal transfers between currencies go through an
`FxService` that:

1. Reads the latest rate from `fx_rates` (admin-maintained in dev; refreshed from a
   provider in prod via Phase 9).
2. Creates two `ledger_entries`: debit on source (source currency), credit on
   destination (destination currency) at the same time, with both `amount_minor` and
   `currency_code` recorded.

## Consequences

- Each account is always in exactly one currency — no ambiguity.
- Cross-currency transfers are explicit; the FX rate is recorded with the transaction.
- A separate FX P&L report reconciles gains/losses from rate moves (Phase 7).
