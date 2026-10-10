const { test, expect } = require('@playwright/test');
const fs = require('fs');

test.describe.configure({ mode: 'serial' });

test.describe('REQ-1 Workbook Access and Lifecycle', () => {
  test('REQ-1-1-1 home lists seeded workbook and opening/refresh preserves state', async ({ page }) => {
    await page.goto('/');

    const q3Link = page.getByRole('link', { name: 'Q3 Sales', exact: true });
    await expect(q3Link).toBeVisible();
    await expect(page.getByText(/Last updated: Jan 15, 2026, 9:30 AM/)).toBeVisible();

    await q3Link.click();
    await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();
    await expect(page.getByText(/Last updated: Jan 15, 2026, 9:30 AM/)).toBeVisible();

    const sheetTab = page.getByRole('tab', { name: 'Sheet1' });
    await expect(sheetTab).toBeVisible();
    await expect(sheetTab).toHaveAttribute('aria-selected', 'true');

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    await expect(grid).toHaveAttribute('aria-multiselectable', 'true');

    const cellA1 = page.getByRole('gridcell', { name: 'A1', exact: true });
    await expect(cellA1).toBeVisible();
    await expect(cellA1).toHaveText('Region');
    await expect(cellA1).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A2', exact: true })).toHaveAttribute('aria-selected', 'false');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');
    await expect(page.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
  });

  test('REQ-1-2-1 create a blank workbook and return to home', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New blank workbook' }).click();
    await expect(page).toHaveURL(/\/workbooks\/new$/);

    await page.getByLabel('Workbook name').fill('Created Workbook');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('heading', { name: 'Created Workbook' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('');

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Created Workbook', exact: true })).toBeVisible();
  });

  test('REQ-1-3-1 import valid and invalid CSV through home dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import CSV' });
    await expect(dialog).toBeVisible();

    const csvContent = 'Name,Amount\n"East, Inc.",1200\nNorth,800\n"line\nbreak","say ""hi"""';
    await page.getByLabel('CSV file').setInputFiles({
      name: 'sales.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent, 'utf8'),
    });
    await dialog.getByRole('button', { name: 'Confirm import' }).click();

    await expect(page.getByRole('heading', { name: 'sales' })).toBeVisible();
    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Name');
    await expect(grid.getByRole('gridcell', { name: 'B1', exact: true })).toHaveText('Amount');
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East, Inc.');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('North');
    await expect(grid.getByRole('gridcell', { name: 'B3', exact: true })).toHaveText('800');
    await expect(grid.getByRole('gridcell', { name: 'A4', exact: true })).toHaveText('line\nbreak');
    await expect(grid.getByRole('gridcell', { name: 'B4', exact: true })).toHaveText('say "hi"');

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'sales', exact: true })).toBeVisible();

    // Invalid CSV must be rejected and must not create a workbook link.
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'bad.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('"abc,def', 'utf8'),
    });
    await page.getByRole('dialog', { name: 'Import CSV' }).getByRole('button', { name: 'Confirm import' }).click();
    await expect(page.getByRole('dialog', { name: 'Import CSV' })).toBeVisible();
    await expect(page.getByText('Invalid CSV file format. Import failed.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'bad', exact: true })).toHaveCount(0);
  });

  test('REQ-1-3-2 export current worksheet as CSV without changing state', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'sales', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'sales' })).toBeVisible();

    const gridBefore = await page.getByRole('grid', { name: 'Worksheet grid' }).innerText();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const downloadPath = `/tmp/module1-export-${Date.now()}.csv`;
    await download.saveAs(downloadPath);
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('Name,Amount');
    expect(content).toContain('"East, Inc.",1200');
    expect(content).toContain('"line\nbreak","say ""hi"""');

    await expect(page.getByRole('heading', { name: 'sales' })).toBeVisible();
    expect(await page.getByRole('grid', { name: 'Worksheet grid' }).innerText()).toBe(gridBefore);
  });

  test('REQ-1-2-2 rename workbook with empty rejection and success', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Q3 Sales', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();

    await page.getByRole('button', { name: 'Rename workbook' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename workbook' });
    await expect(dialog).toBeVisible();

    const nameInput = page.getByLabel('Workbook name');
    await expect(nameInput).toHaveValue('Q3 Sales');
    await nameInput.fill('   ');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Workbook name cannot be empty')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();

    await nameInput.fill('Q3 Budget');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Q3 Budget' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Q3 Budget', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Q3 Sales', exact: true })).toHaveCount(0);
  });
});
