import { test, expect, type Page } from '@playwright/test';

/**
 * UI smoke suite against the real workspace: welcome screen, project
 * creation, workspace panels, settings views, and deletion.
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
    await createProjectViaUi(page, name);

    // Live agent status (not the old fake progress bar)
    await expect(page.locator('.progress-row')).toContainText('Idle');
    // Chat input ready
    await expect(page.locator('.input-textarea')).toBeEnabled();
    // Tab bar with the three panels
    for (const label of ['Code', 'Preview', 'Settings']) {
      await expect(
        page.locator('.tabbar-tab', { hasText: label })
      ).toBeVisible();
    }
    // Prompt template pills
    await expect(page.locator('.slash-pill').first()).toBeVisible();

    // Sidebar fetches on mount — reload so the new project is listed,
    // then exercise the UI delete flow
    await page.reload();
    const item = page.locator('.project-item', { hasText: name }).first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.hover();
    page.once('dialog', (d) => d.accept());
    await item.locator('.project-delete').click();
    await expect(
      page.locator('.project-item', { hasText: name })
    ).toHaveCount(0);
  });

  test('settings tab shows providers with live status', async ({ page }) => {
    const name = `e2e-settings-ui-${Date.now()}`;
    const id = await createProjectViaUi(page, name);

    await page.locator('.tabbar-tab', { hasText: 'Settings' }).click();
    await page.locator('.sn-item', { hasText: 'AI Providers' }).click();

    // Registry providers listed with live status
    await expect(page.locator('.provider-row').first()).toBeVisible({ timeout: 10_000 });
    for (const label of ['Groq', 'OpenRouter', 'Ollama', 'LM Studio']) {
      await expect(
        page.locator('.provider-name', { hasText: label }).first()
      ).toBeVisible();
    }

    await deleteProjectViaApi(page, id);
  });

  test('preview tab shows honest offline state and sub-tabs', async ({ page }) => {
    const name = `e2e-preview-ui-${Date.now()}`;
    const id = await createProjectViaUi(page, name);

    await page.locator('.tabbar-tab', { hasText: 'Preview' }).click();
    await expect(page.locator('.preview-offline-title')).toContainText(
      'Preview server offline'
    );
    // Sub-tab switch hides the browser layout
    await page.locator('.pst', { hasText: 'Database' }).click();
    await expect(page.locator('.preview-layout')).toHaveCount(0);

    await deleteProjectViaApi(page, id);
  });
});
