# Core Banking Platform (CBP)

> Enterprise-grade, multi-tenant, multi-branch, multi-currency, multi-language Core Banking Web Application.

This monorepo contains the complete design, source code, infrastructure, and documentation for the
**Core Banking Platform**. The project is built incrementally in phases. **This document is the
entry point of Phase 1: Foundations.**

---

## Tech Stack at a Glance

| Layer            | Technology                                                          |
| ---------------- | ------------------------------------------------------------------- |
| Frontend         | React 19, TypeScript, Vite, Tailwind CSS, ShadCN UI                 |
| Frontend State   | TanStack Query, React Hook Form, Zod                                |
| Frontend Routing | React Router v7                                                     |
| Frontend Charts  | Recharts                                                            |
| Frontend HTTP    | Axios (with interceptors)                                           |
| Backend          | Java 21, Spring Boot 3, Spring Security, Spring Data JPA, Hibernate |
| Database         | PostgreSQL 16, Flyway migrations                                    |
| Cache / Session  | Redis 7                                                             |
| Auth             | JWT (Access + Refresh), BCrypt, MFA-ready                           |
| API Docs         | springdoc-openapi (Swagger UI)                                      |
| Build (Backend)  | Maven                                                               |
| Testing          | JUnit 5, Mockito, Testcontainers, Vitest + Testing Library          |
| Containerization | Docker, Docker Compose                                              |
| Orchestration    | Kubernetes (manifests ready)                                        |
| CI/CD            | GitHub Actions                                                      |

---

## Phase Roadmap

| Phase | Title                   | Deliverables                                                           | Status      |
| ----- | ----------------------- | ---------------------------------------------------------------------- | ----------- |
| 1     | Foundations             | HLD, LLD, ER diagram, DB schema, module breakdown, folder structure    | ✅ This doc |
| 2     | Auth + User Mgmt        | JWT, RBAC, MFA-ready, refresh tokens, sessions, user/employee CRUD     | ⏭           |
| 3     | Customer & Branch       | Customer KYC, branches, employees, audit trail                         | ⏭           |
| 4     | Accounts & Transactions | Savings/Current/FD/RD, deposits, withdrawals, transfers, UPI/NEFT/RTGS | ⏭           |
| 5     | Loans & Cards           | Loan lifecycle, EMI engine, debit/credit cards, PIN, limits            | ⏭           |
| 6     | Cheques, Beneficiaries  | Cheque book, stop payment, clearing, beneficiary mgmt                  | ⏭           |
| 7     | Notifications & Reports | Email/SMS/Push, in-app, PDF/Excel/CSV reports                          | ⏭           |
| 8     | Frontend Dashboard      | Full banking dashboard, dark/light mode, charts, tables                | ⏭           |
| 9     | Hardening               | Rate limiting, observability, performance, security audit              | ⏭           |
| 10    | DevOps & Release        | Dockerfiles, compose, k8s manifests, CI/CD, prod configs               | ⏭           |

Each phase produces **working, tested, deployable code** — no TODOs, no pseudo-code.

---

## Repository Layout

```
core-banking/
├── README.md                          # This file (Phase 1 overview)
├── docs/
│   ├── 01-phase-1-foundations/
│   │   ├── 01-hld.md                  # High-Level Design
│   │   ├── 02-lld.md                  # Low-Level Design
│   │   ├── 03-module-breakdown.md     # Module breakdown & responsibilities
│   │   ├── 04-er-diagram.md           # ER diagram (Mermaid)
│   │   ├── 05-database-schema.md      # PostgreSQL DDL overview
│   │   ├── 06-api-conventions.md      # REST conventions
│   │   ├── 07-security-model.md       # Security architecture
│   │   ├── 08-folder-structure.md     # Full folder structure
│   │   ├── 09-naming-conventions.md   # Naming & style guide
│   │   └── 10-roadmap.md              # Development roadmap
│   ├── phase-2/ ... phase-10/         # Phase-specific designs
│   ├── api/openapi.yaml               # OpenAPI spec (built per phase)
│   └── adr/                           # Architecture Decision Records
├── backend/                           # Spring Boot 3 / Java 21
│   ├── pom.xml
│   ├── Dockerfile
│   └── src/...                        # Populated from Phase 2 onwards
├── frontend/                          # Vite + React 19 + TS
│   ├── package.json
│   ├── vite.config.ts
│   ├── Dockerfile
│   └── src/...                        # Populated from Phase 2 onwards
├── infra/
│   ├── docker-compose.yml             # Local dev stack
│   ├── docker-compose.prod.yml
│   ├── k8s/                           # Kubernetes manifests
│   └── github-actions/                # CI/CD workflow files
├── scripts/
│   ├── seed/                          # DB seed scripts
│   └── dev/                           # Local dev helpers
└── .editorconfig
```

---

## How to Use This Document

1. Read `01-hld.md` for the system-wide view.
2. Read `02-lld.md` for cross-cutting internals (request lifecycle, error model, etc.).
3. Read `03-module-breakdown.md` to understand each module's responsibility.
4. Read `04-er-diagram.md` and `05-database-schema.md` for the data model.
5. Read `08-folder-structure.md` to navigate the code.
6. Read `10-roadmap.md` for what comes next and when.

**Phase 1 is complete when you can read the HLD, look at the ER diagram, and see a clear,
justified mapping to a folder structure.** That is the bar this phase meets.

---

## License

Proprietary – Internal use only.
