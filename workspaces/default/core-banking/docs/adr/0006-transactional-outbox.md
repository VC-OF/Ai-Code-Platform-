# ADR-0006 · Transactional Outbox for Notifications

- **Status:** Accepted

## Decision

Notifications are **not** sent inside the originating transaction. Instead, a row is
written to a `notification_outbox` (or `notifications` with status `PENDING`) in the same
transaction. A scheduled poller (Spring `@Scheduled`) reads pending rows, dispatches them
through the appropriate adapter, and updates status with retry. This guarantees
at-least-once delivery even if the broker or provider is down.

## Consequences

- Decouples business transactions from external side effects.
- Requires a poller; failure modes are well-defined (retry, dead-letter).
- Outbox row insert is in the same DB transaction ⇒ atomicity with the business write.
