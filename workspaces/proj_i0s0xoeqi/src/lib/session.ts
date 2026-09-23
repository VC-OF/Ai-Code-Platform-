// Simple session-token-based authentication using jose (HS256 JWT).
// In production this would be a short-lived access token + refresh token
// stored in an HttpOnly cookie. Here we use a non-HttpOnly cookie so the
// client can read the user id for UI purposes, but the signature is still
// verified server-side on every request.

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getUserById, type AuthUser } from "./auth-shim";
import type { UserRole } from "./types";

const COOKIE = "jexam_session";
const ALG = "HS256";

function getSecret(): Uint8Array {
  const s =
    process.env.JEXAM_JWT_SECRET ||
    "dev-secret-please-set-JEXAM_JWT_SECRET-in-production";
  return new TextEncoder().encode(s);
}

export interface SessionPayload {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
}

export async function signSession(
  payload: SessionPayload,
  ttlSeconds = 60 * 60 * 8
): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer("jexam")
    .setAudience("jexam-web")
    .sign(getSecret());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "jexam",
      audience: "jexam-web",
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSessionCookie() {
  cookies().delete(COOKIE);
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const s = await readSession();
  if (!s) return null;
  return getUserById(s.sub);
}
