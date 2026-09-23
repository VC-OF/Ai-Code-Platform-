# Phase 1 · Folder Structure

The full repository layout. The `backend/` and `frontend/` source trees are scaffolded
in **Phase 2**. The structures shown here are the **target** structure that every phase
fills in.

```
core-banking/
├── README.md
├── LICENSE
├── .editorconfig
├── .gitignore
├── .gitattributes
├── docker-compose.yml                    # local dev stack (postgres, redis, minio, mailhog, mailserver, backend, frontend)
├── docker-compose.prod.yml               # prod-oriented overrides
├── Makefile                              # dev shortcuts
│
├── docs/
│   ├── README.md
│   ├── 01-phase-1-foundations/
│   │   ├── 01-hld.md
│   │   ├── 02-lld.md
│   │   ├── 03-module-breakdown.md
│   │   ├── 04-er-diagram.md
│   │   ├── 05-database-schema.md
│   │   ├── 06-api-conventions.md
│   │   ├── 07-security-model.md
│   │   ├── 08-folder-structure.md         # this file
│   │   ├── 09-naming-conventions.md
│   │   └── 10-roadmap.md
│   ├── phase-2-auth-and-user/
│   │   ├── 01-design.md
│   │   ├── 02-api.md
│   │   ├── 03-db-migrations.md
│   │   └── 04-frontend.md
│   ├── phase-3-customer-and-branch/
│   │   └── ...
│   ├── phase-4-accounts-and-transactions/
│   │   └── ...
│   ├── phase-5-loans-and-cards/
│   │   └── ...
│   ├── phase-6-cheques-and-beneficiaries/
│   │   └── ...
│   ├── phase-7-notifications-and-reports/
│   │   └── ...
│   ├── phase-8-frontend-dashboard/
│   │   └── ...
│   ├── phase-9-hardening/
│   │   └── ...
│   ├── phase-10-devops/
│   │   └── ...
│   ├── api/
│   │   └── openapi.yaml                  # generated OpenAPI spec
│   └── adr/
│       ├── 0001-modular-monolith.md
│       ├── 0002-clean-architecture.md
│       ├── 0003-jwt-auth.md
│       ├── 0004-money-as-bigint-minor.md
│       ├── 0005-soft-delete.md
│       └── 0006-transactional-outbox.md
│
├── backend/
│   ├── pom.xml                           # parent POM (packaging=pom)
│   ├── Dockerfile                        # multi-stage build
│   ├── .dockerignore
│   ├── checkstyle.xml
│   ├── spotless.xml
│   ├── README.md
│   │
│   ├── common/                           # cbp-common
│   │   ├── pom.xml
│   │   └── src/
│   │       ├── main/java/com/cbp/common/
│   │       │   ├── money/Money.java
│   │       │   ├── money/Currency.java
│   │       │   ├── pagination/PageRequest.java
│   │       │   ├── pagination/PageResponse.java
│   │       │   ├── pagination/Sort.java
│   │       │   ├── result/Result.java
│   │       │   ├── exception/DomainException.java
│   │       │   ├── exception/NotFoundException.java
│   │       │   ├── exception/ValidationException.java
│   │       │   ├── exception/ConflictException.java
│   │       │   ├── exception/ForbiddenException.java
│   │       │   ├── exception/handler/GlobalExceptionHandler.java
│   │       │   ├── problem/Problem.java
│   │       │   ├── entity/AuditableEntity.java
│   │       │   ├── entity/SoftDeletable.java
│   │       │   ├── audit/Auditable.java
│   │       │   ├── i18n/I18nMessageResolver.java
│   │       │   ├── validators/PanValidator.java
│   │       │   ├── validators/AadhaarValidator.java
│   │       │   ├── validators/IfscValidator.java
│   │       │   ├── validators/AccountNumberValidator.java
│   │       │   ├── util/IdGenerator.java
│   │       │   ├── util/SecurityUtils.java
│   │       │   └── util/DateUtils.java
│   │       └── test/java/com/cbp/common/...
│   │
│   ├── auth/                             # cbp-auth
│   │   ├── pom.xml
│   │   └── src/
│   │       ├── main/java/com/cbp/auth/
│   │       │   ├── api/                  # public DTOs + ports
│   │       │   │   ├── dto/LoginRequest.java
│   │       │   │   ├── dto/LoginResponse.java
│   │       │   │   ├── dto/RefreshRequest.java
│   │       │   │   ├── dto/TokenResponse.java
│   │       │   │   ├── dto/MfaChallengeResponse.java
│   │       │   │   └── port/AuthPort.java
│   │       │   ├── domain/
│   │       │   │   ├── model/AuthenticatedUser.java
│   │       │   │   ├── model/RefreshToken.java
│   │       │   │   ├── model/Device.java
│   │       │   │   ├── model/LoginAttempt.java
│   │       │   │   └── event/UserLoggedIn.java
│   │       │   ├── application/
│   │       │   │   ├── LoginService.java
│   │       │   │   ├── LogoutService.java
│   │       │   │   ├── RefreshTokenService.java
│   │       │   │   ├── PasswordResetService.java
│   │       │   │   ├── MfaService.java
│   │       │   │   ├── DeviceService.java
│   │       │   │   └── SessionService.java
│   │       │   ├── infrastructure/
│   │       │   │   ├── web/AuthController.java
│   │       │   │   ├── web/PasswordController.java
│   │       │   │   ├── web/MfaController.java
│   │       │   │   ├── web/DeviceController.java
│   │       │   │   ├── web/dto/...
│   │       │   │   ├── security/JwtService.java
│   │       │   │   ├── security/JwtAuthenticationFilter.java
│   │       │   │   ├── security/JwtProperties.java
│   │       │   │   ├── security/SecurityConfig.java
│   │       │   │   ├── security/MethodSecurityConfig.java
│   │       │   │   ├── security/JwtBlocklistService.java
│   │       │   │   ├── security/AuthenticationEntryPoint.java
│   │       │   │   ├── security/CurrentUser.java
│   │       │   │   ├── security/CurrentUserResolver.java
│   │       │   │   ├── ratelimit/LoginRateLimitFilter.java
│   │       │   │   ├── repository/RefreshTokenRepository.java
│   │       │   │   ├── repository/DeviceRepository.java
│   │       │   │   ├── repository/LoginAttemptRepository.java
│   │       │   │   ├── cache/RedisTokenStore.java
│   │       │   │   └── config/AuthModuleConfig.java
│   │       │   └── i18n/messages.properties
│   │       └── test/java/com/cbp/auth/...
│   │
│   ├── user/                             # cbp-user
│   ├── branch/                           # cbp-branch
│   ├── customer/                         # cbp-customer
│   ├── account/                          # cbp-account
│   ├── transaction/                      # cbp-transaction
│   ├── beneficiary/                      # cbp-beneficiary
│   ├── loan/                             # cbp-loan
│   ├── fixeddeposit/                     # cbp-fixed-deposit
│   ├── recurringdeposit/                 # cbp-recurring-deposit
│   ├── card/                             # cbp-card
│   ├── cheque/                           # cbp-cheque
│   ├── notification/                     # cbp-notification
│   ├── report/                           # cbp-report
│   ├── audit/                            # cbp-audit
│   ├── dashboard/                        # cbp-dashboard
│   │
│   └── bootstrap/                        # cbp-bootstrap
│       ├── pom.xml
│       └── src/
│           ├── main/java/com/cbp/
│           │   ├── Application.java
│           │   ├── config/OpenApiConfig.java
│           │   ├── config/CorsConfig.java
│           │   ├── config/JacksonConfig.java
│           │   ├── config/RedisConfig.java
│           │   ├── config/SchedulingConfig.java
│           │   ├── config/AsyncConfig.java
│           │   ├── web/filter/RequestLoggingFilter.java
│           │   ├── web/filter/TraceIdFilter.java
│           │   ├── web/advice/GlobalExceptionHandler.java (if not in common)
│           │   ├── web/advice/RateLimitExceptionHandler.java
│           │   └── i18n/I18nConfig.java
│           ├── main/resources/
│           │   ├── application.yml
│           │   ├── application-dev.yml
│           │   ├── application-test.yml
│           │   ├── application-staging.yml
│           │   ├── application-prod.yml
│           │   ├── db/migration/   # Flyway scripts (Phase 2+)
│           │   │   ├── V000__baseline.sql
│           │   │   ├── V001__seed_roles.sql
│           │   │   ├── V002__seed_currencies.sql
│           │   │   └── V003__*.sql
│           │   └── banner.txt
│           └── test/java/com/cbp/...
│
├── frontend/                             # Vite + React 19 + TypeScript
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── tailwind.config.ts
│   ├── postcss.config.cjs
│   ├── components.json                   # shadcn config
│   ├── index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── .eslintrc.cjs
│   ├── .prettierrc
│   ├── README.md
│   ├── public/
│   │   ├── favicon.svg
│   │   └── locales/                      # i18next fallback
│   │       ├── en/common.json
│   │       ├── hi/common.json
│   │       └── es/common.json
│   └── src/
│       ├── main.tsx
│       ├── app/
│       │   ├── App.tsx
│       │   ├── router.tsx
│       │   ├── providers.tsx             # QueryClient, Theme, I18n, Auth
│       │   └── ErrorBoundary.tsx
│       ├── shared/
│       │   ├── ui/                       # shadcn primitives: button, input, dialog, ...
│       │   ├── components/
│       │   │   ├── AppShell.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Topbar.tsx
│       │   │   ├── DataTable.tsx
│       │   │   ├── DataTablePagination.tsx
│       │   │   ├── DataTableFilters.tsx
│       │   │   ├── MoneyInput.tsx
│       │   │   ├── CurrencySelect.tsx
│       │   │   ├── DateRangePicker.tsx
│       │   │   ├── KpiCard.tsx
│       │   │   ├── LineChart.tsx
│       │   │   ├── BarChart.tsx
│       │   │   ├── AreaChart.tsx
│       │   │   ├── PieChart.tsx
│       │   │   ├── ToastHost.tsx
│       │   │   ├── ConfirmDialog.tsx
│       │   │   ├── PageHeader.tsx
│       │   │   ├── EmptyState.tsx
│       │   │   ├── Skeleton.tsx
│       │   │   ├── GlobalSearch.tsx
│       │   │   ├── ThemeToggle.tsx
│       │   │   └── LanguageSwitcher.tsx
│       │   ├── hooks/
│       │   │   ├── useDebounce.ts
│       │   │   ├── usePagination.ts
│       │   │   ├── useTableParams.ts
│       │   │   ├── useCurrentUser.ts
│       │   │   ├── usePermission.ts
│       │   │   └── useTheme.ts
│       │   ├── lib/
│       │   │   ├── http/
│       │   │   │   ├── client.ts
│       │   │   │   ├── interceptors.ts
│       │   │   │   └── errors.ts
│       │   │   ├── money.ts
│       │   │   ├── format.ts
│       │   │   ├── date.ts
│       │   │   ├── validators.ts
│       │   │   └── queryKeys.ts
│       │   ├── i18n/
│       │   │   ├── index.ts
│       │   │   ├── en.json
│       │   │   ├── hi.json
│       │   │   └── es.json
│       │   ├── types/
│       │   │   ├── api.ts
│       │   │   ├── money.ts
│       │   │   └── auth.ts
│       │   └── styles/globals.css
│       ├── features/
│       │   ├── auth/
│       │   │   ├── api/auth.api.ts
│       │   │   ├── schemas/login.schema.ts
│       │   │   ├── hooks/useLogin.ts
│       │   │   ├── hooks/useRefresh.ts
│       │   │   ├── pages/LoginPage.tsx
│       │   │   ├── pages/ForgotPasswordPage.tsx
│       │   │   ├── pages/ResetPasswordPage.tsx
│       │   │   ├── pages/MfaPage.tsx
│       │   │   ├── components/LoginForm.tsx
│       │   │   ├── components/MfaForm.tsx
│       │   │   ├── store/auth.store.ts
│       │   │   └── routes.tsx
│       │   ├── dashboard/
│       │   │   ├── api/dashboard.api.ts
│       │   │   ├── pages/DashboardPage.tsx
│       │   │   ├── components/KpiRow.tsx
│       │   │   ├── components/MonthlyTxnChart.tsx
│       │   │   ├── components/CustomerGrowthChart.tsx
│       │   │   ├── components/LoanPortfolioChart.tsx
│       │   │   ├── components/RevenueChart.tsx
│       │   │   ├── components/DepositsVsWithdrawalsChart.tsx
│       │   │   ├── components/BranchPerformanceTable.tsx
│       │   │   └── routes.tsx
│       │   ├── customers/
│       │   │   ├── api/customers.api.ts
│       │   │   ├── schemas/customer.schema.ts
│       │   │   ├── pages/CustomersListPage.tsx
│       │   │   ├── pages/CustomerDetailPage.tsx
│       │   │   ├── pages/CustomerCreatePage.tsx
│       │   │   ├── components/CustomerForm.tsx
│       │   │   ├── components/CustomerTimeline.tsx
│       │   │   ├── components/DocumentUploader.tsx
│       │   │   ├── components/NomineeEditor.tsx
│       │   │   └── routes.tsx
│       │   ├── branches/
│       │   ├── employees/
│       │   ├── accounts/
│       │   ├── transactions/
│       │   ├── beneficiaries/
│       │   ├── loans/
│       │   ├── fixed-deposits/
│       │   ├── recurring-deposits/
│       │   ├── cards/
│       │   ├── cheques/
│       │   ├── notifications/
│       │   ├── reports/
│       │   ├── audit/
│       │   └── settings/
│       ├── pages/                          # route-level compositions
│       │   ├── RootLayout.tsx
│       │   ├── NotFoundPage.tsx
│       │   ├── ForbiddenPage.tsx
│       │   └── ServerErrorPage.tsx
│       └── tests/
│           ├── setup.ts
│           ├── auth.test.tsx
│           ├── dashboard.test.tsx
│           └── e2e/                       # Playwright (Phase 9)
│
├── infra/
│   ├── docker/
│   │   ├── backend.Dockerfile
│   │   ├── frontend.Dockerfile
│   │   └── postgres/init.sql
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── k8s/
│   │   ├── namespace.yaml
│   │   ├── postgres-statefulset.yaml
│   │   ├── redis-deployment.yaml
│   │   ├── backend-deployment.yaml
│   │   ├── backend-service.yaml
│   │   ├── backend-ingress.yaml
│   │   ├── frontend-deployment.yaml
│   │   ├── frontend-service.yaml
│   │   ├── frontend-ingress.yaml
│   │   ├── configmap.yaml
│   │   └── secret.example.yaml
│   ├── github-actions/
│   │   ├── backend-ci.yml
│   │   ├── frontend-ci.yml
│   │   ├── backend-deploy.yml
│   │   └── frontend-deploy.yml
│   └── prometheus/
│       └── prometheus.yml
│
├── scripts/
│   ├── dev/
│   │   ├── up.sh
│   │   ├── down.sh
│   │   ├── logs.sh
│   │   └── seed.sh
│   ├── seed/
│   │   ├── users.csv
│   │   ├── branches.csv
│   │   └── customers.csv
│   └── backup/
│       └── pg-dump.sh
│
└── .github/
    ├── CODEOWNERS
    ├── PULL_REQUEST_TEMPLATE.md
    └── ISSUE_TEMPLATE/
```

---

## Key Layout Rules

1. **Maven module = bounded context.** No two modules share a package.
2. **Each module's `api/` package is the only thing other modules can import.** Internals
   are package-private where possible.
3. **Each module has a parallel `test/` tree** with unit, integration, and slice tests.
4. **Frontend features mirror backend modules 1:1** to keep ownership clear.
5. **Configuration lives in `bootstrap/src/main/resources`**; modules expose
   `*ModuleConfig` classes that the bootstrap module imports via `@Import`.
6. **Migration files live in `bootstrap`** so a single module owns the schema
   (Flyway scans the classpath and finds them in any module, but centralizing avoids
   ordering surprises).
7. **Generated OpenAPI is committed** to `docs/api/openapi.yaml` and diffed in CI.
