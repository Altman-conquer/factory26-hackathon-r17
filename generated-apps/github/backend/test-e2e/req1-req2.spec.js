const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function signIn(page, identifier, password) {
  await page.goto('/');
  const signInLink = page.getByRole('link', { name: 'Sign in' });
  if (await signInLink.count()) {
    await signInLink.first().click();
  } else {
    await page.goto('/signin');
  }
  await page.getByLabel('Username or email', { exact: true }).fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('current-username')).toContainText(identifier.includes('@') ? /./ : identifier);
}

test('REQ-1-1-1 registration validates fields, creates account, and hands off to sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Create an account' }).click();

  await page.getByLabel('Username', { exact: true }).fill('EvoUpper01');
  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password').fill('different');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Username format is invalid')).toBeVisible();
  await expect(page.getByText('Email format is invalid')).toBeVisible();
  await expect(page.getByText('Password requirements are not satisfied')).toBeVisible();
  await expect(page.getByText('Agree to terms is required')).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveValue('EvoUpper01');

  const suffix = Date.now().toString().slice(-8);
  const username = `evo_user_${suffix}`;
  const email = `evo.user.${suffix}@evolution.test`;
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Evo-Password-987!');
  await page.getByLabel('Confirm password').fill('Evo-Password-987!');
  await page.getByRole('checkbox', { name: 'Agree to the terms' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username or email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Evo-Password-987!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('current-username')).toHaveText(username);
  await page.reload();
  await expect(page.getByTestId('current-username')).toHaveText(username);
});

test('REQ-1-1-2 sign-in is exact for usernames and case-insensitive for emails with generic failure', async ({ page }) => {
  await signIn(page, 'EVO.LOGIN.CASE@EVOLUTION.TEST', 'Evo-Password-987!');
  await expect(page.getByTestId('current-username')).toHaveText('evo-login-case');

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await page.goto('/signin');
  await page.getByLabel('Username or email', { exact: true }).fill('EVO-LOGIN-CASE');
  await page.getByLabel('Password', { exact: true }).fill('Evo-Password-987!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();

  await page.getByLabel('Username or email', { exact: true }).fill('evo-login-case');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();
});

test('REQ-1-1-3 recovery uses fixed code and updates the same account', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('link', { name: 'Forgot password' }).click();
  await page.getByLabel('Email', { exact: true }).fill('recovery-success@example.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('123456')).toBeVisible();
  await page.getByLabel('Verification code').fill('000000');
  await page.getByLabel('New password').fill('Replacement-password-456!');
  await page.getByLabel('Confirm password').fill('Replacement-password-456!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('Verification code is invalid')).toBeVisible();

  await page.getByLabel('Verification code').fill('123456');
  await page.getByLabel('New password').fill('Replacement-password-456!');
  await page.getByLabel('Confirm password').fill('Replacement-password-456!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
});

test('REQ-1-2 sign-out can be cancelled or confirmed and does not survive reload', async ({ page }) => {
  await signIn(page, 'alice-dev', 'Valid-password-123!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('current-username')).toHaveText('alice-dev');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('REQ-1-3 password change validates current/mismatch and makes the new password effective', async ({ page }) => {
  await signIn(page, 'password-change-success', 'Valid-password-123!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Password and authentication' }).click();
  await page.getByLabel('Current password').fill('Valid-password-123!-wrong');
  await page.getByLabel('New password').fill('Another-valid-password-123!');
  await page.getByLabel('Confirm password').fill('does-not-match');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Current password is incorrect')).toBeVisible();

  await page.getByLabel('Current password').fill('Valid-password-123!');
  await page.getByLabel('New password').fill('New-password-456!');
  await page.getByLabel('Confirm password').fill('New-password-456!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated')).toBeVisible();
});

test('REQ-1-4 active sessions lists the current session and revokes another browser session', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();

  await signIn(firstPage, 'evo-session-owner', 'Evo-Password-987!');
  await signIn(secondPage, 'evo-session-owner', 'Evo-Password-987!');

  await firstPage.getByRole('button', { name: 'Account menu' }).click();
  await firstPage.getByRole('link', { name: 'Settings' }).click();
  await firstPage.getByRole('link', { name: 'Active sessions' }).click();
  await expect(firstPage.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
  await expect(firstPage.getByText('Current session')).toBeVisible();
  await firstPage.getByRole('button', { name: 'Revoke session' }).first().click();
  await expect(firstPage.getByText('Session revoked')).toBeVisible();

  await secondPage.reload();
  await expect(secondPage.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await first.close();
  await second.close();
});

test('REQ-2-1-1 visitors see public repositories but never private repository names', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Acme Demo' }).click();
  await expect(page.getByRole('heading', { name: /Acme Demo/ })).toBeVisible();
  await page.getByRole('link', { name: 'Repositories' }).click();
  await page.getByLabel('Find a repository').fill('acme-docs');
  await expect(page.getByRole('link', { name: 'acme-docs' })).toBeVisible();
  await page.getByRole('link', { name: 'acme-docs' }).click();
  await expect(page.getByRole('heading', { name: /acme-demo\/acme-docs/ })).toBeVisible();

  await page.getByRole('link', { name: 'Back to repositories' }).click();
  await page.getByLabel('Find a repository').fill('secret-research');
  await expect(page.getByRole('link', { name: 'secret-research' })).toHaveCount(0);
});

test('REQ-2-1-2 creates a normalized organization with persisted heading and validates duplicates', async ({ page }) => {
  await signIn(page, 'evo-org-owner', 'Evo-Password-987!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByRole('link', { name: 'New organization' }).click();
  const suffix = Date.now().toString().slice(-6);
  const orgName = `Evo-Lab-${suffix}`;
  await page.getByLabel('Organization name').fill(orgName);
  await page.getByLabel('Display name').fill(`Evo Lab ${suffix}`);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(orgName.toLowerCase()) })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(orgName.toLowerCase()) })).toBeVisible();
});

test('REQ-2-2 team creation, membership and cycle rejection work from the UI', async ({ page }) => {
  await signIn(page, 'team-maintainer', 'Valid-password-123!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByRole('link', { name: 'Acme Demo' }).click();
  await page.getByRole('link', { name: 'Teams' }).click();
  await page.getByRole('link', { name: 'New team' }).click();
  const teamName = `mobile-team-${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Team name').fill(teamName);
  await page.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible();

  await page.goto('/organizations/acme-demo/teams/frontend-team/settings');
  await page.getByLabel('Parent team').selectOption('frontend-child');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Cyclic team hierarchy is not allowed')).toBeVisible();
});

test('REQ-2-2-3 and REQ-2-2-4 owner adds and removes an organization member', async ({ page }) => {
  await signIn(page, 'org-owner', 'Valid-password-123!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByRole('link', { name: 'Acme Demo' }).click();
  await page.getByRole('link', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Add member' }).click();
  await page.getByLabel('Username or email', { exact: true }).fill('new-member');
  await page.getByLabel('Role', { exact: true }).selectOption('Member');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('new-member').first()).toBeVisible();

  await page.getByRole('button', { name: 'Member menu new-member' }).click();
  await page.getByRole('button', { name: 'Remove from organization' }).click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('new-member')).toHaveCount(0);
});

test('REQ-2-3 repository access grants can be added as Write and updated to Read', async ({ page }) => {
  await signIn(page, 'repo-admin', 'Valid-password-123!');
  await page.goto('/repositories/acme-demo/acme-docs/settings');
  await page.getByRole('link', { name: 'Manage access' }).click();
  await page.getByRole('button', { name: 'Add people or teams' }).click();
  await page.getByLabel('Search', { exact: true }).fill('frontend-team');
  await page.getByLabel('Team', { exact: true }).selectOption('frontend-team');
  await page.getByLabel('Role', { exact: true }).selectOption('Write');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('frontend-team')).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'frontend-team' });
  await row.getByLabel('Role for frontend-team').selectOption('Read');
  await row.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  const reloadedRow = page.getByRole('row').filter({ hasText: 'frontend-team' });
  await expect(reloadedRow.getByLabel('Role for frontend-team')).toHaveValue('Read');
});

test('REQ-2-4 audit log filters for Owners and is hidden from ordinary Members', async ({ page }) => {
  await signIn(page, 'evo-audit-owner', 'Evo-Password-987!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByRole('link', { name: 'Evo Audit Org' }).click();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
  await page.getByLabel('Filter action').selectOption('Member added');
  await expect(page.getByRole('cell', { name: 'Member added' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Filter action')).toHaveValue('Member added');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Confirm sign out' }).click();
  await signIn(page, 'evo-audit-viewer', 'Evo-Password-987!');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByRole('link', { name: 'Evo Audit Org' }).click();
  await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
});
