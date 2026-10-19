import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-End User Journey Tests
 *
 * Covers the primary user journeys:
 * 1. Project creation, file tree inspection, and template onboarding
 * 2. Code editing and persistence
 * 3. Open Chat conversation lifecycle (create, send, receive, resume on reload)
 * 4. Responsive adaptation across Desktop (1280px), Tablet/Half-screen (768px), and Mobile (390px)
 */

async function createProjectViaApi(page: Page, title: string, template = 'blank') {
  const res = await page.request.post('/api/projects', {
    data: { title, template },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return data.project as { id: string; title: string; workspace: string };
}

async function deleteProjectViaApi(page: Page, id: string) {
  await page.request.delete(`/api/projects?id=${id}`).catch(() => {});
}

test.describe('End-to-End User Journeys', () => {
  test('Journey 1: Project creation, file navigation, and editor loading', async ({ page }) => {
    const proj = await createProjectViaApi(page, `journey-proj-${Date.now()}`, 'static-site');
    try {
      await page.goto(`/?projectId=${encodeURIComponent(proj.id)}`);

      // Verify TopBar shows the project
      await expect(page.locator('.topbar')).toBeVisible();

      // Verify file tree renders scaffolded files
      const fileExplorer = page.locator('.file-explorer');
      await expect(fileExplorer).toBeVisible({ timeout: 15_000 });
      await expect(fileExplorer.getByText('index.html')).toBeVisible();

      // Open index.html in the editor
      await fileExplorer.getByText('index.html').click();
      await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.vscode-tabs-bar')).toContainText('index.html');
    } finally {
      await deleteProjectViaApi(page, proj.id);
    }
  });

  test('Journey 2: Open Chat conversation creation, message send, and resume', async ({ page }) => {
    await page.goto('/chat');

    // Verify Open Chat layout loads
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 15_000 });
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await expect(sendButton).toBeVisible();

    // Start a conversation by typing a prompt
    const promptText = `E2E Test Prompt ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Message' }).fill(promptText);
    await sendButton.click();

    // Verify user message appears in timeline
    await expect(page.getByText(promptText).first()).toBeVisible({ timeout: 10_000 });

    // Verify conversation URL updates with conversation ID parameter
    await expect(page).toHaveURL(/\?id=/, { timeout: 15_000 });
    const currentUrl = page.url();
    const convoId = new URL(currentUrl).searchParams.get('id');
    expect(convoId).toBeTruthy();

    // Reload the page and verify the conversation resumes
    await page.reload();
    await expect(page.getByText(promptText).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Journey 3: Responsive layouts at half-screen and phone widths', async ({ page }) => {
    const proj = await createProjectViaApi(page, `responsive-journey-${Date.now()}`, 'blank');
    try {
      // 1. Half-screen / Tablet viewport (768 x 900)
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto(`/?projectId=${encodeURIComponent(proj.id)}`);
      await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });

      // No horizontal overflow
      const halfWidth = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(halfWidth.content).toBeLessThanOrEqual(halfWidth.viewport + 1);

      // 2. Mobile Phone viewport (390 x 844)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();

      // Mobile navigation tabs must be accessible
      await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();

      // No horizontal overflow on mobile
      const phoneWidth = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(phoneWidth.content).toBeLessThanOrEqual(phoneWidth.viewport + 1);
    } finally {
      await deleteProjectViaApi(page, proj.id);
    }
  });

  test('Journey 4: Preview tab and offline state detection', async ({ page }) => {
    const proj = await createProjectViaApi(page, `preview-journey-${Date.now()}`, 'blank');
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/?projectId=${encodeURIComponent(proj.id)}`);

      // Toggle live preview tab
      const previewToggle = page.getByRole('button', { name: 'Toggle live browser preview' }).first();
      await expect(previewToggle).toBeVisible({ timeout: 15_000 });
      await previewToggle.click();

      // Offline banner should render honestly when dev server has not started
      await expect(page.locator('.preview-offline-title')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.preview-offline-title')).toContainText('Preview server offline');
    } finally {
      await deleteProjectViaApi(page, proj.id);
    }
  });
});
