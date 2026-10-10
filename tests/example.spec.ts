import { test, expect } from '@playwright/test';

test('Create a new Salesforce record', async ({ page }) => {
  const accountName = `Playwright Account ${Date.now()}`;

  // Already authenticated via the saved storage state — straight to the form.
  await page.goto('/lightning/o/Account/new');

  const nameField = page.getByRole('textbox', { name: 'Account Name' });
  await expect(nameField).toBeVisible();
  await nameField.fill(accountName);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const toast = page.getByRole('status').filter({ hasText: 'was created' });
  await expect(toast).toContainText(accountName);
});
