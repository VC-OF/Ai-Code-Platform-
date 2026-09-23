# Phase 1 · Security Model

The security model is layered: **Edge → Transport → Identity → Authorization → Application**.

---

## 1. Transport

- TLS 1.2+ only. HSTS with `max-age=63072000; includeSubDomains; preload`.
- HTTP → HTTPS redirect at the edge.

## 2. Edge (Nginx / API Gateway)

- Per-IP rate limit: 60 req/min (configurable).
- `X-Request-Id` injected.
- Body size limit: 1 MB for APIs, 25 MB for `/files/*` (KYC docs).
- Web Application Firewall: OWASP CRS in prod.

## 3. CORS

- Allowlist of origins in `application.yml` (`cbp.cors.allowed-origins`).
- Credentials: enabled only for whitelisted origins.
- `Access-Control-Allow-Headers`: `Authorization, Content-Type, Accept-Language, X-Request-Id, Idempotency-Key, If-Match`.

## 4. Authentication

- **JWT (HS256 dev / RS256 prod)** with claims:
  ```json
  {
    "sub": "<userId>",
    "usr": "<username>",
    "brc": "<branchId|null>",
    "rol": ["BANK_ADMIN", "TELLER"],
    "perm": ["TXN_DEPOSIT", "CUSTOMER_VIEW"],
    "iat": 1710000000,
    "exp": 1710000900,
    "jti": "<uuid>",
    "typ": "access"
  }
  ```
- **Access token TTL:** 15 minutes
- **Refresh token:** opaque, 256-bit, stored in Redis with `userId`, `deviceId`, `jti`, TTL = 7 days. Rotated on every use; old token is blocklisted for 30 s to prevent race.
- **Logout:** refresh token deleted + access token `jti` blocklisted in Redis for its remaining TTL.
- **MFA (TOTP, RFC 6238):** when enabled, login is two-step: `POST /auth/login` returns `mfaRequired=true` + `mfaToken` (5-min TTL); `POST /auth/mfa/verify` completes the login.
- **Password hashing:** BCrypt strength 12.
- **Failed login lockout:** 5 attempts ⇒ 15-minute lock, exponential backoff after.
- **Device tracking:** first login from a device issues a `deviceId`; user can list/revoke devices at `/auth/devices`.

## 5. Authorization

- **Method security** with `@PreAuthorize("hasAuthority('PERM')")`.
- **Permission strings** are the unit of authorization, not role names.
- A `branchScope()` SpEL helper supports branch-scoped queries:
  `@PreAuthorize("@branchScope.canAccess(authentication, #branchId)")`
- All controllers check `branchScope` for branch-scoped data; super admin bypasses.

### Permission Resolution at Login

On successful authentication, the user's role → permission graph is resolved once and
embedded in the JWT. The list is also cached in Redis (TTL = access token TTL) for fast
permission re-checks without a DB hit.

## 6. SQL Injection

- All queries use **parameterized** JPA / JDBC.
- No string concatenation in JPQL or native queries.
- Hibernate validates the schema on startup (`ddl-auto=validate`).
- Read-only DB user for reporting queries (Phase 9).

## 7. XSS

- All API responses are `application/json` (no HTML).
- Frontend renders everything through React (auto-escapes); user-supplied HTML is never
  used with `dangerouslySetInnerHTML`.
- A `Content-Security-Policy` header is set at the edge: `default-src 'self'; img-src 'self' data:; script-src 'self'`.
- All uploaded file names are sanitized server-side; the storage key is a UUID, the
  original filename is stored separately.

## 8. CSRF

- Stateless JWT APIs: CSRF protection disabled (no cookies carry auth).
- If cookie-based endpoints are introduced in the future, CSRF will be enabled selectively.

## 9. Input Validation

- All request DTOs use **Jakarta Bean Validation** annotations.
- Custom validators for PAN, Aadhaar, IFSC, account number, currency code, IBAN.
- Frontend mirrors with **Zod** schemas.
- File uploads: MIME sniffed, size-limited (25 MB), extension allowlist, virus-scan hook
  (Phase 9).

## 10. Secure File Upload

- Stored in MinIO/S3 with bucket-level policies.
- Public access disabled; downloads use **signed URLs** with 5-minute TTL.
- Encryption at rest (bucket-level).
- `customer_documents.storage_key` is the only handle; the URL is generated on demand.

## 11. Rate Limiting (Bucket4j + Redis)

- **Auth endpoints:** 5 req/min per IP and per username.
- **Transaction endpoints:** 30 req/min per user.
- **Read endpoints:** 120 req/min per user.
- 429 response with `Retry-After` header in seconds.

## 12. Secrets

- No secrets in source. `application-prod.yml` reads from environment variables.
- `.env.example` documents required keys.
- Database credentials are pulled from Kubernetes secrets / AWS Secrets Manager.

## 13. Audit Trail

- Every state-changing endpoint publishes a `DomainEvent` after commit.
- Audit reader endpoints (auditor role only) expose `oldValue`/`newValue` JSONB.

## 14. Logging

- Never log PII, passwords, JWTs, or full PAN/Aadhaar.
- Log lines: structured JSON with `traceId`, `userId`, `branchId`, `path`, `status`, `latencyMs`.
- A `pii-redactor` Logback filter masks PAN, Aadhaar, account numbers, emails, phones
  in messages and MDC.

## 15. OWASP ASVS L2 Checklist (high-level)

| ASVS Section       | Coverage                                         |
| ------------------ | ------------------------------------------------ |
| V1 Architecture    | This document + HLD                              |
| V2 Authentication  | JWT, refresh, MFA, lockout, device tracking      |
| V3 Session Mgmt    | Stateless JWT, Redis-backed refresh + blocklist  |
| V4 Access Control  | RBAC, branchScope, method security               |
| V5 Validation      | Bean Validation + Zod + custom validators        |
| V6 Cryptography    | BCrypt 12, TLS 1.2+, RS256 in prod               |
| V7 Error Handling  | RFC 7807, no stack traces                        |
| V8 Data Protection | PII at rest, signed URLs, soft delete            |
| V9 Communications  | TLS, HSTS, CORS                                  |
| V10 Malicious Code | CI dependency scan (OWASP Dep-Check, Snyk)       |
| V11 Business Logic | Domain invariants in aggregates                  |
| V12 Files          | MIME sniff, size limit, signed URLs              |
| V13 API            | OpenAPI, rate limit, idempotency, error contract |
| V14 Configuration  | Profiles, env-driven, no secrets in repo         |
