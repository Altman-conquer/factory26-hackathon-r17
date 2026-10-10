const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openQ3Sales(page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Q3 Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();
}

test.describe('REQ-2 Worksheets and Table Structure', () => {
  test('REQ-2-1-1 seed has Sheet1/Sheet2 and add worksheet creates Sheet3 active with A1 selected', async ({ page }) => {
    await openQ3Sales(page);

    const sheet1 = page.getByRole('tab', { name: 'Sheet1', exact: true });
    const sheet2 = page.getByRole('tab', { name: 'Sheet2', exact: true });
    await expect(sheet1).toBeVisible();
    await expect(sheet2).toBeVisible();
    await expect(sheet1).toHaveAttribute('aria-selected', 'true');

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('800');

    await page.getByRole('button', { name: 'Add worksheet', exact: true }).click();
    const sheet3 = page.getByRole('tab', { name: 'Sheet3', exact: true });
    await expect(sheet3).toBeVisible();
    await expect(sheet3).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('');
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sheet3', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet3', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('');
  });

  test('REQ-2-1-1 add worksheet uses first unused SheetN on a single-sheet workbook', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New blank workbook' }).click();
    await page.getByLabel('Workbook name').fill('Single Sheet Workbook');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Add worksheet', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('REQ-2-1-2 switching worksheets preserves independent state and active tab after reload', async ({ page }) => {
    await openQ3Sales(page);

    // Ensure Sheet1 is the active worksheet before selecting B3.
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');

    // Select B3 on Sheet1 before switching.
    await page.getByRole('gridcell', { name: 'B3', exact: true }).click();
    await expect(page.getByRole('gridcell', { name: 'B3', exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Sheet2', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveAttribute('aria-selected', 'true');

    // Switch back: Sheet1 B3 selection should be restored.
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'B3', exact: true })).toHaveAttribute('aria-selected', 'true');

    // Reload should keep Sheet1 active because it was the last active tab.
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'B3', exact: true })).toHaveAttribute('aria-selected', 'true');
  });

  test('REQ-2-1-3 rename worksheet validates empty/duplicate and persists success', async ({ page }) => {
    await openQ3Sales(page);

    await page.getByRole('button', { name: 'Worksheet options for Sheet2', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Rename worksheet' });
    await expect(dialog).toBeVisible();
    const nameInput = page.getByLabel('Worksheet name');
    await expect(nameInput).toHaveValue('Sheet2');

    await nameInput.fill('   ');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Worksheet name cannot be empty')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toBeVisible();

    await nameInput.fill('Sheet1');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Worksheet name already exists')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toBeVisible();

    await nameInput.fill('Data');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('tab', { name: 'Data', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Data', exact: true })).toBeVisible();

    // Restore the seeded worksheet name so later serial tests can use Sheet2.
    await page.getByRole('button', { name: 'Worksheet options for Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Worksheet name').fill('Sheet2');
    await page.getByRole('dialog', { name: 'Rename worksheet' }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toBeVisible();
  });

  test('REQ-2-1-4 delete worksheet removes it and activates adjacent sheet; single-sheet delete shows error', async ({ page }) => {
    await openQ3Sales(page);

    await page.getByRole('button', { name: 'Worksheet options for Sheet2', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete worksheet' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Sheet2')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete worksheet' }).click();

    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sheet2', exact: true })).toHaveCount(0);

    // Remove the worksheet added by the first serial test so only Sheet1 remains.
    if (await page.getByRole('tab', { name: 'Sheet3', exact: true }).count()) {
      await page.getByRole('button', { name: 'Worksheet options for Sheet3', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      await page.getByRole('dialog', { name: 'Delete worksheet' }).getByRole('button', { name: 'Delete worksheet' }).click();
      await expect(page.getByRole('tab', { name: 'Sheet3', exact: true })).toHaveCount(0);
    }

    // Only one worksheet remains: delete should not open a dialog.
    await page.getByRole('button', { name: 'Worksheet options for Sheet1', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delete worksheet' })).toHaveCount(0);
    await expect(page.getByText('A workbook must contain at least one worksheet')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toBeVisible();
  });

  test('REQ-2-2-1 row insert above and delete row shift data and persist', async ({ page }) => {
    await openQ3Sales(page);

    // Insert a blank row above row 2.
    await page.getByRole('rowheader', { name: '2', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 row above', exact: true }).click();

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A4', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B4', exact: true })).toHaveText('800');

    await page.reload();
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'A4', exact: true })).toHaveText('North');

    // Delete the blank row 2; original data should shift back up.
    await page.getByRole('rowheader', { name: '2', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete row', exact: true }).click();
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('800');
  });

  test('REQ-2-2-2 column insert left and delete column shift data and persist', async ({ page }) => {
    await openQ3Sales(page);

    // Insert a blank column left of B.
    await page.getByRole('columnheader', { name: 'B', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 column left', exact: true }).click();

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'B1', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'C3', exact: true })).toHaveText('800');

    await page.reload();
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'B1', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'C2', exact: true })).toHaveText('1200');

    // Delete blank column B; original data should shift back left.
    await page.getByRole('columnheader', { name: 'B', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete column', exact: true }).click();
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');
    // Deleting the inserted blank column shifts the original column C data left into B.
    await expect(grid.getByRole('gridcell', { name: 'B1', exact: true })).toHaveText('Sales');
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('800');
  });
});
