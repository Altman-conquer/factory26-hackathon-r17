const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openQ3Sales(page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Q3 Sales', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Q3 Sales' })).toBeVisible();
}

async function gridCell(page, name) {
  return page.getByRole('grid', { name: 'Worksheet grid' }).getByRole('gridcell', { name, exact: true });
}

async function selectRange(page, start, end) {
  await (await gridCell(page, start)).click();
  await (await gridCell(page, end)).click({ modifiers: ['Shift'] });
}

test.describe('REQ-5-1 Sorting and Filtering', () => {
  test('REQ-5-1-1 sort range by Sales ascending with header persists and keeps outside unchanged', async ({ page }) => {
    await openQ3Sales(page);
    await selectRange(page, 'A1', 'C4');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sort range', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Sort range', exact: true });
    await expect(dialog).toBeVisible();

    const sortBy = dialog.getByRole('combobox', { name: 'Sort by', exact: true });
    await expect(sortBy).toBeVisible();
    await sortBy.click();
    await dialog.getByRole('option', { name: 'Sales', exact: true }).click();
    await expect(sortBy).toHaveValue('Sales');

    const order = dialog.getByRole('combobox', { name: 'Order', exact: true });
    await order.click();
    await dialog.getByRole('option', { name: 'Ascending', exact: true }).click();

    await dialog.getByRole('button', { name: 'Sort', exact: true }).click();

    await expect(await gridCell(page, 'A2')).toHaveText('South');
    await expect(await gridCell(page, 'B2')).toHaveText('700');
    await expect(await gridCell(page, 'A3')).toHaveText('North');
    await expect(await gridCell(page, 'A4')).toHaveText('East');
    await expect(await gridCell(page, 'A1')).toHaveText('Region');

    await page.reload();
    await expect(await gridCell(page, 'A2')).toHaveText('South');
    await expect(await gridCell(page, 'A4')).toHaveText('East');

    // Restore the original seed order so the serial module keeps a clean state.
    await selectRange(page, 'A1', 'C4');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sort range', exact: true }).click();
    const restoreDialog = page.getByRole('dialog', { name: 'Sort range', exact: true });
    const restoreSortBy = restoreDialog.getByRole('combobox', { name: 'Sort by', exact: true });
    await restoreSortBy.click();
    await restoreDialog.getByRole('option', { name: 'Region', exact: true }).click();
    await restoreDialog.getByRole('button', { name: 'Sort', exact: true }).click();
    await expect(await gridCell(page, 'A2')).toHaveText('East');
  });

  test('REQ-5-1-2 create value filter, persist, clear filter restores all', async ({ page }) => {
    await openQ3Sales(page);
    await selectRange(page, 'A1', 'C4');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create filter', exact: true }).click();

    const filterRegion = page.getByRole('button', { name: 'Filter Region', exact: true });
    await expect(filterRegion).toBeVisible();
    await filterRegion.click();

    const dialog = page.getByRole('dialog', { name: 'Filter Region', exact: true });
    await expect(dialog).toBeVisible();
    const eastCheckbox = dialog.getByRole('checkbox', { name: 'East', exact: true });
    await expect(eastCheckbox).toBeVisible();
    await eastCheckbox.check();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(await gridCell(page, 'A2')).toHaveText('East');
    await expect(await gridCell(page, 'A3')).toHaveCount(0);
    await expect(await gridCell(page, 'A4')).toHaveCount(0);

    await page.reload();
    await expect(await gridCell(page, 'A2')).toHaveText('East');
    await expect(await gridCell(page, 'A3')).toHaveCount(0);

    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Clear filter', exact: true }).click();
    await expect(await gridCell(page, 'A2')).toHaveText('East');
    await expect(await gridCell(page, 'A3')).toHaveText('North');
    await expect(await gridCell(page, 'A4')).toHaveText('South');
  });

  test('REQ-5-1-2 condition greater than persists', async ({ page }) => {
    await openQ3Sales(page);
    await selectRange(page, 'A1', 'C4');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create filter', exact: true }).click();

    const filterSales = page.getByRole('button', { name: 'Filter Sales', exact: true });
    await filterSales.click();
    const dialog = page.getByRole('dialog', { name: 'Filter Sales', exact: true });
    const condition = dialog.getByRole('combobox', { name: 'Condition', exact: true });
    await condition.click();
    await dialog.getByRole('option', { name: 'Greater than', exact: true }).click();
    await dialog.getByLabel('Value').fill('1000');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(await gridCell(page, 'A2')).toHaveText('East');
    await expect(await gridCell(page, 'A3')).toHaveCount(0);

    await page.reload();
    await expect(await gridCell(page, 'A2')).toHaveText('East');
    await expect(await gridCell(page, 'A3')).toHaveCount(0);

    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Clear filter', exact: true }).click();
  });

  test('REQ-5-1 Data menu has disabled Clear filter before any filter exists', async ({ page }) => {
    await openQ3Sales(page);
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Clear filter', exact: true })).toBeDisabled();
  });
});
