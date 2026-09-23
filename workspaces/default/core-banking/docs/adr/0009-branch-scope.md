# ADR-0009 · Branch Scope as a First-Class Concept

- **Status:** Accepted

## Decision

`branch_id` is present on most operational entities (customer, account, transaction,
loan, etc.). Every controller and query filters by the caller's branch unless the caller
has a global permission (e.g. `BRANCH_MANAGE`, `AUDIT_VIEW`). Branch managers and tellers
see only their branch; bank admin sees all branches.

## Consequences

- Multi-branch is supported out of the box.
- The `branchScope` SpEL helper centralizes the rule.
- Cross-branch reports (bank admin) use a separate set of endpoints, clearly labeled.
