const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

function gridCell(page, name) {
  return page.getByRole('grid', { name: 'Worksheet grid' }).getByRole('gridcell', { name, exact: true });
}

async function openWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function selectRange(page, start, end) {
  await gridCell(page, start).click();
  await gridCell(page, end).click({ modifiers: ['Shift'] });
}

async function openDataMenu(page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click();
}

async function enterViaFormulaBar(page, coordinate, value) {
  await gridCell(page, coordinate).click();
  const formulaBar = page.getByLabel('Formula bar');
  await formulaBar.fill(value);
  await formulaBar.press('Enter');
}

test('REQ-5-1-2 rejects a trimmed empty filter view name and keeps the save interface open', async ({ page }) => {
  await openWorkbook(page, 'EVO-M04-FILTER-DELETE');
  await selectRange(page, 'D3', 'F7');
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Create filter', exact: true }).click();

  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Save filter view', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save filter view', exact: true });
  await saveDialog.getByRole('textbox', { name: 'Filter view name', exact: true }).fill('   ');
  await saveDialog.getByRole('button', { name: 'Save view', exact: true }).click();

  // The requirement specifies trimmed nonempty names but not the exact message.
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog.getByRole('textbox', { name: 'Filter view name', exact: true })).toHaveValue('   ');
  await saveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
  const viewsDialog = page.getByRole('dialog', { name: 'Filter views', exact: true });
  await expect(viewsDialog.getByRole('button', { name: 'Queued lanes', exact: true })).toHaveCount(1);
  await expect(viewsDialog.getByRole('button', { name: '   ', exact: true })).toHaveCount(0);
  await viewsDialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.reload();
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
  const reloaded = page.getByRole('dialog', { name: 'Filter views', exact: true });
  await expect(reloaded.getByRole('button', { name: 'Queued lanes', exact: true })).toHaveCount(1);
  await expect(reloaded.getByRole('button', { name: '   ', exact: true })).toHaveCount(0);
});

test('REQ-5-2-1 applies a custom message to range-move and bulk-paste rejections atomically', async ({ page }) => {
  const message = 'Capacity must be from 25 to 75';
  await openWorkbook(page, 'EVO-M05-VALIDATION-FORMULA');

  await enterViaFormulaBar(page, 'J7', '88');
  await expect(gridCell(page, 'J7')).toHaveText('88');

  // Range move (cut/paste) into the validated cell is rejected with the custom message.
  await gridCell(page, 'J7').click();
  await page.keyboard.press('Control+X');
  await gridCell(page, 'J6').click();
  await page.keyboard.press('Control+V');
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(gridCell(page, 'J7')).toHaveText('88');
  await expect(gridCell(page, 'J6')).toHaveText('37');

  // External bulk paste with any invalid target is rejected atomically with the custom message.
  await page.reload();
  await enterViaFormulaBar(page, 'J7', '77');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('88\n99'));
  await gridCell(page, 'J6').click();
  await page.keyboard.press('Control+V');
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(gridCell(page, 'J6')).toHaveText('37');
  await expect(gridCell(page, 'J7')).toHaveText('77');

  await page.reload();
  await expect(gridCell(page, 'J6')).toHaveText('37');
  await expect(gridCell(page, 'J7')).toHaveText('77');
});

test('REQ-5-2-1 uses a trimmed custom dropdown message through the formula bar', async ({ page }) => {
  await openWorkbook(page, 'EVO-M05-VALIDATION-GRID');
  await gridCell(page, 'K8').click();
  await expect(page.getByLabel('Formula bar')).toHaveValue('Ready');

  await page.getByLabel('Formula bar').fill('Paused');
  await page.getByLabel('Formula bar').press('Enter');

  await expect(page.getByText('Choose a queue state', { exact: true })).toBeVisible();
  await expect(gridCell(page, 'K8')).toHaveText('Ready');
});

test('REQ-5-2-1 trims a custom error message when saving and reopening', async ({ page }) => {
  await openWorkbook(page, 'EVO-M05-VALIDATION-EDIT');
  await gridCell(page, 'L4').click();
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Data validation', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Data validation', exact: true });
  const errorInput = dialog.getByRole('textbox', { name: 'Error message', exact: true });
  await errorInput.fill('  Allocate between 25 and 75  ');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel('Formula bar').fill('24');
  await page.getByLabel('Formula bar').press('Enter');
  await expect(page.getByText('Allocate between 25 and 75', { exact: true })).toBeVisible();
  await expect(gridCell(page, 'L4')).toHaveText('42');

  await page.reload();
  await gridCell(page, 'L4').click();
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Data validation', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Data validation', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Error message', exact: true })).toHaveValue(
    'Allocate between 25 and 75',
  );
});

test('REQ-7-1-1 rejects a name that does not start with a letter without persisting it', async ({ page }) => {
  await openWorkbook(page, 'EVO-N03-NAMED-INVALID');
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Named ranges', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Named ranges', exact: true });
  await dialog.getByRole('button', { name: 'Add named range', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('$batch');
  await dialog.getByLabel('Range', { exact: true }).fill('ForecastModel!K2:K3');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByText('Named range must start with a letter', { exact: true })).toBeVisible();
  await page.reload();
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Named ranges', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Named ranges', exact: true });
  await expect(reopened.getByText('$batch', { exact: true })).toHaveCount(0);
});

test('REQ-7-2-1 rejects a conditional formatting rule with no value without changing saved rules', async ({ page }) => {
  await openWorkbook(page, 'EVO-N04-FORMAT-NUMBER');
  await selectRange(page, 'J4', 'J6');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Conditional formatting', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conditional formatting', exact: true });
  await dialog.getByLabel('Condition', { exact: true }).selectOption('greater_than');
  await dialog.getByLabel('Value', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByText('Value is required', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Edit rule \d+$/ })).toHaveCount(0);
});
