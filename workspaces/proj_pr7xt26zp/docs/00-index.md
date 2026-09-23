# Phase 1 — Design Pack

| #   | Document                                                 | Purpose                                                    |
| --- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 01  | [Requirements Analysis](./01-requirements-analysis.md)   | Functional + NFRs, actors, traceability                    |
| 02  | [System Architecture (HLD)](./02-system-architecture.md) | C4 context/container, ADRs, security, HA                   |
| 03  | [HLD — Module Map](./03-hld.md)                          | Modules, responsibilities, key journeys                    |
| 04  | [LLD](./04-lld.md)                                       | Package layout, sequences, ledger, RBAC, frontend          |
| 05  | [Database Design](./05-database-design.md)               | All tables, indexes, constraints, encryption               |
| 06  | [ER Diagram](./06-er-diagram.mmd)                        | Mermaid ER for all entities (render in any Mermaid viewer) |
| 07  | [Folder Structure](./07-folder-structure.md)             | Backend / Frontend / DevOps tree                           |
| 08  | [Roadmap](./08-roadmap.md)                               | Phased delivery plan, exit criteria                        |

## How to read this pack

1. Start with `01` to align on scope and NFRs.
2. `02` + `03` for the big picture and module boundaries.
3. `04` for engineering details (sequences, ledger, RBAC).
4. `05` + `06` to validate the data model — this is where most banking bugs are born.
5. `07` is the layout we will commit in Phase 2.
6. `08` shows the path from here to a deployable v1.0.

## Sign-off checklist (Phase 1)

- [ ] All 9 roles and permissions matrix confirmed
- [ ] Multi-currency scope and FX provider agreed
- [ ] Multi-locale list finalized
- [ ] Multi-branch depth confirmed (single-bank, single-tenant)
- [ ] Money scale = 4, rounding HALF_EVEN approved
- [ ] Double-entry ledger approved
- [ ] Soft-delete + audit columns approved
- [ ] Idempotency-Key header on all writes approved
- [ ] Phase 2 scope (Auth + Identity + Audit) approved
