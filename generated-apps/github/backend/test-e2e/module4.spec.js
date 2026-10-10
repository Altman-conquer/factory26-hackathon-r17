const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function signIn(page, identifier, password = 'Valid-password-123!') {
  await page.goto('/');
  const signInLink = page.getByRole('link', { name: 'Sign in' });
  if (await signInLink.count()) await signInLink.first().click();
  else await page.goto('/signin');
  await page.getByLabel('Username or email', { exact: true }).fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('current-username')).toBeVisible();
}

async function openAcmePulls(page) {
  await page.goto('/');
  const repositoriesLink = page.getByRole('link', { name: 'Repositories' });
  if (await repositoriesLink.count()) {
    await repositoriesLink.first().click();
    await page.getByRole('link', { name: 'acme-demo/acme-docs' }).click();
  } else {
    await page.getByRole('link', { name: 'acme-docs' }).first().click();
  }
  await page.getByRole('link', { name: 'Pull requests' }).click();
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
}

test('REQ-6-2-1 lists and opens a public pull request that survives reload', async ({ page }) => {
  await openAcmePulls(page);
  await page.getByRole('link', { name: 'Open' }).click();
  const link = page.getByRole('link', { name: 'Improve onboarding' });
  await expect(link).toBeVisible();
  await page.reload();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Improve onboarding' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Improve onboarding' })).toBeVisible();
});

test('REQ-6-2-2 and REQ-6-2-3 compare branches, rejects blank titles, and creates a normal PR', async ({ page }) => {
  await signIn(page, 'pr-contributor');
  await openAcmePulls(page);
  await page.getByRole('link', { name: 'New pull request' }).click();
  await page.getByLabel('Base').selectOption('main');
  await page.getByLabel('Compare').selectOption('feature-search');
  await page.getByRole('button', { name: 'Compare changes' }).click();
  await expect(page.getByText('src/search.ts').first()).toBeVisible();

  await page.getByRole('button', { name: 'Create pull request' }).click();
  await page.getByLabel('Title').fill('   ');
  await page.getByRole('button', { name: 'Create pull request' }).click();
  await expect(page.getByText('Title is required').first()).toBeVisible();

  const title = `Browser pull request ${Date.now()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Browser-created pull request description');
  await page.getByRole('button', { name: 'Create pull request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('REQ-6-2-2 identical branches cannot create a PR', async ({ page }) => {
  await signIn(page, 'pr-contributor');
  await openAcmePulls(page);
  await page.getByRole('link', { name: 'New pull request' }).click();
  await page.getByLabel('Base').selectOption('main');
  await page.getByLabel('Compare').selectOption('main');
  await page.getByRole('button', { name: 'Compare changes' }).click();
  await expect(page.getByText(/no differences/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create pull request' })).toHaveCount(0);
});

test('REQ-6-2-4 creates a draft and marks it ready for review', async ({ page }) => {
  await signIn(page, 'pr-contributor');
  await openAcmePulls(page);
  await page.getByRole('link', { name: 'New pull request' }).click();
  await page.getByLabel('Base').selectOption('main');
  await page.getByLabel('Compare').selectOption('feature-search');
  await page.getByRole('button', { name: 'Compare changes' }).click();
  await page.getByRole('button', { name: 'Create draft pull request' }).click();
  const title = `Browser draft ${Date.now()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create draft pull request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
  await page.getByRole('button', { name: 'Ready for review' }).click();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
});

test('REQ-6-3-3 and REQ-6-3-4 add review comments and submit reviews', async ({ page }) => {
  await signIn(page, 'pr-reviewer');
  await page.goto('/repositories/acme-demo/acme-docs/pulls/4/files');
  await expect(page.getByRole('heading', { name: 'Reviewable onboarding PR' })).toBeVisible();
  await page.getByRole('button', { name: 'Add comment' }).first().click();
  await page.getByLabel('Comment').fill('Browser review comment');
  await page.getByRole('button', { name: 'Add single comment' }).click();
  await expect(page.getByText('Browser review comment')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Browser review comment')).toBeVisible();

  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('radio', { name: 'Approve' }).check();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
});

test('REQ-6-5 merges the eligible PR and disables the blocked merge', async ({ page }) => {
  await signIn(page, 'pr-maintainer');
  await page.goto('/repositories/acme-demo/acme-docs/pulls/9');
  await expect(page.getByRole('heading', { name: 'Mergeable onboarding PR' })).toBeVisible();
  const merge = page.getByRole('button', { name: 'Merge pull request' });
  await expect(merge).toBeEnabled();
  await merge.click();
  await page.getByRole('button', { name: 'Confirm merge' }).click();
  await expect(page.getByText('Merged', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Merged', { exact: true })).toBeVisible();

  await page.goto('/repositories/acme-demo/acme-docs/pulls/10');
  await expect(page.getByRole('heading', { name: 'Blocked onboarding PR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Merge pull request' })).toBeDisabled();
  await expect(page.getByText('Review required by branch protection').first()).toBeVisible();
});

test('REQ-6-6 closes and reopens an authored PR and hides controls from a Read viewer', async ({ page }) => {
  await signIn(page, 'pr-author');
  await page.goto('/repositories/acme-demo/acme-docs/pulls/11');
  await page.getByRole('button', { name: 'Close pull request' }).click();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen pull request' }).click();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Close pull request' })).toBeVisible();

  await signIn(page, 'pr-viewer');
  await page.goto('/repositories/acme-demo/acme-docs/pulls/12');
  await expect(page.getByRole('heading', { name: 'Protected onboarding PR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close pull request' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen pull request' })).toHaveCount(0);
});

test('REQ-6-1 creates a branch protection rule and updates the PR test check', async ({ page }) => {
  await signIn(page, 'protection-admin');
  await page.goto('/repositories/protection-admin/branch-protection-demo/settings/branches');
  await page.getByRole('button', { name: 'Add branch protection rule' }).click();
  await page.getByLabel('Branch name pattern').fill('main');
  await page.getByLabel('Require 1 approval').check();
  await page.getByLabel('Require status check test').check();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('1 approval', { exact: true })).toBeVisible();
  await expect(page.getByText('test', { exact: true })).toBeVisible();

  await page.goto('/repositories/protection-admin/branch-protection-demo/pulls/1');
  await page.getByLabel('test status').selectOption('success');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText(/test success/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/test success/i)).toBeVisible();
});
