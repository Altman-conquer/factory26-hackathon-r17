const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

function gridCell(page, name) {
  return page.getByRole('grid', { name: 'Worksheet grid' }).getByRole('gridcell', { name, exact: true });
}

function frozenButton(page, rows, columns) {
  return page.getByRole('button', { name: `Frozen rows: ${rows}; columns: ${columns}`, exact: true });
}

async function openWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible();
}

async function selectRange(page, start, end) {
  await gridCell(page, start).click();
  await gridCell(page, end).click({ modifiers: ['Shift'] });
}

async function openFindReplace(page) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Find and replace', exact: true }).click();
  return page.getByRole('dialog', { name: 'Find and replace', exact: true });
}

async function openNamedRanges(page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Named ranges', exact: true }).click();
  return page.getByRole('dialog', { name: 'Named ranges', exact: true });
}

async function openConditionalFormatting(page) {
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Conditional formatting', exact: true }).click();
  return page.getByRole('dialog', { name: 'Conditional formatting', exact: true });
}

test.describe('REQ-6-1-1 freeze panes', () => {
  test('freezes rows through the selected row and persists after refresh', async ({ page }) => {
    await openWorkbook(page, 'EVO-N01-FREEZE-ROW');
    await gridCell(page, 'B1').click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Freeze rows through 1', exact: true }).click();
    await expect(frozenButton(page, 1, 0)).toBeVisible();
    await page.reload();
    await expect(frozenButton(page, 1, 0)).toBeVisible();
    await expect(gridCell(page, 'A40')).toHaveText('Closing');
  });

  test('freezes columns through the selected column and persists after refresh', async ({ page }) => {
    await openWorkbook(page, 'EVO-N01-FREEZE-COLUMN');
    await gridCell(page, 'A8').click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Freeze columns through A', exact: true }).click();
    await expect(frozenButton(page, 0, 1)).toBeVisible();
    await page.reload();
    await expect(frozenButton(page, 0, 1)).toBeVisible();
    await expect(gridCell(page, 'L40')).toHaveText('Tail');
  });

  test('freezes panes at the selected cell, derives counts, and persists after refresh', async ({ page }) => {
    await openWorkbook(page, 'EVO-N01-FREEZE-BOTH');
    await gridCell(page, 'C4').click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Freeze panes at C4', exact: true }).click();
    await expect(frozenButton(page, 3, 2)).toBeVisible();

    // A variation below the first row/column must derive counts from the coordinate rule.
    await gridCell(page, 'D5').click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Freeze panes at D5', exact: true }).click();
    await expect(frozenButton(page, 4, 3)).toBeVisible();

    await page.reload();
    await expect(frozenButton(page, 4, 3)).toBeVisible();
    await expect(gridCell(page, 'C4')).toHaveText('Locked anchor');
  });
});

test.describe('REQ-6-2-1 find and replace', () => {
  test('find next selects the next matching cell and reports the match position', async ({ page }) => {
    await openWorkbook(page, 'EVO-N02-FIND-NEXT');
    await gridCell(page, 'A1').click();
    const dialog = await openFindReplace(page);
    await dialog.getByLabel('Find', { exact: true }).fill('Cobalt');
    await dialog.getByRole('button', { name: 'Find next', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Match 1 of 3');
    await expect(gridCell(page, 'E4')).toHaveAttribute('aria-selected', 'true');
    await dialog.getByRole('button', { name: 'Find next', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Match 2 of 3');
    await expect(gridCell(page, 'E7')).toHaveAttribute('aria-selected', 'true');
  });

  test('replace all replaces whole-value case-insensitive matches and persists', async ({ page }) => {
    await openWorkbook(page, 'EVO-N02-REPLACE-ALL');
    await gridCell(page, 'A1').click();
    const dialog = await openFindReplace(page);
    await dialog.getByLabel('Find', { exact: true }).fill('cobalt');
    await dialog.getByRole('button', { name: 'Find next', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Match 1 of 3');
    await expect(gridCell(page, 'F3')).toHaveAttribute('aria-selected', 'true');

    await dialog.getByLabel('Find', { exact: true }).fill('Cobalt');
    await dialog.getByLabel('Replace with', { exact: true }).fill('Indigo');
    await dialog.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Replaced 3 cells');
    await expect(gridCell(page, 'F3')).toHaveText('Indigo');
    await expect(gridCell(page, 'F6')).toHaveText('Indigo');
    await expect(gridCell(page, 'F9')).toHaveText('Indigo');
    await expect(gridCell(page, 'F12')).toHaveText('Copper');

    await page.reload();
    await expect(gridCell(page, 'F3')).toHaveText('Indigo');
    await expect(gridCell(page, 'F6')).toHaveText('Indigo');
    await expect(gridCell(page, 'F9')).toHaveText('Indigo');
    await expect(gridCell(page, 'F12')).toHaveText('Copper');
  });

  test('match case replaces only exact-case full values and reports zero matches', async ({ page }) => {
    await openWorkbook(page, 'EVO-N02-CASE-SENSITIVE');
    await gridCell(page, 'A1').click();
    const dialog = await openFindReplace(page);
    await dialog.getByLabel('Find', { exact: true }).fill('Cobalt');
    await dialog.getByLabel('Replace with', { exact: true }).fill('Azure');
    await dialog.getByLabel('Match case', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Replaced 1 cells');
    await expect(gridCell(page, 'G3')).toHaveText('Azure');
    await expect(gridCell(page, 'G4')).toHaveText('cobalt');
    await expect(gridCell(page, 'G5')).toHaveText('Cobalt-7');

    await dialog.getByLabel('Find', { exact: true }).fill('Cobalt');
    await dialog.getByRole('button', { name: 'Replace all', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Replaced 0 cells');

    await page.reload();
    await expect(gridCell(page, 'G3')).toHaveText('Azure');
    await expect(gridCell(page, 'G4')).toHaveText('cobalt');
    await expect(gridCell(page, 'G5')).toHaveText('Cobalt-7');
  });
});

test.describe('REQ-7-1-1 named ranges', () => {
  test('creates a named range, uses it in a formula, and persists it', async ({ page }) => {
    await openWorkbook(page, 'EVO-N03-NAMED-CREATE');
    let dialog = await openNamedRanges(page);
    await dialog.getByRole('button', { name: 'Add named range', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('CapacityPlan');
    await dialog.getByLabel('Range', { exact: true }).fill('ForecastModel!J3:J5');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await gridCell(page, 'L3').click();
    const formulaBar = page.getByLabel('Formula bar');
    await formulaBar.fill('=SUM(CapacityPlan)');
    await formulaBar.press('Enter');
    await expect(gridCell(page, 'L3')).toHaveText('73');

    dialog = await openNamedRanges(page);
    await expect(dialog.getByText('CapacityPlan', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit CapacityPlan', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.reload();
    await gridCell(page, 'L3').click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=SUM(CapacityPlan)');
    await expect(gridCell(page, 'L3')).toHaveText('73');

    dialog = await openNamedRanges(page);
    await expect(dialog.getByRole('button', { name: 'Edit CapacityPlan', exact: true })).toBeVisible();
  });

  test('rejects an invalid named range name and does not persist it', async ({ page }) => {
    await openWorkbook(page, 'EVO-N03-NAMED-INVALID');
    const dialog = await openNamedRanges(page);
    await dialog.getByRole('button', { name: 'Add named range', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('1stBatch');
    await dialog.getByLabel('Range', { exact: true }).fill('ForecastModel!K2:K3');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Named range must start with a letter', { exact: true })).toBeVisible();

    await page.reload();
    const reopened = await openNamedRanges(page);
    await expect(reopened.getByText('1stBatch', { exact: true })).toHaveCount(0);
    await expect(gridCell(page, 'K2')).toHaveText('6');
    await expect(gridCell(page, 'K3')).toHaveText('14');
  });

  test('accepts another valid name beginning with a letter and evaluates it', async ({ page }) => {
    await openWorkbook(page, 'EVO-N03-NAMED-INVALID');
    const dialog = await openNamedRanges(page);
    await dialog.getByRole('button', { name: 'Add named range', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('BatchPlan');
    await dialog.getByLabel('Range', { exact: true }).fill('ForecastModel!K2:K3');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await gridCell(page, 'L2').click();
    const formulaBar = page.getByLabel('Formula bar');
    await formulaBar.fill('=SUM(BatchPlan)');
    await formulaBar.press('Enter');
    await expect(gridCell(page, 'L2')).toHaveText('20');
    await page.reload();
    await expect(gridCell(page, 'L2')).toHaveText('20');
  });

  test('updates an existing named range and recalculates dependents immediately and after refresh', async ({ page }) => {
    await openWorkbook(page, 'EVO-N03-NAMED-UPDATE');
    await expect(gridCell(page, 'M2')).toHaveText('13');
    let dialog = await openNamedRanges(page);
    await dialog.getByRole('button', { name: 'Edit MarginBase', exact: true }).click();
    await dialog.getByLabel('Range', { exact: true }).fill('ForecastModel!K2:K4');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(gridCell(page, 'M2')).toHaveText('25');

    await page.reload();
    await expect(gridCell(page, 'M2')).toHaveText('25');
    dialog = await openNamedRanges(page);
    await dialog.getByRole('button', { name: 'Edit MarginBase', exact: true }).click();
    await expect(dialog.getByLabel('Range', { exact: true })).toHaveValue('ForecastModel!K2:K4');
  });
});

test.describe('REQ-7-2-1 conditional formatting', () => {
  test('applies a red fill for numeric values greater than the threshold and persists', async ({ page }) => {
    await openWorkbook(page, 'EVO-N04-FORMAT-NUMBER');
    await selectRange(page, 'J4', 'J6');
    const dialog = await openConditionalFormatting(page);
    await dialog.getByLabel('Condition', { exact: true }).selectOption('greater_than');
    await dialog.getByLabel('Value', { exact: true }).fill('25');
    await dialog.getByLabel('Style', { exact: true }).selectOption('red');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(gridCell(page, 'J5')).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(gridCell(page, 'J6')).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(gridCell(page, 'J4')).not.toHaveCSS('background-color', 'rgb(254, 226, 226)');

    await page.reload();
    await expect(gridCell(page, 'J5')).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(gridCell(page, 'J6')).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(gridCell(page, 'J4')).not.toHaveCSS('background-color', 'rgb(254, 226, 226)');

    // A rule that matches no target cell is still listed but does not add a fill.
    await selectRange(page, 'J4', 'J6');
    const noMatchDialog = await openConditionalFormatting(page);
    await noMatchDialog.getByLabel('Condition', { exact: true }).selectOption('text_contains');
    await noMatchDialog.getByLabel('Value', { exact: true }).fill('NeverMatch');
    await noMatchDialog.getByLabel('Style', { exact: true }).selectOption('yellow');
    await noMatchDialog.getByRole('button', { name: 'Save', exact: true }).click();
    for (const coordinate of ['J4', 'J5', 'J6']) {
      await expect(gridCell(page, coordinate)).not.toHaveCSS('background-color', 'rgb(254, 249, 195)');
    }
    await expect(gridCell(page, 'J5')).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    const listedDialog = await openConditionalFormatting(page);
    await expect(listedDialog.getByRole('button', { name: 'Edit rule 2', exact: true })).toBeVisible();
  });

  test('applies a yellow fill for matching text and keeps the rule listed after refresh', async ({ page }) => {
    await openWorkbook(page, 'EVO-N04-FORMAT-TEXT');
    await selectRange(page, 'K4', 'K6');
    let dialog = await openConditionalFormatting(page);
    await dialog.getByLabel('Condition', { exact: true }).selectOption('text_contains');
    await dialog.getByLabel('Value', { exact: true }).fill('Watch');
    await dialog.getByLabel('Style', { exact: true }).selectOption('yellow');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(gridCell(page, 'K4')).toHaveCSS('background-color', 'rgb(254, 249, 195)');
    await expect(gridCell(page, 'K5')).not.toHaveCSS('background-color', 'rgb(254, 249, 195)');
    await expect(gridCell(page, 'K6')).not.toHaveCSS('background-color', 'rgb(254, 249, 195)');

    await page.reload();
    await expect(gridCell(page, 'K4')).toHaveCSS('background-color', 'rgb(254, 249, 195)');
    dialog = await openConditionalFormatting(page);
    await expect(dialog.getByRole('button', { name: 'Edit rule 1', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete rule 1', exact: true })).toBeVisible();
  });

  test('edits a rule to green, deletes it, and removes the fill persistently', async ({ page }) => {
    await openWorkbook(page, 'EVO-N04-FORMAT-EDIT');
    let dialog = await openConditionalFormatting(page);
    await dialog.getByRole('button', { name: 'Edit rule 1', exact: true }).click();
    await dialog.getByLabel('Style', { exact: true }).selectOption('green');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(gridCell(page, 'L4')).toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(gridCell(page, 'L5')).toHaveCSS('background-color', 'rgb(220, 252, 231)');

    dialog = await openConditionalFormatting(page);
    await dialog.getByRole('button', { name: 'Delete rule 1', exact: true }).click();
    await expect(gridCell(page, 'L4')).not.toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(gridCell(page, 'L5')).not.toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(gridCell(page, 'L4')).not.toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(gridCell(page, 'L5')).not.toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.reload();
    await expect(gridCell(page, 'L4')).not.toHaveCSS('background-color', 'rgb(220, 252, 231)');
    await expect(gridCell(page, 'L5')).not.toHaveCSS('background-color', 'rgb(254, 226, 226)');
    dialog = await openConditionalFormatting(page);
    await expect(dialog.getByText('No conditional formatting rules saved.', { exact: true })).toBeVisible();
  });
});
