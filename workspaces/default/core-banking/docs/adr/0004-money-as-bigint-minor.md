# ADR-0004 · Money as BIGINT Minor Units

- **Status:** Accepted

## Decision

All monetary amounts are stored as **`BIGINT` minor units** (e.g. paise for INR, cents
for USD) and a `currency_code` foreign key to a `currencies` table. The application
layer converts via `BigDecimal` only at the boundary (input parsing, output rendering).
`float`/`double` are **forbidden** for money.

## Consequences

- No floating-point drift; rounding is explicit and always banker-rounded.
- Two columns (`amount_minor`, `currency_code`) instead of one; trivial join cost.
- Display formatting uses `BigDecimal.scaleByPowerOfTen(-currency.minorUnit)`.
- A migration of existing `NUMERIC(19,4)` columns would require a one-shot script.
