# Core Banking Platform

> Enterprise-grade, multi-module core banking web application supporting Retail, Corporate, and Branch banking with multi-branch, multi-currency, and multi-language capabilities.

## Status

| Phase       | Scope                                                                                  | Status             |
| ----------- | -------------------------------------------------------------------------------------- | ------------------ |
| **Phase 1** | Requirements, Architecture, HLD, LLD, DB Design, ER Diagram, Folder Structure, Roadmap | ✅ **In Progress** |
| Phase 2     | Auth + RBAC + Audit foundation                                                         | ⏳ Pending         |
| Phase 3     | Customer & Employee management                                                         | ⏳ Pending         |
| Phase 4     | Accounts, Transactions, Beneficiaries                                                  | ⏳ Pending         |
| Phase 5     | Loans, FD, RD, Cards, Cheques                                                          | ⏳ Pending         |
| Phase 6     | Notifications, Reports, Dashboards                                                     | ⏳ Pending         |
| Phase 7     | Hardening, Observability, K8s, CI/CD                                                   | ⏳ Pending         |

> Each phase ends with verification. Proceed only after sign-off.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, ShadCN UI, React Router, TanStack Query, React Hook Form, Zod, Axios, Recharts
- **Backend:** Java 21, Spring Boot 3, Spring Security, Spring Data JPA, Hibernate, Flyway, Redis
- **Auth:** JWT (Access + Refresh), RBAC, MFA-ready, BCrypt
- **DB:** PostgreSQL 16 (normalized 3NF, soft delete, audit columns)
- **Docs:** OpenAPI / Swagger
- **Build:** Maven
- **Deploy:** Docker, Docker Compose, Kubernetes-ready

## Architecture Principles

- **Clean Architecture / Hexagonal** for the backend (Domain → Application → Infrastructure → API)
- **DDD** with bounded contexts per module
- **SOLID**, **DRY**, **KISS**, **YAGNI**
- **CQRS-lite** (separated read models for reporting)
- **Event-driven** (Spring `ApplicationEventPublisher` for in-process, Kafka-ready for cross-module)
- **Modular Monolith** first, with hard module boundaries so each can be extracted into a microservice later
- **Double-entry** accounting (Ledger) — source of truth for money movement
- **Idempotency keys** on all financial operations
- **Money = `BigDecimal` with scale 4, rounded HALF_EVEN**

See `/docs` for full Phase 1 deliverables.

## Run locally (later phases)

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && ./mvnw spring-boot:run

# Infra
docker compose -f deploy/docker-compose.yml up -d
```

## License

Proprietary — internal banking use only.
