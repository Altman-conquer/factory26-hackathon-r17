const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

function gridCell(page, name) {
  return page.getByRole('grid', { name: 'Worksheet grid' }).getByRole('gridcell', { name, exact: true });
}

async function openWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Insert', exact: true })).toBeVisible();
}

async function openAddNote(page, coordinate) {
  await gridCell(page, coordinate).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add note', exact: true }).click();
  return page.getByRole('dialog', { name: `Note for ${coordinate}`, exact: true });
}

async function openExistingNote(page, coordinate) {
  await page.getByRole('button', { name: `Open note for ${coordinate}`, exact: true }).click();
  return page.getByRole('dialog', { name: `Note for ${coordinate}`, exact: true });
}

test.describe('REQ-8-1-1 cell notes', () => {
  test('creates a note, preserves the cell value, and persists the open-note button and text', async ({ page }) => {
    const noteText = 'Confirm the harbor reference before release';
    await openWorkbook(page, 'EVO-N05-NOTE-CREATE');
    const dialog = await openAddNote(page, 'D8');
    await expect(dialog.getByLabel('Note', { exact: true })).toBeEditable();
    await dialog.getByLabel('Note', { exact: true }).fill(noteText);
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(gridCell(page, 'D8')).toHaveText('Manifest R41');
    const noteButton = page.getByRole('button', { name: 'Open note for D8', exact: true });
    await expect(noteButton).toBeVisible();

    const opened = await openExistingNote(page, 'D8');
    await expect(opened.getByText(noteText, { exact: true })).toBeVisible();
    await expect(opened.getByLabel('Note', { exact: true })).toHaveValue(noteText);

    await page.reload();
    await expect(gridCell(page, 'D8')).toHaveText('Manifest R41');
    const reopened = await openExistingNote(page, 'D8');
    await expect(reopened.getByText(noteText, { exact: true })).toBeVisible();
  });

  test('edits an existing note without changing the cell value and persists the replacement text', async ({ page }) => {
    const replacement = 'Controller signed at 14:20';
    await openWorkbook(page, 'EVO-N05-NOTE-EDIT');
    let dialog = await openExistingNote(page, 'F6');
    await expect(dialog.getByText('Awaiting controller sign-off', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(dialog.getByLabel('Note', { exact: true })).toBeEditable();
    await dialog.getByLabel('Note', { exact: true }).fill(replacement);
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(gridCell(page, 'F6')).toHaveText('Gate Rho');
    dialog = await openExistingNote(page, 'F6');
    await expect(dialog.getByText(replacement, { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Note', { exact: true })).toHaveValue(replacement);

    await page.reload();
    await expect(gridCell(page, 'F6')).toHaveText('Gate Rho');
    dialog = await openExistingNote(page, 'F6');
    await expect(dialog.getByText(replacement, { exact: true })).toBeVisible();
  });

  test('deletes an existing note and its open button persistently without changing the cell value', async ({ page }) => {
    await openWorkbook(page, 'EVO-N05-NOTE-DELETE');
    const dialog = await openExistingNote(page, 'J3');
    await expect(dialog.getByText('Retire after audit', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete note', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Open note for J3', exact: true })).toHaveCount(0);
    await expect(gridCell(page, 'J3')).toHaveText('Route Zeta');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Open note for J3', exact: true })).toHaveCount(0);
    await expect(gridCell(page, 'J3')).toHaveText('Route Zeta');
  });

  test('creates an independent note for a different cell and keeps the exact coordinate identity', async ({ page }) => {
    const noteText = 'Fresh coordinate-specific note';
    await openWorkbook(page, 'EVO-N05-NOTE-CREATE');
    const dialog = await openAddNote(page, 'H2');
    await dialog.getByLabel('Note', { exact: true }).fill(noteText);
    await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Open note for H2', exact: true })).toBeVisible();
    const opened = await openExistingNote(page, 'H2');
    await expect(opened.getByText(noteText, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Open note for H2', exact: true })).toBeVisible();
    const reopened = await openExistingNote(page, 'H2');
    await expect(reopened.getByText(noteText, { exact: true })).toBeVisible();
  });
});
