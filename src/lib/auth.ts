import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { userDb, sessionDb, type DbUser } from './db';

export const AUTH_COOKIE_NAME = 'opencode_auth_token';
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

export type SafeUser = Omit<DbUser, 'password_hash'>;

/**
 * Hash a plaintext password with a unique random salt using scrypt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Verify a plaintext password against a stored salt:hash string.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, key] = parts;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKeyBuffer = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKeyBuffer);
  } catch {
    return false;
  }
}

/**
 * Register a new user and generate a session token.
 */
export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
  role?: string;
}): Promise<{ user: SafeUser; token: string }> {
  const email = (input.email || '').trim().toLowerCase();
  const name = (input.name || '').trim();
  const password = input.password || '';

  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required');
  }
  if (!name) {
    throw new Error('Name is required');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const existing = userDb.getByEmail(email);
  if (existing) {
    throw new Error('An account with this email already exists');
  }

  const userId = 'usr_' + crypto.randomBytes(10).toString('hex');
  const password_hash = hashPassword(password);

  const user = userDb.create({
    id: userId,
    email,
    name,
    password_hash,
    role: input.role || 'user',
  });

  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  sessionDb.create(token, user.id, SESSION_MAX_AGE_SEC * 1000);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token,
  };
}

/**
 * Authenticate existing user with email and password.
 */
export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: SafeUser; token: string }> {
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const user = userDb.getByEmail(email);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  sessionDb.create(token, user.id, SESSION_MAX_AGE_SEC * 1000);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token,
  };
}

/**
 * Extract token from Request cookies or Authorization header.
 */
export function extractAuthToken(req: Request | NextRequest): string | null {
  // Check Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  // Check Cookie header
  const cookieHeader = req.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const c of cookies) {
    if (c.startsWith(`${AUTH_COOKIE_NAME}=`)) {
      return c.substring(AUTH_COOKIE_NAME.length + 1).trim();
    }
  }

  return null;
}

/**
 * Get current authenticated user from request if session is active.
 * Safe for anonymous mode (returns null without throwing).
 */
export async function getCurrentUser(
  req: Request | NextRequest
): Promise<SafeUser | null> {
  const token = extractAuthToken(req);
  if (!token) return null;

  const session = sessionDb.get(token);
  if (!session) return null;

  return session.user;
}

/**
 * Invalidate a session token.
 */
export function logoutUser(token: string): void {
  sessionDb.delete(token);
}

/**
 * Construct Set-Cookie string for auth token.
 */
export function buildAuthCookie(token: string, maxAgeSec: number = SESSION_MAX_AGE_SEC): string {
  const isProd = process.env.NODE_ENV === 'production';
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${
    isProd ? '; Secure' : ''
  }`;
}

/**
 * Construct Set-Cookie string to clear auth cookie.
 */
export function buildClearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
