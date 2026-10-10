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

test('REQ-3-1 global search is case-insensitive by name/description and shows no results', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search' });
  await search.fill('EVO-SEARCH-CATALOG-S1');
  await search.press('Enter');
  await expect(page.getByRole('link', { name: 'evo-search-catalog-s1' })).toBeVisible();
  await page.getByRole('link', { name: 'evo-search-catalog-s1' }).click();
  await expect(page.getByRole('heading', { name: /evo-search-catalog-s1/ })).toBeVisible();

  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('evolution-notebook');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByRole('link', { name: 'evo-search-notebook-s2' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('evo-search-empty-s3');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByText('No results')).toBeVisible();
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('evo-search-empty-s3');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByText('No results')).toBeVisible();
});

test('REQ-3-2-1 creates an initialized private repository and validates duplicate/empty names', async ({ page }) => {
  await signIn(page, 'repo-owner');
  await page.getByRole('link', { name: 'New repository' }).first().click();
  await page.getByLabel('Repository name').fill('acme-docs');
  await page.getByRole('button', { name: 'Create repository' }).click();
  await expect(page.getByText(/already exists/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /acme-docs/ })).toHaveCount(0);

  await page.getByLabel('Repository name').fill('');
  await page.getByRole('button', { name: 'Create repository' }).click();
  await expect(page.getByText(/required/i)).toBeVisible();

  const unique = `pw-repo-${Date.now()}`;
  await page.getByLabel('Repository name').fill(unique);
  await page.getByLabel('Description').fill('Repository created by Playwright');
  await page.getByRole('radio', { name: 'Private' }).check();
  await page.getByRole('checkbox', { name: 'Add a README file' }).check();
  await page.getByRole('button', { name: 'Create repository' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(unique) })).toBeVisible();
  await expect(page.getByText('Private', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'README.md' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(unique) })).toBeVisible();
});

test('REQ-3-2-3 clone menu copies HTTPS and keeps the repository heading', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/repositories/acme-demo/acme-docs');
  await page.getByRole('button', { name: 'Code' }).click();
  await page.getByRole('tab', { name: 'HTTPS' }).click();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  await expect(page.getByRole('heading', { name: /acme-docs/ })).toBeVisible();
  await page.getByRole('tab', { name: 'SSH' }).click();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
});

test('REQ-4-1, REQ-4-2 browse files, history, diff and code search', async ({ page }) => {
  await page.goto('/repositories/acme-demo/acme-docs/code?branch=main');
  await page.getByRole('link', { name: 'src' }).click();
  await page.getByRole('link', { name: 'README.md' }).click();
  await expect(page.getByText('Document search flow')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Document search flow')).toBeVisible();

  await page.goto('/repositories/acme-demo/acme-docs/code?branch=main');
  await page.getByRole('link', { name: 'Commits' }).click();
  await expect(page.getByText('Document search flow').first()).toBeVisible();
  await expect(page.getByText('alice-dev')).toBeVisible();
  await expect(page.getByText(/ago/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Document search flow' }).click();
  await expect(page.getByText('Changed files')).toBeVisible();
  await expect(page.getByText('src/search.ts')).toBeVisible();

  await page.goto('/repositories/acme-demo/acme-docs/code?branch=main');
  await page.getByRole('searchbox', { name: 'Search' }).fill('search flow');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await page.getByRole('link', { name: 'Code' }).click();
  await page.getByRole('link', { name: 'README.md' }).click();
  await expect(page.getByText('search flow')).toBeVisible();

  await page.goto('/repositories/acme-demo/acme-docs/code?branch=main');
  await page.getByRole('searchbox', { name: 'Search' }).fill('no-such-token');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByText('No code results')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('no-such-token');
});

test('REQ-4-3-1 switches branches and preserves the branch in the address', async ({ page }) => {
  await page.goto('/repositories/evo-branch-lab/evo-branch-switch-s1/code');
  await page.getByRole('button', { name: 'Branch evo-main-s1' }).click();
  await page.getByRole('textbox', { name: 'Find branch' }).fill('evo-feature-s1');
  await page.getByRole('option', { name: 'evo-feature-s1' }).click();
  await expect(page.getByRole('button', { name: 'Branch evo-feature-s1' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'evo-target-s1.md' })).toBeVisible();
  await expect(page).toHaveURL(/branch=evo-feature-s1/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Branch evo-feature-s1' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'evo-target-s1.md' })).toBeVisible();
});

test('REQ-4-3-2 creates a branch as a writer and rejects invalid names', async ({ page }) => {
  await signIn(page, 'branch-contributor');
  await page.goto('/repositories/evolution-module2-lab/branch-switch-demo/code');
  await page.getByRole('button', { name: 'Branch main' }).click();
  await page.getByRole('textbox', { name: 'Find branch' }).fill('invalid..branch');
  await expect(page.getByText('Invalid branch')).toBeVisible();
  await page.getByRole('textbox', { name: 'Find branch' }).fill('invalid..branch');
  await page.keyboard.press('Escape');

  const branchName = `pw-branch-${Date.now()}`;
  await page.getByRole('button', { name: 'Branch main' }).click();
  await page.getByRole('textbox', { name: 'Find branch' }).fill(branchName);
  await page.getByRole('option', { name: `Create branch: ${branchName}` }).click();
  await expect(page.getByRole('button', { name: `Branch ${branchName}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: `Branch ${branchName}` })).toBeVisible();
});

test('REQ-4-4 creates a file and rejects invalid submissions', async ({ page }) => {
  await signIn(page, 'file-contributor');
  await page.goto('/repositories/evolution-module2-lab/file-management-demo/code');
  await page.getByRole('button', { name: 'Add file' }).click();
  await page.getByRole('link', { name: 'Create new file' }).click();
  const fileName = `pw-file-${Date.now()}.md`;
  await page.getByLabel('File name').fill(fileName);
  await page.getByLabel('File contents').fill('content from playwright');
  await page.getByLabel('Commit message').fill(`Add ${fileName}`);
  await page.getByRole('button', { name: 'Commit changes' }).click();
  await expect(page.getByText('content from playwright')).toBeVisible();
  await page.getByRole('link', { name: 'Commits' }).click();
  await expect(page.getByText(`Add ${fileName}`)).toBeVisible();
});

test('REQ-3-4 and REQ-3-5 settings visibility, archive and restore', async ({ page, browser }) => {
  await signIn(page, 'visibility-admin');
  await page.goto('/repositories/visibility-admin/visibility-demo/settings/general');
  await page.getByRole('button', { name: 'Change visibility' }).click();
  await page.getByRole('radio', { name: 'Public' }).check();
  await page.getByRole('button', { name: 'Confirm visibility' }).click();
  await expect(page.getByText('Public', { exact: true })).toBeVisible();

  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto('/repositories/visibility-admin/visibility-demo');
  await expect(anonymousPage.getByRole('heading', { name: /visibility-demo/ })).toBeVisible();
  await anonymous.close();

  await signIn(page, 'evo-archive-admin', 'Evo-Password-987!');
  await page.goto('/repositories/evo-archive-admin/evo-archive-repository-s1/settings');
  await page.getByRole('button', { name: 'Archive repository' }).click();
  await page.getByRole('dialog', { name: 'Archive repository' }).getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore repository' }).click();
  await page.getByRole('dialog', { name: 'Restore repository' }).getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByText('Archived', { exact: true })).toHaveCount(0);
});

test('REQ-3-2-2 forks a repository and shows the source relationship', async ({ page }) => {
  await signIn(page, 'fork-user');
  await page.goto('/repositories/acme-demo/acme-docs');
  await page.getByRole('button', { name: 'Fork' }).click();
  const forkName = `pw-fork-${Date.now()}`;
  await page.getByLabel('Repository name').fill(forkName);
  await page.getByRole('button', { name: 'Create fork' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(forkName) })).toBeVisible();
  await expect(page.getByText('Forked from')).toBeVisible();
  await expect(page.getByRole('link', { name: 'acme-docs' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(forkName) })).toBeVisible();
});

test('REQ-4-3-3 changes the default branch as admin', async ({ page }) => {
  await signIn(page, 'default-branch-admin');
  await page.goto('/repositories/evolution-module2-lab/default-branch-demo/settings/branches');
  await page.getByLabel('Default branch').selectOption('release');
  await page.getByRole('button', { name: 'Update' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.goto('/repositories/evolution-module2-lab/default-branch-demo/code');
  await expect(page.getByRole('button', { name: 'Branch release' })).toBeVisible();
  await page.getByRole('button', { name: 'Branch release' }).click();
  await expect(page.getByRole('option', { name: 'main' })).toBeVisible();
});

test('REQ-4-5 creates, views and rejects duplicate releases', async ({ page }) => {
  await signIn(page, 'evo-release-owner', 'Evo-Password-987!');
  await page.goto('/repositories/evo-release-org/evo-release-repository-s1/releases');
  await page.getByRole('button', { name: 'New release' }).click();
  await page.getByLabel('Tag name').fill('evo-v0-1-s1');
  await page.getByLabel('Release title').fill('Evolution Preview');
  await page.getByLabel('Description').fill('Evolution release description');
  await page.getByLabel('Target branch').selectOption('evo-main-s1');
  await page.getByRole('button', { name: 'Publish release' }).click();
  await expect(page.getByRole('heading', { name: 'evo-v0-1-s1' })).toBeVisible();
  await expect(page.getByText('Evolution Preview')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'evo-v0-1-s1' })).toBeVisible();

  await page.goto('/repositories/evo-release-org/evo-release-repository-s3/releases');
  await page.getByRole('button', { name: 'New release' }).click();
  await page.getByLabel('Tag name').fill('evo-v0-1-s3');
  await page.getByLabel('Release title').fill('Duplicate');
  await page.getByLabel('Description').fill('Duplicate tag attempt');
  await page.getByRole('button', { name: 'Publish release' }).click();
  await expect(page.getByText('Tag already exists')).toBeVisible();
});
