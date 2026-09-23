# ADR-0002 · Clean Architecture / Hexagonal per Module

- **Status:** Accepted

## Decision

Each module's source tree is organized into four layers:

- `domain` — pure business model (entities, value objects, domain events, ports).
- `application` — use case orchestration (services, command/query handlers, DTOs).
- `infrastructure` — adapters (JPA, REST, SMTP, etc.).
- `api` — the public surface exposed to other modules.

Domain code has no Spring, no JPA, no HTTP. Infrastructure code depends on `domain` and
`application`; never the other way around. Spring configuration lives in
`infrastructure.config` and is imported by the `bootstrap` module.

## Consequences

- Domain is unit-testable without Spring.
- Swapping infrastructure (e.g. SMTP ↔ SES) is a single new adapter.
- Slight increase in boilerplate; paid back by testability and clarity.
