# Phase 1 · API Conventions

These conventions apply to **every** REST endpoint. Module-specific endpoints extend them
without exception.

## Resource Naming

- Lowercase, plural nouns: `/customers`, `/accounts`, `/transactions`
- Sub-resources: `/customers/{id}/addresses`, `/accounts/{id}/statement`
- Verbs only for actions: `POST /transactions/transfer`, `POST /loans/{id}/approve`

## HTTP Verbs

| Verb   | Purpose                   | Idempotent | Safe |
| ------ | ------------------------- | ---------- | ---- |
| GET    | Read                      | Yes        | Yes  |
| POST   | Create / invoke action    | No         | No   |
| PUT    | Full replace              | Yes        | No   |
| PATCH  | Partial update (RFC 7396) | No         | No   |
| DELETE | Delete                    | Yes        | No   |

## Versioning

- URI segment: `/api/v1/...`
- Breaking changes ⇒ bump to `/api/v2/...`
- Backwards-compatible additions only within a major version

## Pagination

Two strategies are supported, chosen per endpoint:

1. **Offset pagination** for tables:
   - Request: `?page=0&size=20&sort=createdAt,desc`
   - Response: `{ "content": [...], "page": 0, "size": 20, "totalElements": 1234, "totalPages": 62 }`

2. **Cursor pagination** for streams (e.g. transaction history):
   - Request: `?cursor=<opaque>&limit=50`
   - Response: `{ "items": [...], "nextCursor": "<opaque>" }`

## Filtering

- `?filter[field]=value` for simple equality
- `?filter[field]=gte:1000` for range (`gte`, `lte`, `gt`, `lt`, `in`, `like`)
- `?search=...` performs case-insensitive search on configured fields

## Sorting

- Multi-sort: `?sort=field1,asc&sort=field2,desc`
- Default: `id,desc` when not specified

## Headers

| Header            | Purpose                         |
| ----------------- | ------------------------------- |
| `Authorization`   | `Bearer <jwt>`                  |
| `Accept-Language` | `en`, `hi`, `es`                |
| `X-Request-Id`    | optional client correlation id  |
| `Idempotency-Key` | required on money-moving POSTs  |
| `If-Match`        | ETag for optimistic concurrency |

## Responses

- **Success:** `200 OK` / `201 Created` with resource body
- **Empty success:** `204 No Content`
- **Error:** `application/problem+json` (RFC 7807), see LLD §2
- **Validation error:** `400 Bad Request` with `errors[]`
- **Unauthorized:** `401 Unauthorized`
- **Forbidden:** `403 Forbidden`
- **Not found:** `404 Not Found`
- **Conflict:** `409 Conflict` (e.g. version mismatch, duplicate idempotency-key)
- **Unprocessable:** `422 Unprocessable Entity` (business rule violation)
- **Rate limit:** `429 Too Many Requests` with `Retry-After`
- **Server:** `500 Internal Server Error` (never leaks stack traces)

## Money

All monetary fields use **integer minor units** + **ISO 4217 currency code**:

```json
{ "amount": { "minor": 10000, "currency": "INR" } }
```

The frontend uses `Intl.NumberFormat` for display; the backend computes with `BigDecimal`
and stores in `BIGINT`.

## Dates

- All timestamps: ISO-8601 UTC with `Z` suffix: `"2024-01-15T09:30:00Z"`
- Date-only fields: `"2024-01-15"`

## Errors

```json
{
  "type": "https://errors.cbp.bank/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "code": "INSUFFICIENT_FUNDS",
  "detail": "Account ACC... has balance 100.00 INR, attempted debit 250.00 INR",
  "instance": "/api/v1/transactions/withdraw",
  "traceId": "8f2...",
  "errors": [{ "field": "amount", "message": "must be greater than 0" }]
}
```

## OpenAPI

- All controllers annotated with `@Operation`, `@ApiResponse`, `@Schema`.
- `springdoc-openapi-starter-webmvc-ui` produces Swagger UI at `/swagger-ui.html`.
- Spec is exported to `docs/api/openapi.yaml` on every CI build.

## Versioning Policy

- Additive changes (new endpoints, new optional fields) are non-breaking.
- Removing or renaming a field, changing a type, or changing error semantics ⇒ new version.
