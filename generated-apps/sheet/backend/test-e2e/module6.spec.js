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

async function openDataValidation(page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Data validation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Data validation', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setDropdownRule(page, allowedValues) {
  const dialog = await openDataValidation(page);
  const ruleType = dialog.getByRole('combobox', { name: 'Rule type', exact: true });
  await expect(ruleType).toHaveValue('Dropdown');
  await ruleType.click();
  await dialog.getByRole('option', { name: 'Dropdown', exact: true }).click();
  await expect(ruleType).toHaveValue('Dropdown');
  const allowedInput = dialog.getByRole('textbox', { name: 'Allowed values', exact: true });
  await expect(allowedInput).toBeVisible();
  await allowedInput.fill(allowedValues);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function setNumberRule(page, min, max) {
  const dialog = await openDataValidation(page);
  const ruleType = dialog.getByRole('combobox', { name: 'Rule type', exact: true });
  await ruleType.click();
  await dialog.getByRole('option', { name: 'Number range', exact: true }).click();
  await expect(ruleType).toHaveValue('Number range');
  const minInput = dialog.getByRole('textbox', { name: 'Minimum', exact: true });
  const maxInput = dialog.getByRole('textbox', { name: 'Maximum', exact: true });
  await expect(minInput).toBeVisible();
  await expect(maxInput).toBeVisible();
  await minInput.fill(String(min));
  await maxInput.fill(String(max));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function enterViaFormulaBar(page, name, value) {
  const cell = await gridCell(page, name);
  await cell.click();
  const formulaBar = page.getByLabel('Formula bar');
  await formulaBar.fill(value);
  await formulaBar.press('Enter');
}

test.describe('REQ-5-2 Data Validation', () => {
  test('set dropdown validation, enforce through formula bar, persist, reopen/delete', async ({ page }) => {
    await openQ3Sales(page);
    await selectRange(page, 'A2', 'A3');
    await setDropdownRule(page, ' East , North , South ');

    // Dropdown buttons use the exact accessible name and trimmed option names.
    const openA2 = page.getByRole('button', { name: 'Open dropdown for A2', exact: true });
    const openA3 = page.getByRole('button', { name: 'Open dropdown for A3', exact: true });
    await expect(openA2).toBeVisible();
    await expect(openA3).toBeVisible();

    await openA2.click();
    const listbox = page.getByRole('listbox', { name: 'Options for A2', exact: true });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'East', exact: true })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'North', exact: true })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'South', exact: true })).toBeVisible();
    await listbox.getByRole('option', { name: 'South', exact: true }).click();
    await expect(await gridCell(page, 'A2')).toHaveText('South');

    // Invalid through formula bar is rejected and the original value remains.
    await enterViaFormulaBar(page, 'A2', 'Invalid');
    await expect(page.getByText('Please select one of the following values: East, North, South')).toBeVisible();
    await expect(await gridCell(page, 'A2')).toHaveText('South');

    // Rules persist after refresh.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open dropdown for A2', exact: true })).toBeVisible();
    await expect(await gridCell(page, 'A2')).toHaveText('South');

    // Reopening an existing rule is prefilled and Delete rule removes it.
    await selectRange(page, 'A2', 'A3');
    const dialog = await openDataValidation(page);
    const reopenedAllowed = dialog.getByRole('textbox', { name: 'Allowed values', exact: true });
    await expect(reopenedAllowed).toHaveValue('East, North, South');
    await expect(dialog.getByLabel('Allowed values')).toHaveValue('East, North, South');
    await dialog.getByRole('button', { name: 'Delete rule', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open dropdown for A2', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open dropdown for A3', exact: true })).toHaveCount(0);
  });

  test('number range validation enforces inclusive boundaries, nonnumeric and atomic bulk paste', async ({ page }) => {
    await openQ3Sales(page);
    // Put a known value in B3 before applying the rule.
    await enterViaFormulaBar(page, 'B3', '800');
    await selectRange(page, 'B3', 'B3');
    await setNumberRule(page, 0, 100);

    // Invalid values are rejected, valid boundary values are accepted.
    await enterViaFormulaBar(page, 'B3', '101');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('800');

    await enterViaFormulaBar(page, 'B3', '-1');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('800');

    await enterViaFormulaBar(page, 'B3', '0');
    await expect(await gridCell(page, 'B3')).toHaveText('0');
    await enterViaFormulaBar(page, 'B3', '100');
    await expect(await gridCell(page, 'B3')).toHaveText('100');
    await enterViaFormulaBar(page, 'B3', 'abc');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('100');

    // A formula prefix cannot bypass validation: the evaluated value is rejected.
    await enterViaFormulaBar(page, 'B3', '=100+1');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('100');

    // Range move (cut/paste) into a validated cell is also rejected atomically.
    await enterViaFormulaBar(page, 'D2', 'Hello');
    await (await gridCell(page, 'D2')).click();
    await page.keyboard.press('Control+X');
    await (await gridCell(page, 'B3')).click();
    await page.keyboard.press('Control+V');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'D2')).toHaveText('Hello');
    await expect(await gridCell(page, 'B3')).toHaveText('100');

    // Bulk paste with one invalid target is rejected atomically.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('101\t999'));
    await (await gridCell(page, 'B3')).click();
    await page.keyboard.press('Control+V');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('100');
    await expect(await gridCell(page, 'C3')).toHaveText('Closed');

    // The rule persists and still rejects after reload.
    await page.reload();
    await enterViaFormulaBar(page, 'B3', '101');
    await expect(page.getByText('Please enter a number from 0 to 100')).toBeVisible();
    await expect(await gridCell(page, 'B3')).toHaveText('100');

    // Cleanup.
    await selectRange(page, 'B3', 'B3');
    const dialog = await openDataValidation(page);
    await dialog.getByRole('button', { name: 'Delete rule', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('row and column changes move validation constraints with the original cells', async ({ page }) => {
    await openQ3Sales(page);
    await selectRange(page, 'A3', 'A3');
    await setDropdownRule(page, 'East, North, South');

    await expect(page.getByRole('button', { name: 'Open dropdown for A3', exact: true })).toBeVisible();

    // Insert a row above row 2: the constrained A3 cell moves to A4.
    await page.getByRole('rowheader', { name: '2', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 row above', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open dropdown for A4', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open dropdown for A3', exact: true })).toHaveCount(0);

    // Delete the inserted blank row 2: A4 moves back to A3.
    await page.getByRole('rowheader', { name: '2', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete row', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open dropdown for A3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open dropdown for A4', exact: true })).toHaveCount(0);

    // Column equivalent: constrain B3, insert column left of B -> C3, delete B -> B3.
    await selectRange(page, 'B3', 'B3');
    const dialog = await openDataValidation(page);
    const ruleType = dialog.getByRole('combobox', { name: 'Rule type', exact: true });
    await ruleType.press('ArrowDown');
    await ruleType.press('Enter');
    await expect(ruleType).toHaveValue('Dropdown');
    const allowedInput = dialog.getByRole('textbox', { name: 'Allowed values', exact: true });
    await allowedInput.fill('East, North, South');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open dropdown for B3', exact: true })).toBeVisible();

    await page.getByRole('columnheader', { name: 'B', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 column left', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open dropdown for C3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open dropdown for B3', exact: true })).toHaveCount(0);

    await page.getByRole('columnheader', { name: 'B', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete column', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open dropdown for B3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open dropdown for C3', exact: true })).toHaveCount(0);

    // Cleanup.
    await selectRange(page, 'B3', 'B3');
    const cleanupDialog = await openDataValidation(page);
    await cleanupDialog.getByRole('button', { name: 'Delete rule', exact: true }).click();
    await expect(cleanupDialog).toHaveCount(0);
  });
});
