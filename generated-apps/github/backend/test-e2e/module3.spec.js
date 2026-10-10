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

async function openRepositoryIssues(page, repoName) {
  await page.getByRole('link', { name: 'Repositories' }).click();
  await page.getByRole('link', { name: `acme-demo/${repoName}` }).click();
  await page.getByRole('link', { name: 'Issues' }).click();
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
}

test('REQ-5-1 lists, filters and reloads public issues and detail from home', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'acme-docs' }).first().click();
  await page.getByRole('link', { name: 'Issues' }).click();
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();

  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('Improve onboarding');
  await expect(page.getByRole('link', { name: 'Improve onboarding' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Improve onboarding' })).toBeVisible();

  await page.getByRole('link', { name: 'Closed' }).click();
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('Legacy welcome text');
  await expect(page.getByRole('link', { name: 'Legacy welcome text' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Improve onboarding' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('Improve onboarding');
  await page.getByRole('link', { name: 'Improve onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Improve onboarding' })).toBeVisible();
  await expect(page.getByText('Describe the onboarding improvement.', { exact: true })).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await expect(page.getByText('Onboarding should explain the first steps.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Improve onboarding' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'acme-docs' }).first().click();
  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Improve onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Improve onboarding' })).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
});

test('REQ-5-2-1 creates an issue and rejects a whitespace title', async ({ page }) => {
  await signIn(page, 'issue-author');
  await openRepositoryIssues(page, 'acme-docs');

  const title = `Browser issue ${Date.now()}`;
  await page.getByRole('link', { name: 'New issue' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Browser issue description');
  await page.getByRole('button', { name: 'Submit new issue' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Browser issue description', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Issues' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  await page.getByRole('link', { name: 'New issue' }).click();
  await page.getByLabel('Title').fill('   ');
  await page.getByRole('button', { name: 'Submit new issue' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
});

test('REQ-5-2-2 edits title and description and preserves the original after invalid title', async ({ page }) => {
  await signIn(page, 'issue-editor');
  await openRepositoryIssues(page, 'acme-docs');
  await page.getByRole('link', { name: 'Editable onboarding issue' }).click();

  const newTitle = `Edited browser title ${Date.now()}`;
  await page.getByRole('button', { name: 'Edit issue title' }).click();
  await page.getByLabel('Issue title').fill(newTitle);
  await page.getByRole('button', { name: 'Save issue title' }).click();
  await expect(page.getByRole('heading', { name: newTitle })).toBeVisible();

  await page.getByRole('button', { name: 'Edit issue description' }).click();
  await page.getByLabel('Issue description').fill('Edited browser description');
  await page.getByRole('button', { name: 'Save issue description' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: newTitle })).toBeVisible();
  await expect(page.getByText('Edited browser description', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Original issue title' }).click();
  await page.getByRole('button', { name: 'Edit issue title' }).click();
  await page.getByLabel('Issue title').fill('   ');
  await page.getByRole('button', { name: 'Save issue title' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Original issue title' })).toBeVisible();
});

test('REQ-5-2-3 appends a comment and blocks whitespace submission', async ({ page }) => {
  await signIn(page, 'issue-commenter');
  await openRepositoryIssues(page, 'acme-docs');
  await page.getByRole('link', { name: 'Commentable onboarding issue' }).click();

  const comment = `Browser comment ${Date.now()}`;
  await page.getByLabel('Comment').fill(comment);
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();
  await expect(page.getByRole('article').getByText('issue-commenter', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Comment validation issue' }).click();
  await page.getByLabel('Comment').fill('   ');
  await expect(page.getByRole('button', { name: 'Comment' })).toBeDisabled();
});

test('REQ-5-3 assigns, unassigns, labels and milestones through issue metadata', async ({ page }) => {
  await signIn(page, 'issue-editor');
  await openRepositoryIssues(page, 'acme-docs');

  await page.getByRole('link', { name: 'Assignable onboarding issue' }).click();
  await page.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('textbox', { name: 'Search assignees' }).fill('bob-reviewer');
  await page.getByRole('button', { name: 'bob-reviewer' }).click();
  await expect(page.locator('aside p', { hasText: 'bob-reviewer' })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside p', { hasText: 'bob-reviewer' })).toBeVisible();
  await page.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('textbox', { name: 'Search assignees' }).fill('bob-reviewer');
  await page.getByRole('button', { name: 'bob-reviewer' }).click();
  await expect(page.locator('aside p', { hasText: 'bob-reviewer' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Labelable onboarding issue' }).click();
  await page.getByRole('button', { name: 'Labels' }).click();
  await page.getByRole('button', { name: 'bug' }).click();
  await expect(page.locator('aside').getByText('bug', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside').getByText('bug', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Milestone onboarding issue' }).click();
  await page.getByRole('button', { name: 'Milestone' }).click();
  await page.getByRole('button', { name: 'v1.0' }).click();
  await expect(page.locator('aside').getByText('v1.0', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('aside').getByText('v1.0', { exact: true })).toBeVisible();
});

test('REQ-5-4 closes and reopens an issue and hides transitions from a Read viewer', async ({ page, browser }) => {
  await signIn(page, 'issue-editor');
  await openRepositoryIssues(page, 'acme-docs');
  await page.getByRole('link', { name: 'Closable onboarding issue' }).click();
  await page.getByRole('button', { name: 'Close issue' }).click();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await expect(page.getByText('closed this issue', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen issue' }).click();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Close issue' })).toBeVisible();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, 'issue-viewer');
  await viewerPage.getByRole('link', { name: 'Repositories' }).click();
  await viewerPage.getByRole('link', { name: 'acme-demo/acme-docs' }).click();
  await viewerPage.getByRole('link', { name: 'Issues' }).click();
  await viewerPage.getByRole('link', { name: 'Protected onboarding issue' }).click();
  await expect(viewerPage.getByRole('button', { name: 'Close issue' })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Reopen issue' })).toHaveCount(0);
  await viewerContext.close();
});

test('REQ-5-5 adds/removes a reaction and shows read-only anonymous counts', async ({ page, browser }) => {
  await signIn(page, 'evo-reaction-user', 'Evo-Password-987!');
  await page.getByRole('link', { name: 'Repositories' }).click();
  await page.getByRole('link', { name: 'evo-reaction-user/evo-reaction-repository-s2' }).click();
  await page.getByRole('link', { name: 'Issues' }).click();
  await page.getByRole('link', { name: 'Evo reaction issue s2' }).click();
  await page.getByRole('button', { name: 'Add reaction' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: '+1' }).click();
  await expect(page.getByRole('button', { name: 'Remove +1 reaction' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove +1 reaction' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove +1 reaction' }).click();
  await expect(page.getByRole('button', { name: 'Add reaction' })).toBeVisible();

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto('/');
  await anonymousPage.getByRole('link', { name: 'evo-reaction-repository-s3' }).click();
  await anonymousPage.getByRole('link', { name: 'Issues' }).click();
  await anonymousPage.getByRole('link', { name: 'Evo reaction issue s3' }).click();
  await expect(anonymousPage.getByText('+1')).toBeVisible();
  await expect(anonymousPage.getByRole('button', { name: 'Add reaction' })).toHaveCount(0);
  await anonymousContext.close();
});
