const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openWorkbookRename(page) {
  await page.getByRole('button', { name: 'Rename workbook', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename workbook' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openWorksheetRename(page, sheetName) {
  await page.getByRole('button', { name: `Worksheet options for ${sheetName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename worksheet' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('REQ-1-2-2 workbook rename constraints', () => {
  test('REQ-1-2-2 trims, persists, updates home-page link, and preserves cell data', async ({ page }) => {
    await openWorkbook(page, 'EVO-M01-RENAME-OK');
    await expect(page.getByRole('gridcell', { name: 'F3', exact: true })).toHaveText('unreviewed');

    const dialog = await openWorkbookRename(page);
    const nameInput = page.getByLabel('Workbook name');
    await expect(nameInput).toHaveValue('EVO-M01-RENAME-OK');
    await nameInput.fill('  FY26 Procurement Ledger  ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('heading', { name: 'FY26 Procurement Ledger', exact: true })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'F3', exact: true })).toHaveText('unreviewed');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'FY26 Procurement Ledger', exact: true })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'F3', exact: true })).toHaveText('unreviewed');
    const reopened = await openWorkbookRename(page);
    await expect(page.getByLabel('Workbook name')).toHaveValue('FY26 Procurement Ledger');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'FY26 Procurement Ledger', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'EVO-M01-RENAME-OK', exact: true })).toHaveCount(0);
  });

  test('REQ-1-2-2 rejects whitespace-only workbook names and restores the last saved name', async ({ page }) => {
    await openWorkbook(page, 'EVO-M01-RENAME-DUP');
    const dialog = await openWorkbookRename(page);
    const nameInput = page.getByLabel('Workbook name');
    await nameInput.fill('   ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Workbook name cannot be empty', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();
    await expect(nameInput).toHaveValue('EVO-M01-RENAME-DUP');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();
    const reopened = await openWorkbookRename(page);
    await expect(page.getByLabel('Workbook name')).toHaveValue('EVO-M01-RENAME-DUP');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('REQ-1-2-2 rejects case-insensitive duplicate names and preserves the saved name', async ({ page }) => {
    await openWorkbook(page, 'EVO-M01-RENAME-DUP');
    let dialog = await openWorkbookRename(page);
    let nameInput = page.getByLabel('Workbook name');

    // Saving the same name must be allowed because a workbook is not a duplicate of itself.
    await nameInput.fill('EVO-M01-RENAME-DUP');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();

    dialog = await openWorkbookRename(page);
    nameInput = page.getByLabel('Workbook name');
    await nameInput.fill('evo-m01-archive-reserved');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Workbook name already exists', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();
    await expect(nameInput).toHaveValue('EVO-M01-RENAME-DUP');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();
    const reopened = await openWorkbookRename(page);
    await expect(page.getByLabel('Workbook name')).toHaveValue('EVO-M01-RENAME-DUP');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'EVO-M01-RENAME-DUP', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'EVO-M01-ARCHIVE-RESERVED', exact: true })).toBeVisible();
  });

  test('REQ-1-2-2 rejects names over 80 characters, preserves cell data, and accepts exactly 80', async ({ page }) => {
    await openWorkbook(page, 'EVO-M01-RENAME-LIMIT');
    await expect(page.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('limit sentinel');

    const tooLong = `EVO-${'A'.repeat(77)}`;
    expect(tooLong).toHaveLength(81);

    let dialog = await openWorkbookRename(page);
    let nameInput = page.getByLabel('Workbook name');
    await nameInput.fill(tooLong);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Workbook name must be 80 characters or fewer', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-LIMIT', exact: true })).toBeVisible();
    await expect(nameInput).toHaveValue('EVO-M01-RENAME-LIMIT');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'EVO-M01-RENAME-LIMIT', exact: true })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('limit sentinel');

    const exactlyEighty = 'B'.repeat(80);
    dialog = await openWorkbookRename(page);
    nameInput = page.getByLabel('Workbook name');
    await nameInput.fill(exactlyEighty);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: exactlyEighty, exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: exactlyEighty, exact: true })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('limit sentinel');
  });
});

test.describe('REQ-2-1-3 worksheet rename constraints', () => {
  test('REQ-2-1-3 trims, persists active worksheet, and preserves cell data', async ({ page }) => {
    await openWorkbook(page, 'EVO-M02-SHEET-OK');
    await expect(page.getByRole('tab', { name: 'HarborDraft', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'LedgerView', exact: true })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'D5', exact: true })).toHaveText('dock marker');

    const dialog = await openWorksheetRename(page, 'HarborDraft');
    const nameInput = page.getByLabel('Worksheet name');
    await expect(nameInput).toHaveValue('HarborDraft');
    await nameInput.fill('  Dispatch Register  ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('tab', { name: 'Dispatch Register', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'D5', exact: true })).toHaveText('dock marker');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Dispatch Register', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'D5', exact: true })).toHaveText('dock marker');
    const reopened = await openWorksheetRename(page, 'Dispatch Register');
    await expect(page.getByLabel('Worksheet name')).toHaveValue('Dispatch Register');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('REQ-2-1-3 rejects whitespace-only worksheet names and restores the previous name', async ({ page }) => {
    await openWorkbook(page, 'EVO-M02-SHEET-DUP');
    const dialog = await openWorksheetRename(page, 'ArchiveBay');
    const nameInput = page.getByLabel('Worksheet name');
    await nameInput.fill('   ');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Worksheet name cannot be empty', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ArchiveBay', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(nameInput).toHaveValue('ArchiveBay');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'ArchiveBay', exact: true })).toHaveAttribute('aria-selected', 'true');
    const reopened = await openWorksheetRename(page, 'ArchiveBay');
    await expect(page.getByLabel('Worksheet name')).toHaveValue('ArchiveBay');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('REQ-2-1-3 rejects worksheet names differing only by case', async ({ page }) => {
    await openWorkbook(page, 'EVO-M02-SHEET-DUP');
    const dialog = await openWorksheetRename(page, 'ArchiveBay');
    const nameInput = page.getByLabel('Worksheet name');
    await nameInput.fill('meridian');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Worksheet name already exists', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ArchiveBay', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(nameInput).toHaveValue('ArchiveBay');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'ArchiveBay', exact: true })).toHaveAttribute('aria-selected', 'true');
    const reopened = await openWorksheetRename(page, 'ArchiveBay');
    await expect(page.getByLabel('Worksheet name')).toHaveValue('ArchiveBay');
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('REQ-2-1-3 rejects names over 50 characters, preserves cell data, and accepts exactly 50', async ({ page }) => {
    await openWorkbook(page, 'EVO-M02-SHEET-LIMIT');
    await expect(page.getByRole('tab', { name: 'LengthGauge', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'G4', exact: true })).toHaveText('sheet sentinel');

    const tooLong = 'B'.repeat(51);
    let dialog = await openWorksheetRename(page, 'LengthGauge');
    let nameInput = page.getByLabel('Worksheet name');
    await nameInput.fill(tooLong);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Worksheet name must be 50 characters or fewer', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'LengthGauge', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(nameInput).toHaveValue('LengthGauge');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'LengthGauge', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'G4', exact: true })).toHaveText('sheet sentinel');

    const exactlyFifty = 'C'.repeat(50);
    dialog = await openWorksheetRename(page, 'LengthGauge');
    nameInput = page.getByLabel('Worksheet name');
    await nameInput.fill(exactlyFifty);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('tab', { name: exactlyFifty, exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.reload();
    await expect(page.getByRole('tab', { name: exactlyFifty, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'G4', exact: true })).toHaveText('sheet sentinel');
  });

  test('REQ-2-1-3 allows a worksheet name already used in a different workbook', async ({ page }) => {
    await openWorkbook(page, 'EVO-M02-SHEET-OK');
    const dialog = await openWorksheetRename(page, 'LedgerView');
    const nameInput = page.getByLabel('Worksheet name');
    await nameInput.fill('Meridian');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Meridian', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Meridian', exact: true })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tab', { name: 'Dispatch Register', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Meridian', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Dispatch Register', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
});
