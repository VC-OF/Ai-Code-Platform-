# ADR-0003 · JWT (Access + Refresh) Authentication

- **Status:** Accepted

## Decision

We use **JWT access tokens (15 min)** signed with HS256 in dev and RS256 in prod, plus
**opaque refresh tokens (7 days)** stored in Redis. Refresh tokens are rotated on every
use; the previous token is short-lived-blocklisted (30 s) to prevent race attacks. Logout
deletes the refresh token and adds the access token's `jti` to a Redis blocklist for its
remaining TTL.

## Consequences

- Stateless API; no sticky sessions.
- Token revocation is "best effort" within the access token's TTL; we accept this trade-off
  for performance and simplicity.
- Redis is on the auth critical path.
- Future move to short-lived access + introspection is possible without API changes.
