# ADR-0008 · Permission Strings as Authorization Unit

- **Status:** Accepted

## Decision

Authorization decisions are based on **permission strings** (e.g. `TXN_DEPOSIT`,
`LOAN_APPROVE`), not role names. Roles are bundles of permissions. A SpEL helper,
`@PreAuthorize("hasAuthority('PERM')")`, is used everywhere. Branch-scoped checks use
`@branchScope.canAccess(authentication, branchId)`.

## Consequences

- Adding a new role does not require code changes; only a permission map update.
- Easy to express fine-grained rules (e.g. "approve loan ≤ 1,000,000 only").
- Audit logs can record which permission was used.
