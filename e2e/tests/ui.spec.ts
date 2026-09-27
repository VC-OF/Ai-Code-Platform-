import { test, expect, type Page } from '@playwright/test';

/**
 * UI smoke suite against the real workspace: welcome screen, project
 * creation, workspace panels, settings views, and deletion.
 *
 * Selectors use accessible roles and visible text where the UI provides
 * them (panel toggles, settings views and the chat input have no stable
 * class names — several are CSS-module hashed).
 */

async function createProjectViaUi(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await expect(page.locator('.welcome-card')).toBeVisible();
  await page.getByPlaceholder('Project name…').fill(name);
  await page.locator('.template-chip', { hasText: 'Blank' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('.app-footer')).toBeVisible({ timeout: 25_000 });
  // The workspace URL carries the id (kept in sync by the app)
  await expect(page).toHaveURL(/projectId=proj_/);
  return new URL(page.url()).searchParams.get('projectId')!;
}

async function deleteProjectViaApi(page: Page, id: string) {
  await page.request.delete(`/api/projects?id=${id}`).catch(() => {});
}

test.describe('UI', () => {
  test('welcome screen shows template choices', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.welcome-card')).toBeVisible();
    const chips = page.locator('.template-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.filter({ hasText: 'React app' })).toBeVisible();
  });

  test('create project → workspace panels render → sidebar delete', async ({ page }) => {
    const name = `e2e-ui-${Date.now()}`;
    const id = await createProjectViaUi(page, name);
    try {
      // Live agent status in the footer (not a fake progress bar)
      await expect(page.locator('.app-footer').getByText('Idle', { exact: true })).toBeVisible();
      // Chat input ready
      await expect(page.getByRole('combobox', { name: 'Message' })).toBeEnabled();
      // Panel toggles in the top bar
      for (const label of ['Toggle code editor', 'Toggle live preview', 'Toggle settings']) {
        await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
      }
      // Prompt template shortcuts (short label, description in the title)
      await expect(page.getByTitle('Debug and fix an issue')).toBeVisible();

      // Sidebar fetches on mount — reload so the new project is listed,
      // then exercise the UI delete flow (confirm dialog)
      await page.reload();
      const item = page.locator('.project-item', { hasText: name }).first();
      await expect(item).toBeVisible({ timeout: 10_000 });
      await item.hover();
      page.once('dialog', (d) => d.accept());
      // Scoped to the sidebar item: the welcome screen's recent list has its own delete button
      await item.getByRole('button', { name: `Delete ${name}` }).click();
      await expect(page.locator('.project-item', { hasText: name })).toHaveCount(0);
    } finally {
      await deleteProjectViaApi(page, id);
    }
  });

  test('settings panel shows model providers with live status', async ({ page }) => {
    const id = await createProjectViaUi(page, `e2e-settings-ui-${Date.now()}`);
    try {
      await page.getByRole('button', { name: 'Toggle settings' }).first().click();
      await page.getByRole('button', { name: 'Models & MCP' }).click();

      const heading = page.getByRole('heading', { name: 'Model providers' });
      await expect(heading).toBeVisible({ timeout: 10_000 });
      const section = page.locator('section').filter({ has: heading });
      for (const label of ['Groq', 'OpenRouter', 'Ollama', 'LM Studio']) {
        await expect(section).toContainText(label);
      }
      // Each provider reports its live state (configured, running, or not)
      await expect(section).toContainText(/Not configured\.|Configured \(|Running at |Not detected at /);
    } finally {
      await deleteProjectViaApi(page, id);
    }
  });

  test('preview panel shows honest offline state and sub-tabs', async ({ page }) => {
    const id = await createProjectViaUi(page, `e2e-preview-ui-${Date.now()}`);
    try {
      await page.getByRole('button', { name: 'Toggle live preview' }).first().click();
      await expect(page.locator('.preview-offline-title')).toContainText('Preview server offline');
      // Sub-tab switch hides the browser layout
      await page.getByRole('tab', { name: 'Database' }).click();
      await expect(page.locator('.preview-layout')).toHaveCount(0);
    } finally {
      await deleteProjectViaApi(page, id);
    }
  });
});
