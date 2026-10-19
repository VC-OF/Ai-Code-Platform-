import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  registerUser,
  loginUser,
  logoutUser,
} from '@/lib/auth';
import { sessionDb } from '@/lib/db';
import {
  createProject,
  getProjects,
  setProjectShare,
  getProjectByShareToken,
} from '@/lib/projects';
import { parseAnsi } from '@/lib/ansi';

describe('Phase 2: Authentication & Multi-Tenancy', () => {
  const testEmail = `test_${Date.now()}@opencode.dev`;
  const testPassword = 'Password123!';

  it('hashes passwords securely and verifies correctly', () => {
    const hash = hashPassword('mysecretpassword');
    expect(hash).toContain(':');
    expect(verifyPassword('mysecretpassword', hash)).toBe(true);
    expect(verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('registers a new user and generates a session', async () => {
    const { user, token } = await registerUser({
      email: testEmail,
      name: 'Test Developer',
      password: testPassword,
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);
    expect(user.name).toBe('Test Developer');
    expect(token).toBeDefined();

    // Verify session retrieval in database
    const session = sessionDb.get(token);
    expect(session).toBeDefined();
    expect(session?.user.email).toBe(testEmail);
  });

  it('rejects duplicate user registrations', async () => {
    await expect(
      registerUser({
        email: testEmail,
        name: 'Another User',
        password: 'password123',
      })
    ).rejects.toThrow(/already exists/i);
  });

  it('logs in an existing user with correct credentials and rejects wrong passwords', async () => {
    const { user, token } = await loginUser({
      email: testEmail,
      password: testPassword,
    });
    expect(user.email).toBe(testEmail);
    expect(token).toBeDefined();

    await expect(
      loginUser({
        email: testEmail,
        password: 'IncorrectPassword',
      })
    ).rejects.toThrow(/invalid email or password/i);

    // Logout removes session
    logoutUser(token);
    expect(sessionDb.get(token)).toBeUndefined();
  });
});

describe('Phase 2: Project Ownership & Sharing', () => {
  it('scopes projects to user and allows retrieval by userId', async () => {
    const mockUserId = `usr_${Date.now()}`;
    const project = await createProject('User Scoped Project', 'blank', mockUserId);
    expect(project.userId).toBe(mockUserId);

    const userProjects = await getProjects(mockUserId);
    expect(userProjects.some((p) => p.id === project.id)).toBe(true);
  });

  it('enables and disables project public link sharing', async () => {
    const project = await createProject('Sharable Project', 'blank');
    expect(project.isPublic).toBe(false);
    expect(project.shareToken).toBeNull();

    // Enable sharing
    const shareResult = await setProjectShare(project.id, true);
    expect(shareResult?.isPublic).toBe(true);
    expect(shareResult?.shareToken).toMatch(/^sh_/);

    // Retrieve via share token
    const sharedProject = await getProjectByShareToken(shareResult!.shareToken!);
    expect(sharedProject).toBeDefined();
    expect(sharedProject?.id).toBe(project.id);

    // Disable sharing
    const unshareResult = await setProjectShare(project.id, false);
    expect(unshareResult?.isPublic).toBe(false);
    expect(unshareResult?.shareToken).toBeNull();

    // After unshare, lookup fails
    const notFound = await getProjectByShareToken(shareResult!.shareToken!);
    expect(notFound).toBeNull();
  });
});

describe('Phase 2: Terminal ANSI Parser', () => {
  it('parses plain text without escape sequences', () => {
    const spans = parseAnsi('Hello world from terminal');
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('Hello world from terminal');
    expect(spans[0].color).toBeUndefined();
  });

  it('parses green and red colored ANSI strings', () => {
    const input = '\u001b[32mPASS\u001b[0m tests/all.test.ts \u001b[31mFAIL\u001b[0m';
    const spans = parseAnsi(input);
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const passSpan = spans.find((s) => s.text === 'PASS');
    expect(passSpan?.color).toBe('#10b981'); // green
    const failSpan = spans.find((s) => s.text === 'FAIL');
    expect(failSpan?.color).toBe('#ef4444'); // red
  });

  it('parses bold styling ANSI codes', () => {
    const input = '\u001b[1mBold Text\u001b[0m Normal';
    const spans = parseAnsi(input);
    const boldSpan = spans.find((s) => s.text === 'Bold Text');
    expect(boldSpan?.bold).toBe(true);
  });
});
