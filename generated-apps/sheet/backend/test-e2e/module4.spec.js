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

async function setCellAndExpect(page, name, value, expected) {
  const cell = await gridCell(page, name);
  await cell.click();
  const formulaBar = page.getByLabel('Formula bar');
  await formulaBar.fill(value);
  await formulaBar.press('Enter');
  await expect(cell).toHaveText(expected);
}

async function createWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New blank workbook', exact: true }).click();
  await page.getByLabel('Workbook name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test.describe('REQ-4 Formula Calculation', () => {
  test('REQ-4-1-1 basic expressions and aggregate functions display results and persist', async ({ page }) => {
    await openQ3Sales(page);

    await setCellAndExpect(page, 'A8', '2', '2');
    await setCellAndExpect(page, 'B8', '3', '3');
    await setCellAndExpect(page, 'C8', '=A8+B8', '5');
    await setCellAndExpect(page, 'D8', '=C8*2', '10');
    await setCellAndExpect(page, 'E8', '=sum(a8:b8)', '5');
    await setCellAndExpect(page, 'F8', '=AVERAGE(A8:B8)', '2.5');
    await setCellAndExpect(page, 'G8', '=COUNT(A8:B8)', '2');
    await setCellAndExpect(page, 'H8', '=MIN(A8:B8)', '2');
    await setCellAndExpect(page, 'I8', '=MAX(A8:B8)', '3');

    // Also enter a formula through the inline grid editor (not only the formula bar).
    const j8 = await gridCell(page, 'J8');
    await j8.dblclick();
    const editJ8 = page.getByRole('textbox', { name: 'Edit J8', exact: true });
    await expect(editJ8).toBeVisible();
    await editJ8.fill('=A8+B8');
    await editJ8.press('Enter');
    await expect(j8).toHaveText('5');
    await j8.click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A8+B8');

    await (await gridCell(page, 'C8')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A8+B8');
    await (await gridCell(page, 'E8')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=sum(a8:b8)');

    // Aggregates ignore empty cells and nonnumeric text; COUNT counts only numbers.
    await setCellAndExpect(page, 'A9', '2', '2');
    await setCellAndExpect(page, 'B9', '3', '3');
    await setCellAndExpect(page, 'C9', '', '');
    await setCellAndExpect(page, 'D9', 'text', 'text');
    await setCellAndExpect(page, 'E9', '=SUM(A9:D9)', '5');
    await setCellAndExpect(page, 'F9', '=AVERAGE(A9:D9)', '2.5');
    await setCellAndExpect(page, 'G9', '=COUNT(A9:D9)', '2');
    await setCellAndExpect(page, 'H9', '=MIN(A9:D9)', '2');
    await setCellAndExpect(page, 'I9', '=MAX(A9:D9)', '3');

    await page.reload();
    await expect(await gridCell(page, 'A8')).toHaveText('2');
    await expect(await gridCell(page, 'B8')).toHaveText('3');
    await expect(await gridCell(page, 'C8')).toHaveText('5');
    await expect(await gridCell(page, 'D8')).toHaveText('10');
    await expect(await gridCell(page, 'E8')).toHaveText('5');
    await expect(await gridCell(page, 'F8')).toHaveText('2.5');
    await expect(await gridCell(page, 'G8')).toHaveText('2');
    await expect(await gridCell(page, 'H8')).toHaveText('2');
    await expect(await gridCell(page, 'I8')).toHaveText('3');
    await expect(await gridCell(page, 'J8')).toHaveText('5');
    await expect(await gridCell(page, 'E9')).toHaveText('5');
    await expect(await gridCell(page, 'F9')).toHaveText('2.5');
    await expect(await gridCell(page, 'G9')).toHaveText('2');
    await expect(await gridCell(page, 'H9')).toHaveText('2');
    await expect(await gridCell(page, 'I9')).toHaveText('3');
  });

  test('REQ-4-1-2 copying formulas adjusts relative references, preserves absolute references, and produces #REF! outside bounds', async ({ page }) => {
    await openQ3Sales(page);

    await setCellAndExpect(page, 'A10', '2', '2');
    await setCellAndExpect(page, 'B10', '3', '3');
    await setCellAndExpect(page, 'C10', '4', '4');
    await setCellAndExpect(page, 'D10', '=A10+B10', '5');
    await setCellAndExpect(page, 'E10', '=$A10+B10', '5');

    // Copy D10 (relative) to F10: =C10+D10 => 4+5=9.
    await (await gridCell(page, 'D10')).click();
    await page.keyboard.press('Control+C');
    await (await gridCell(page, 'F10')).click();
    await page.keyboard.press('Control+V');
    await expect(await gridCell(page, 'F10')).toHaveText('9');
    await (await gridCell(page, 'F10')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=C10+D10');

    // Copy E10 (absolute column) to G10 through context menu: =$A10+D10 => 2+5=7.
    await (await gridCell(page, 'E10')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await (await gridCell(page, 'G10')).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
    await expect(await gridCell(page, 'G10')).toHaveText('7');
    await (await gridCell(page, 'G10')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=$A10+D10');

    // Source formulas and results remain unchanged.
    await (await gridCell(page, 'D10')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A10+B10');
    await expect(await gridCell(page, 'D10')).toHaveText('5');

    // Out-of-bounds copy: H10 =A10+B10 copied to G10 must become =#REF!.
    await setCellAndExpect(page, 'H10', '=A10+B10', '5');
    await (await gridCell(page, 'H10')).click();
    await page.keyboard.press('Control+C');
    await (await gridCell(page, 'G10')).click();
    await page.keyboard.press('Control+V');
    await expect(await gridCell(page, 'G10')).toHaveText('#REF!');
    await (await gridCell(page, 'G10')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=#REF!');
    await expect(await gridCell(page, 'H10')).toHaveText('5');

    await page.reload();
    await expect(await gridCell(page, 'F10')).toHaveText('9');
    await expect(await gridCell(page, 'G10')).toHaveText('#REF!');
    await (await gridCell(page, 'G10')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=#REF!');
    await expect(await gridCell(page, 'H10')).toHaveText('5');
  });

  test('REQ-4-2-1 dependent formulas recalculate after source edits and bulk paste', async ({ page }) => {
    await openQ3Sales(page);

    await setCellAndExpect(page, 'A6', '2', '2');
    await setCellAndExpect(page, 'B6', '3', '3');
    await setCellAndExpect(page, 'C6', '=A6+B6', '5');
    await setCellAndExpect(page, 'D6', '=C6*2', '10');

    await (await gridCell(page, 'A6')).click();
    await page.getByLabel('Formula bar').fill('5');
    await page.getByLabel('Formula bar').press('Enter');
    await expect(await gridCell(page, 'A6')).toHaveText('5');
    await expect(await gridCell(page, 'C6')).toHaveText('8');
    await expect(await gridCell(page, 'D6')).toHaveText('16');
    await (await gridCell(page, 'C6')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A6+B6');
    await (await gridCell(page, 'D6')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=C6*2');

    // Bulk paste into source cells recalculates dependent formula.
    await setCellAndExpect(page, 'E6', '1', '1');
    await setCellAndExpect(page, 'F6', '2', '2');
    await setCellAndExpect(page, 'G6', '=E6+F6', '3');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('10\t20'));
    await (await gridCell(page, 'E6')).click();
    await page.keyboard.press('Control+V');
    await expect(await gridCell(page, 'E6')).toHaveText('10');
    await expect(await gridCell(page, 'F6')).toHaveText('20');
    await expect(await gridCell(page, 'G6')).toHaveText('30');

    // Range move: cut a formula cell and paste it elsewhere; references are not adjusted.
    await setCellAndExpect(page, 'A7', '2', '2');
    await setCellAndExpect(page, 'B7', '3', '3');
    await setCellAndExpect(page, 'C7', '=A7+B7', '5');
    await (await gridCell(page, 'C7')).click();
    await page.keyboard.press('Control+X');
    await (await gridCell(page, 'D7')).click();
    await page.keyboard.press('Control+V');
    await expect(await gridCell(page, 'D7')).toHaveText('5');
    await expect(await gridCell(page, 'C7')).toHaveText('');
    await (await gridCell(page, 'D7')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A7+B7');

    await page.reload();
    await expect(await gridCell(page, 'A6')).toHaveText('5');
    await expect(await gridCell(page, 'C6')).toHaveText('8');
    await expect(await gridCell(page, 'D6')).toHaveText('16');
    await expect(await gridCell(page, 'G6')).toHaveText('30');
    await expect(await gridCell(page, 'A7')).toHaveText('2');
    await expect(await gridCell(page, 'B7')).toHaveText('3');
    await expect(await gridCell(page, 'C7')).toHaveText('');
    await expect(await gridCell(page, 'D7')).toHaveText('5');
  });

  test('REQ-4-2-1 row and column structure changes adjust formulas and recalculate', async ({ page }) => {
    await createWorkbook(page, 'Formula Structure Workbook');

    await setCellAndExpect(page, 'A5', '2', '2');
    await setCellAndExpect(page, 'B5', '3', '3');
    await setCellAndExpect(page, 'C5', '=A5+B5', '5');

    // Insert a row above row 5: values/formula move down and references adjust.
    await page.getByRole('rowheader', { name: '5', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 row above', exact: true }).click();
    await expect(await gridCell(page, 'A5')).toHaveText('');
    await expect(await gridCell(page, 'A6')).toHaveText('2');
    await expect(await gridCell(page, 'B6')).toHaveText('3');
    await expect(await gridCell(page, 'C6')).toHaveText('5');
    await (await gridCell(page, 'C6')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A6+B6');

    await page.reload();
    await expect(await gridCell(page, 'A6')).toHaveText('2');
    await expect(await gridCell(page, 'C6')).toHaveText('5');
    await (await gridCell(page, 'C6')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A6+B6');

    // Delete the inserted blank row 5, restoring row positions and formula references.
    await page.getByRole('rowheader', { name: '5', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete row', exact: true }).click();
    await expect(await gridCell(page, 'A5')).toHaveText('2');
    await expect(await gridCell(page, 'B5')).toHaveText('3');
    await expect(await gridCell(page, 'C5')).toHaveText('5');
    await (await gridCell(page, 'C5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+B5');

    // Prepare a column-dependent formula and insert a column left of C.
    await setCellAndExpect(page, 'D5', '4', '4');
    await setCellAndExpect(page, 'E5', '=A5+D5', '6');
    await page.getByRole('columnheader', { name: 'C', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert 1 column left', exact: true }).click();
    await expect(await gridCell(page, 'C5')).toHaveText('');
    await expect(await gridCell(page, 'D5')).toHaveText('5');
    await expect(await gridCell(page, 'E5')).toHaveText('4');
    await expect(await gridCell(page, 'F5')).toHaveText('6');
    await (await gridCell(page, 'D5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+B5');
    await (await gridCell(page, 'F5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+E5');

    await page.reload();
    await expect(await gridCell(page, 'D5')).toHaveText('5');
    await expect(await gridCell(page, 'F5')).toHaveText('6');
    await (await gridCell(page, 'F5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+E5');

    // Delete the inserted blank column C, restoring positions and references.
    await page.getByRole('columnheader', { name: 'C', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete column', exact: true }).click();
    await expect(await gridCell(page, 'C5')).toHaveText('5');
    await expect(await gridCell(page, 'D5')).toHaveText('4');
    await expect(await gridCell(page, 'E5')).toHaveText('6');
    await (await gridCell(page, 'C5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+B5');
    await (await gridCell(page, 'E5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+D5');
  });

  test('REQ-4-2-2 stable error values, error isolation, and fixing an error updates dependents', async ({ page }) => {
    await createWorkbook(page, 'Formula Errors Workbook');

    await setCellAndExpect(page, 'A5', '1', '1');
    await setCellAndExpect(page, 'B5', '0', '0');
    await setCellAndExpect(page, 'C5', '=A5/B5', '#DIV/0!');
    await setCellAndExpect(page, 'D5', '=C5*2', '#DIV/0!');
    await setCellAndExpect(page, 'E5', '=UNKNOWN(A5)', '#NAME?');
    await setCellAndExpect(page, 'F5', '=A5+', '#ERROR!');
    await setCellAndExpect(page, 'G5', '=Z99', '#REF!');
    await setCellAndExpect(page, 'I5', '1', '1');
    await setCellAndExpect(page, 'H5', '=I5', '1');
    await setCellAndExpect(page, 'I5', '=H5', '#REF!');
    await expect(await gridCell(page, 'H5')).toHaveText('#REF!');
    await setCellAndExpect(page, 'J5', '=2+3', '5');

    await (await gridCell(page, 'C5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5/B5');
    await (await gridCell(page, 'D5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=C5*2');
    await (await gridCell(page, 'E5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=UNKNOWN(A5)');
    await (await gridCell(page, 'F5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+');
    await (await gridCell(page, 'G5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=Z99');
    await (await gridCell(page, 'H5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=I5');
    await (await gridCell(page, 'I5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=H5');

    // An unrelated formula is unaffected by the errors above.
    await expect(await gridCell(page, 'J5')).toHaveText('5');

    // Fix C5; its dependent D5 recalculates.
    await (await gridCell(page, 'C5')).click();
    await page.getByLabel('Formula bar').fill('=A5+B5');
    await page.getByLabel('Formula bar').press('Enter');
    await expect(await gridCell(page, 'C5')).toHaveText('1');
    await expect(await gridCell(page, 'D5')).toHaveText('2');
    await (await gridCell(page, 'C5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=A5+B5');
    await (await gridCell(page, 'D5')).click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('=C5*2');

    await page.reload();
    await expect(await gridCell(page, 'C5')).toHaveText('1');
    await expect(await gridCell(page, 'D5')).toHaveText('2');
    await expect(await gridCell(page, 'E5')).toHaveText('#NAME?');
    await expect(await gridCell(page, 'F5')).toHaveText('#ERROR!');
    await expect(await gridCell(page, 'G5')).toHaveText('#REF!');
    await expect(await gridCell(page, 'H5')).toHaveText('#REF!');
    await expect(await gridCell(page, 'I5')).toHaveText('#REF!');
    await expect(await gridCell(page, 'J5')).toHaveText('5');
  });
});
