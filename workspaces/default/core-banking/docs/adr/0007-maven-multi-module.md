# ADR-0007 · Maven Multi-Module Project Layout

- **Status:** Accepted

## Decision

The backend is a single Maven project with `packaging=pom` and one Maven module per
bounded context. The `bootstrap` module is the only one with the Spring Boot Maven
plugin applied. Cross-module dependencies flow only from a module's `api` package.

## Consequences

- One `mvn verify` builds and tests everything.
- IDE navigation stays simple.
- Modularity is enforced at compile time and by ArchUnit.
- Releasing individual modules as separate artifacts is **not** a goal in Phase 1.
