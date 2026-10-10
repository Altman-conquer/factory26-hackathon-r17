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

test.describe('REQ-3 Cell and Range Editing', () => {
  test('REQ-3-1-1 edit through formula bar and inline grid editor, escape cancels, formula persists', async ({ page }) => {
    await openQ3Sales(page);

    // Clear target range first.
    const d1 = await gridCell(page, 'D1');
    await d1.click();
    const formulaBar = page.getByLabel('Formula bar');
    await formulaBar.fill('');
    await formulaBar.press('Enter');

    // Enter values through formula bar.
    await d1.click();
    await formulaBar.fill('East');
    await formulaBar.press('Enter');
    await expect(d1).toHaveText('East');
    await expect(formulaBar).toHaveValue('East');

    const d2 = await gridCell(page, 'D2');
    await d2.click();
    await formulaBar.fill('1200');
    await formulaBar.press('Enter');
    await expect(d2).toHaveText('1200');

    const e1 = await gridCell(page, 'E1');
    await e1.click();
    await formulaBar.fill('North');
    await formulaBar.press('Enter');
    await expect(e1).toHaveText('North');

    // Use inline grid editor for E2.
    const e2 = await gridCell(page, 'E2');
    await e2.dblclick();
    const editE2 = page.getByRole('textbox', { name: 'Edit E2', exact: true });
    await expect(editE2).toBeVisible();
    await editE2.fill('800');
    await editE2.press('Enter');
    await expect(e2).toHaveText('800');

    // Formula through formula bar.
    const f1 = await gridCell(page, 'F1');
    await f1.click();
    await formulaBar.fill('=D2+E2');
    await formulaBar.press('Enter');
    await expect(f1).toHaveText('2000');
    await expect(formulaBar).toHaveValue('=D2+E2');

    await page.reload();
    await expect(await gridCell(page, 'D1')).toHaveText('East');
    await expect(await gridCell(page, 'D2')).toHaveText('1200');
    await expect(await gridCell(page, 'E1')).toHaveText('North');
    await expect(await gridCell(page, 'E2')).toHaveText('800');
    await expect(await gridCell(page, 'F1')).toHaveText('2000');

    // Escape cancels uncommitted inline edit.
    await d1.dblclick();
    const editD1 = page.getByRole('textbox', { name: 'Edit D1', exact: true });
    await editD1.fill('cancelled');
    await editD1.press('Escape');
    await expect(d1).toHaveText('East');
    await page.reload();
    await expect(d1).toHaveText('East');
  });

  test('REQ-3-1-3 rectangular selection persists after drag, reload, and worksheet switch', async ({ page }) => {
    await openQ3Sales(page);

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    const a1 = grid.getByRole('gridcell', { name: 'A1', exact: true });
    const b2 = grid.getByRole('gridcell', { name: 'B2', exact: true });
    const c1 = grid.getByRole('gridcell', { name: 'C1', exact: true });

    await a1.hover();
    await page.mouse.down();
    await b2.hover();
    await page.mouse.up();

    for (const name of ['A1', 'A2', 'B1', 'B2']) {
      await expect(grid.getByRole('gridcell', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(c1).toHaveAttribute('aria-selected', 'false');
    await expect(grid.getByRole('gridcell', { name: 'D1', exact: true })).toHaveAttribute('aria-selected', 'false');

    // Add a worksheet and switch back; the original selection must remain.
    await page.getByRole('button', { name: 'Add worksheet', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet3', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['A1', 'A2', 'B1', 'B2']) {
      await expect(grid.getByRole('gridcell', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(c1).toHaveAttribute('aria-selected', 'false');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['A1', 'A2', 'B1', 'B2']) {
      await expect(grid.getByRole('gridcell', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(c1).toHaveAttribute('aria-selected', 'false');
  });

  test('REQ-3-1-2 external clipboard paste into D1:E2 persists and preserves rectangle', async ({ page }) => {
    await openQ3Sales(page);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('East\t1200\nNorth\t800'));

    const d1 = await gridCell(page, 'D1');
    await d1.click();
    await page.keyboard.press('Control+V');

    await expect(await gridCell(page, 'D1')).toHaveText('East');
    await expect(await gridCell(page, 'E1')).toHaveText('1200');
    await expect(await gridCell(page, 'D2')).toHaveText('North');
    await expect(await gridCell(page, 'E2')).toHaveText('800');

    await page.reload();
    await expect(await gridCell(page, 'D1')).toHaveText('East');
    await expect(await gridCell(page, 'E1')).toHaveText('1200');
    await expect(await gridCell(page, 'D2')).toHaveText('North');
    await expect(await gridCell(page, 'E2')).toHaveText('800');
  });

  test('REQ-3-2-1 copy and cut ranges with formula adjustment through context menu and keyboard', async ({ page }) => {
    await openQ3Sales(page);

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    // Prepare numeric row for formula copy.
    await grid.getByRole('gridcell', { name: 'A5', exact: true }).click();
    const formulaBar = page.getByLabel('Formula bar');
    await formulaBar.fill('2');
    await formulaBar.press('Enter');
    await grid.getByRole('gridcell', { name: 'B5', exact: true }).click();
    await formulaBar.fill('3');
    await formulaBar.press('Enter');
    await grid.getByRole('gridcell', { name: 'C5', exact: true }).click();
    await formulaBar.fill('4');
    await formulaBar.press('Enter');
    await grid.getByRole('gridcell', { name: 'A6', exact: true }).click();
    await formulaBar.fill('=A5+B5');
    await formulaBar.press('Enter');

    // Copy A1:B2 via context menu to D1.
    const a1 = grid.getByRole('gridcell', { name: 'A1', exact: true });
    await a1.click();
    await page.mouse.down();
    await grid.getByRole('gridcell', { name: 'B2', exact: true }).hover();
    await page.mouse.up();
    await grid.getByRole('gridcell', { name: 'A1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await grid.getByRole('gridcell', { name: 'D1', exact: true }).click();
    await page.getByRole('gridcell', { name: 'D1', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();

    await expect(grid.getByRole('gridcell', { name: 'D1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'D2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'E2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('Region');

    // Copy formula A6 to B6 via keyboard and verify adjusted formula.
    await grid.getByRole('gridcell', { name: 'A6', exact: true }).click();
    await page.keyboard.press('Control+C');
    await grid.getByRole('gridcell', { name: 'B6', exact: true }).click();
    await page.keyboard.press('Control+V');
    await expect(grid.getByRole('gridcell', { name: 'B6', exact: true })).toHaveText('7');
    await expect(page.getByLabel('Formula bar')).toHaveValue('=B5+C5');

    // Cut A1:B2 to D1:E2 using keyboard.
    await grid.getByRole('gridcell', { name: 'A1', exact: true }).click();
    await page.mouse.down();
    await grid.getByRole('gridcell', { name: 'B2', exact: true }).hover();
    await page.mouse.up();
    await page.keyboard.press('Control+X');
    await grid.getByRole('gridcell', { name: 'D1', exact: true }).click();
    await page.keyboard.press('Control+V');

    await expect(grid.getByRole('gridcell', { name: 'D1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'D2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'E2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('');
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('');

    await page.reload();
    await expect(grid.getByRole('gridcell', { name: 'D1', exact: true })).toHaveText('Region');
    await expect(grid.getByRole('gridcell', { name: 'D2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'E2', exact: true })).toHaveText('1200');
    await expect(grid.getByRole('gridcell', { name: 'A1', exact: true })).toHaveText('');
  });

  test('REQ-3-2-2 undo and redo cell edits, paste, and row changes; new edit clears redo', async ({ page }) => {
    await openQ3Sales(page);

    const grid = page.getByRole('grid', { name: 'Worksheet grid' });
    const formulaBar = page.getByLabel('Formula bar');
    const d1 = grid.getByRole('gridcell', { name: 'D1', exact: true });

    // Ensure D1 is blank before this test.
    await d1.click();
    await formulaBar.fill('');
    await formulaBar.press('Enter');

    // Cell edit -> undo/redo.
    await d1.click();
    await formulaBar.fill('Temp');
    await formulaBar.press('Enter');
    await expect(d1).toHaveText('Temp');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(d1).toHaveText('');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(d1).toHaveText('Temp');

    // New modification after undo clears redo.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(d1).toHaveText('');
    await d1.click();
    await formulaBar.fill('Final');
    await formulaBar.press('Enter');
    await expect(d1).toHaveText('Final');
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();

    // Undo should remove Final.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(d1).toHaveText('');

    // Restore row 2 data for a deterministic row-insert undo check.
    await grid.getByRole('gridcell', { name: 'A2', exact: true }).click();
    await formulaBar.fill('East');
    await formulaBar.press('Enter');
    await grid.getByRole('gridcell', { name: 'B2', exact: true }).click();
    await formulaBar.fill('1200');
    await formulaBar.press('Enter');

    // Row insert undo restores original rows.
    await page.getByRole('rowheader', { name: '2', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 row above', exact: true }).click();
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(grid.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('East');
    await expect(grid.getByRole('gridcell', { name: 'B2', exact: true })).toHaveText('1200');
  });
});
