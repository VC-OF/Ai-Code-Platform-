# Phase 1 — Project Folder Structure

> Production-grade layout. Empty directories are reserved and created during their phase.

```
core-banking/
├── README.md
├── LICENSE
├── .gitignore
├── .editorconfig
├── .nvmrc
├── .java-version
│
├── docs/                                  # Phase 1 design artifacts
│   ├── 01-requirements-analysis.md
│   ├── 02-system-architecture.md
│   ├── 03-hld.md
│   ├── 04-lld.md
│   ├── 05-database-design.md
│   ├── 06-er-diagram.mmd
│   ├── 07-folder-structure.md
│   ├── 08-roadmap.md
│   └── api/                               # OpenAPI specs (phase 2+)
│
├── backend/                               # Spring Boot 3 multi-module Maven
│   ├── pom.xml                            # parent POM
│   ├── mvnw, mvnw.cmd, .mvn/
│   ├── platform/                          # cross-cutting
│   │   ├── pom.xml
│   │   └── src/main/java/com/bank/platform/
│   │   │   ├── PlatformApplication.java
│   │   │   ├── config/
│   │   │   ├── security/
│   │   │   ├── audit/
│   │   │   ├── error/
│   │   │   ├── i18n/
│   │   │   ├── observability/
│   │   │   └── common/
│   │   └── src/main/resources/
│   │       ├── application.yml
│   │       ├── application-dev.yml
│   │       ├── application-prod.yml
│   │       ├── db/migration/              # Flyway migrations
│   │       └── i18n/messages*.properties
│   │
│   ├── authentication/
│   ├── identity/
│   ├── customer/
│   ├── account/
│   ├── transaction/
│   ├── beneficiary/
│   ├── loan/
│   ├── card/
│   ├── cheque/
│   ├── fx/
│   ├── notification/
│   ├── reporting/
│   └── tests/                             # cross-module integration tests
│       └── src/test/java/com/bank/tests/
│
├── frontend/                              # React 19 + Vite + TS
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── app/
│       ├── pages/
│       ├── features/
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── customers/
│       │   ├── accounts/
│       │   ├── transactions/
│       │   ├── beneficiaries/
│       │   ├── loans/
│       │   ├── cards/
│       │   ├── fd-rd/
│       │   ├── cheques/
│       │   ├── branches/
│       │   ├── employees/
│       │   ├── notifications/
│       │   └── reports/
│       ├── components/
│       │   └── ui/                        # shadcn primitives
│       ├── layouts/
│       ├── hooks/
│       ├── services/
│       ├── stores/
│       ├── lib/
│       ├── schemas/
│       ├── i18n/locales/{en,hi,ar,es,fr,zh}/
│       ├── types/
│       └── styles/
│
├── deploy/
│   ├── docker/
│   │   ├── backend.Dockerfile
│   │   ├── frontend.Dockerfile
│   │   └── nginx.conf
│   ├── docker-compose.yml                 # dev: postgres, redis, mailhog, minio, prom, grafana
│   ├── docker-compose.prod.yml
│   └── k8s/                               # phase 7
│       ├── namespace.yaml
│       ├── postgres.yaml
│       ├── redis.yaml
│       ├── backend.yaml
│       ├── frontend.yaml
│       ├── ingress.yaml
│       └── secrets.yaml
│
├── .github/
│   └── workflows/
│       ├── backend-ci.yml
│       ├── frontend-ci.yml
│       ├── security.yml
│       └── release.yml
│
├── scripts/
│   ├── seed-dev.sh
│   ├── reset-db.sh
│   ├── gen-types.sh                       # openapi-typescript
│   └── release.sh
│
└── ops/
    ├── prometheus/prometheus.yml
    ├── grafana/dashboards/
    ├── loki/loki-config.yml
    └── alertmanager/alertmanager.yml
```

## Module Maven Coordinates

| Module           | GroupId  | ArtifactId          |
| ---------------- | -------- | ------------------- |
| parent           | com.bank | core-banking-parent |
| platform         | com.bank | platform            |
| authentication   | com.bank | authentication      |
| identity         | com.bank | identity            |
| customer         | com.bank | customer            |
| account          | com.bank | account             |
| transaction      | com.bank | transaction         |
| beneficiary      | com.bank | beneficiary         |
| loan             | com.bank | loan                |
| card             | com.bank | card                |
| cheque           | com.bank | cheque              |
| fx               | com.bank | fx                  |
| notification     | com.bank | notification        |
| reporting        | com.bank | reporting           |
| tests (test-jar) | com.bank | tests               |

> The parent POM enforces: Java 21, Spring Boot 3.3.x, dependency convergence, OWASP dep-check plugin, Spotless (Google Java Format), Checkstyle, JUnit 5, Mockito, Testcontainers, JaCoCo (≥80% line).

## Frontend Naming

- Components: `PascalCase.tsx`; hooks: `useCamelCase.ts`; services: `camelCase.ts`
- Files colocated with feature (`features/customers/components/...`); cross-feature in `components/`
- Absolute imports via `@/` alias
- Tailwind classes ordered: layout → box → typography → color → state
