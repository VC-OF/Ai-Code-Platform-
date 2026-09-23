# Phase 1 · Naming & Coding Conventions

## Java / Backend

- **Package:** `com.cbp.<module>.<layer>` (e.g. `com.cbp.account.domain`).
- **Class names:**
  - Entities: singular noun (`Account`, `Customer`).
  - Aggregate roots end in noun, no suffix.
  - Value objects: noun (`Money`, `Address`).
  - Domain events: past-tense verb phrase (`AccountOpened`, `MoneyTransferred`).
  - Use case / application services: verb phrase (`OpenAccountService`, `TransferMoneyService`).
  - Controllers: `<Resource>Controller`.
  - Adapters: `<Technology><Role>Adapter` (e.g. `SmtpEmailNotificationAdapter`).
  - Repositories (ports): `<Aggregate>Repository`; JPA adapters: `<Aggregate>JpaRepository`.
- **Methods:** `findX`, `saveX`, `openAccount`, `transfer`, `postInterest`. Boolean getters
  use `is`/`has`/`can`. No `get` prefix on entity fields; use Lombok `@Getter`.
- **Constants:** `UPPER_SNAKE_CASE` in a `final` class.
- **Enums:** singular noun (`AccountStatus`, `TransactionType`).
- **DTOs:** `<Context><Verb>Request/Response` or `<Resource>Dto`.
- **Mappers:** `<Source>To<Target>Mapper`, stateless with static methods or MapStruct.
- **Exceptions:** `DomainException` (abstract) → concrete `NotFoundException`,
  `ValidationException`, `ConflictException`, `ForbiddenException`, `BusinessRuleException`.
- **Tests:** method naming `methodName_stateUnderTest_expectedBehavior`.

### Lombok Usage

- `@Getter @Setter` on DTOs; **never** on JPA entities.
- `@Builder` on DTOs and value objects.
- `@RequiredArgsConstructor` for DI.
- `@Slf4j` for logging.
- `@EqualsAndHashCode(of = "id")` on entities; never `@Data` on entities.

### Comments / JavaDoc

- Every public class and every public method in `domain/` and `application/` has JavaDoc.
- Comments explain **why**, not **what**. The code shows what.

## SQL / Flyway

- Migration filename: `V<3-digit-seq>__<snake_case_description>.sql`
  e.g. `V001__create_users_table.sql`.
- One logical change per migration.
- Never modify a committed migration; add a new one.
- Use lowercase keywords for readability (`create table accounts (...)`).
- Always name constraints: `users_email_uniq`, `transactions_idem_uniq`.

## REST / DTO

- JSON fields: `camelCase`.
- Enums serialized as their `name()` (configure Jackson globally).
- `Instant` serialized as ISO-8601 UTC.
- Money serialized as `{ "minor": 10000, "currency": "INR" }`.

## TypeScript / Frontend

- **Filenames:** `PascalCase.tsx` for components, `camelCase.ts` for utilities/hooks.
- **Components:** arrow functions for small components, named functions for big ones.
  - `export const LoginForm = () => { ... }` (preferred for functional components)
  - `export function DashboardPage() { ... }` (preferred for pages)
- **Hooks:** `use<Thing>`. Always start with `use`.
- **API clients:** one per feature: `features/<x>/api/<x>.api.ts`.
- **Schemas (Zod):** colocated, exported as `*Schema` or `*Validation`.
- **Types:** prefer `type` for unions/aliases, `interface` only for extensible shapes.
- **Imports:** absolute aliases `@/...` mapped in `tsconfig.json` + `vite.config.ts`.
- **No default exports** for modules that are imported in many places.
- **Tailwind:** utility classes; component variants via `cva` (shadcn).
- **i18n:** every user-facing string is a key, never a literal in JSX.

## Git

- Branch naming: `phase-2/auth`, `phase-2/refresh-tokens`, `fix/customer-search`, etc.
- Commit messages: Conventional Commits (`feat(auth): add refresh token rotation`).
- PR title: same format; PR description links to the phase design doc.
- Squash-merge to `main`; signed commits required in `main`/`release/*`.

## Code Review

- Two approvals required for `main`.
- CODEOWNERS maps each module to at least one reviewer.
- CI must pass: build, tests, lint, coverage gate, OpenAPI diff.
