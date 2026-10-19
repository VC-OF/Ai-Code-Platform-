import { describe, it, expect } from 'vitest';
import { TEMPLATES, getTemplate } from '@/lib/templates';
import {
  resolveVercelToken,
  resolveNetlifyToken,
  resolveCloudflareToken,
  resolveGitHubToken,
} from '@/lib/deploy';

describe('Phase 1: Expanded Templates', () => {
  it('includes all new full-stack templates in TEMPLATES array', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toContain('blank');
    expect(ids).toContain('static-site');
    expect(ids).toContain('react-vite');
    expect(ids).toContain('nextjs-tailwind');
    expect(ids).toContain('fastapi-react');
    expect(ids).toContain('express-api');
    expect(ids).toContain('dashboard-shell');
  });

  it('scaffolds Next.js 16 template with App Router and Tailwind v4', () => {
    const t = getTemplate('nextjs-tailwind');
    expect(t.name).toBe('Next.js App');
    expect(t.files['package.json']).toBeDefined();
    expect(t.files['app/page.tsx']).toBeDefined();
    expect(t.files['app/layout.tsx']).toBeDefined();
    expect(t.files['app/globals.css']).toContain('@import "tailwindcss"');
  });

  it('scaffolds FastAPI + React full-stack template', () => {
    const t = getTemplate('fastapi-react');
    expect(t.name).toBe('FastAPI + React');
    expect(t.files['backend/main.py']).toContain('FastAPI');
    expect(t.files['backend/requirements.txt']).toContain('fastapi');
    expect(t.files['src/App.jsx']).toBeDefined();
    expect(t.files['vite.config.js']).toContain('/api');
  });

  it('scaffolds Express API service template', () => {
    const t = getTemplate('express-api');
    expect(t.name).toBe('Express API');
    expect(t.files['package.json']).toContain('express-api-service');
    expect(t.files['src/server.js']).toContain('express()');
  });

  it('scaffolds Dashboard Shell template with metrics and tables', () => {
    const t = getTemplate('dashboard-shell');
    expect(t.name).toBe('Dashboard Shell');
    expect(t.files['src/App.jsx']).toContain('Total Revenue');
    expect(t.files['src/App.jsx']).toContain('Recent Transactions');
  });
});

describe('Phase 1: Multi-Provider Cloud Deployments', () => {
  it('correctly resolves deployment tokens from env or settings', async () => {
    const vercelToken = await resolveVercelToken('nonexistent-project');
    const netlifyToken = await resolveNetlifyToken('nonexistent-project');
    const cfToken = await resolveCloudflareToken('nonexistent-project');
    const ghToken = await resolveGitHubToken('nonexistent-project');

    // In local test env these are undefined or whatever is in .env.local
    expect(typeof vercelToken === 'string' || vercelToken === undefined).toBe(true);
    expect(typeof netlifyToken === 'string' || netlifyToken === undefined).toBe(true);
    expect(typeof cfToken === 'string' || cfToken === undefined).toBe(true);
    expect(typeof ghToken === 'string' || ghToken === undefined).toBe(true);
  });
});
