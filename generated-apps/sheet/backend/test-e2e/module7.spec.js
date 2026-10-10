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

async function openPivotCreateDialog(page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create pivot table', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create pivot table', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setComboboxByClick(scope, label, optionLabel) {
  const combo = scope.getByRole('combobox', { name: label, exact: true });
  await combo.click();
  await scope.getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(combo).toHaveValue(optionLabel);
}

async function selectComboboxByKeyboard(scope, label, optionLabel) {
  const combo = scope.getByRole('combobox', { name: label, exact: true });
  await combo.focus();
  await combo.press('ArrowDown');
  for (let i = 0; i < 12; i += 1) {
    const option = scope.getByRole('option', { name: optionLabel, exact: true });
    const optionClass = await option.getAttribute('class');
    if (optionClass && optionClass.includes('bg-blue-50')) {
      break;
    }
    await combo.press('ArrowDown');
  }
  await combo.press('Enter');
  await expect(combo).toHaveValue(optionLabel);
}

async function enterViaFormulaBar(page, coordinate, value) {
  await (await gridCell(page, coordinate)).click();
  const formulaBar = page.getByLabel('Formula bar');
  await formulaBar.fill(value);
  await formulaBar.press('Enter');
}

test('REQ-5-3-1 create pivot with SUM no column, persists and source unchanged', async ({ page }) => {
  await openQ3Sales(page);
  await selectRange(page, 'A1', 'C4');
  const dialog = await openPivotCreateDialog(page);

  await expect(dialog.getByText('Source range: A1:C4', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'New worksheet', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pivot1', exact: true })).toHaveAttribute('aria-selected', 'true');

  await setComboboxByClick(editor, 'Rows', 'Region');
  await setComboboxByClick(editor, 'Columns', 'None');
  await setComboboxByClick(editor, 'Values', 'Sales');
  await setComboboxByClick(editor, 'Summarize by', 'SUM');
  await editor.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'B1')).toHaveText('SUM of Sales');
  await expect(await gridCell(page, 'A2')).toHaveText('East');
  await expect(await gridCell(page, 'B2')).toHaveText('1200');
  await expect(await gridCell(page, 'A3')).toHaveText('North');
  await expect(await gridCell(page, 'B3')).toHaveText('800');
  await expect(await gridCell(page, 'A4')).toHaveText('South');
  await expect(await gridCell(page, 'B4')).toHaveText('700');
  await expect(await gridCell(page, 'A5')).toHaveText('Grand Total');
  await expect(await gridCell(page, 'B5')).toHaveText('2700');

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Pivot1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'B5')).toHaveText('2700');

  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'A2')).toHaveText('East');
  await expect(await gridCell(page, 'A3')).toHaveText('North');
  await expect(await gridCell(page, 'A4')).toHaveText('South');
  await expect(await gridCell(page, 'B2')).toHaveText('1200');
  await expect(await gridCell(page, 'B4')).toHaveText('700');
});

test('REQ-5-3-1 pivot AVERAGE no column', async ({ page }) => {
  await openQ3Sales(page);
  await page.getByRole('tab', { name: 'Pivot1', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  await setComboboxByClick(editor, 'Rows', 'Region');
  await setComboboxByClick(editor, 'Columns', 'None');
  await setComboboxByClick(editor, 'Values', 'Sales');
  await setComboboxByClick(editor, 'Summarize by', 'AVERAGE');
  await editor.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'B1')).toHaveText('AVERAGE of Sales');
  await expect(await gridCell(page, 'A2')).toHaveText('East');
  await expect(await gridCell(page, 'B2')).toHaveText('1200');
  await expect(await gridCell(page, 'A3')).toHaveText('North');
  await expect(await gridCell(page, 'B3')).toHaveText('800');
  await expect(await gridCell(page, 'A4')).toHaveText('South');
  await expect(await gridCell(page, 'B4')).toHaveText('700');
  await expect(await gridCell(page, 'A5')).toHaveText('Grand Total');
  await expect(await gridCell(page, 'B5')).toHaveText('900');
});

test('REQ-5-3-1 pivot editor keyboard selection and COUNT with column field', async ({ page }) => {
  await openQ3Sales(page);
  await page.getByRole('tab', { name: 'Pivot1', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  await expect(editor).toBeVisible();

  // Use keyboard for all four field controls.
  await selectComboboxByKeyboard(editor, 'Rows', 'Region');
  await selectComboboxByKeyboard(editor, 'Columns', 'Status');
  await selectComboboxByKeyboard(editor, 'Values', 'Sales');
  await selectComboboxByKeyboard(editor, 'Summarize by', 'COUNT');

  await editor.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'B1')).toHaveText('Open');
  await expect(await gridCell(page, 'C1')).toHaveText('Closed');
  await expect(await gridCell(page, 'D1')).toHaveText('Grand Total');
  await expect(await gridCell(page, 'A2')).toHaveText('East');
  await expect(await gridCell(page, 'B2')).toHaveText('1');
  await expect(await gridCell(page, 'C2')).toHaveText('0');
  await expect(await gridCell(page, 'D2')).toHaveText('1');
  await expect(await gridCell(page, 'A3')).toHaveText('North');
  await expect(await gridCell(page, 'B3')).toHaveText('0');
  await expect(await gridCell(page, 'C3')).toHaveText('1');
  await expect(await gridCell(page, 'D3')).toHaveText('1');
  await expect(await gridCell(page, 'A4')).toHaveText('South');
  await expect(await gridCell(page, 'B4')).toHaveText('1');
  await expect(await gridCell(page, 'C4')).toHaveText('0');
  await expect(await gridCell(page, 'D4')).toHaveText('1');
  await expect(await gridCell(page, 'A5')).toHaveText('Grand Total');
  await expect(await gridCell(page, 'B5')).toHaveText('2');
  await expect(await gridCell(page, 'C5')).toHaveText('1');
  await expect(await gridCell(page, 'D5')).toHaveText('3');

  await page.reload();
  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'D5')).toHaveText('3');
});

test('REQ-5-3-1 refresh after source data change replaces summary and source is not modified by refresh', async ({ page }) => {
  await openQ3Sales(page);
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await enterViaFormulaBar(page, 'C2', 'Closed');

  await page.getByRole('tab', { name: 'Pivot1', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  await editor.getByRole('button', { name: 'Refresh pivot table', exact: true }).click();

  await expect(await gridCell(page, 'B2')).toHaveText('1');
  await expect(await gridCell(page, 'C2')).toHaveText('0');
  await expect(await gridCell(page, 'D2')).toHaveText('1');
  await expect(await gridCell(page, 'B5')).toHaveText('2');
  await expect(await gridCell(page, 'C5')).toHaveText('1');
  await expect(await gridCell(page, 'D5')).toHaveText('3');

  // Switch back: the source edit remains and original row order is unchanged.
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await expect(await gridCell(page, 'A2')).toHaveText('East');
  await expect(await gridCell(page, 'C2')).toHaveText('Closed');
  await expect(await gridCell(page, 'A3')).toHaveText('North');
  await expect(await gridCell(page, 'A4')).toHaveText('South');
});

test('REQ-5-3-1 missing selected header refresh error preserves old result', async ({ page }) => {
  await openQ3Sales(page);
  // Current pivot uses Status as the column field; delete the Status column from source.
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await page.getByRole('columnheader', { name: 'C', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete column', exact: true }).click();

  await page.getByRole('tab', { name: 'Pivot1', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  await editor.getByRole('button', { name: 'Refresh pivot table', exact: true }).click();

  await expect(page.getByText('Pivot field is no longer available. Select a new field.', { exact: true })).toBeVisible();
  // The previous successful result is preserved.
  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'D5')).toHaveText('3');

  // Undo restores the deleted column and pivot config for later tests.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'C', exact: true })).toBeVisible();
});

test('REQ-5-3-1 SUM with nonnumeric value field shows visible error and preserves old result', async ({ page }) => {
  await openQ3Sales(page);
  await page.getByRole('tab', { name: 'Pivot1', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Pivot table editor', exact: true });

  // Switch to a text column (Status) as the value field with SUM; the old numeric summary must remain.
  await setComboboxByClick(editor, 'Rows', 'Region');
  await setComboboxByClick(editor, 'Columns', 'None');
  await setComboboxByClick(editor, 'Values', 'Status');
  await setComboboxByClick(editor, 'Summarize by', 'SUM');
  await editor.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(page.getByText('Value field requires numeric values', { exact: true })).toBeVisible();
  await expect(await gridCell(page, 'A1')).toHaveText('Region');
  await expect(await gridCell(page, 'D5')).toHaveText('3');

  // The failed apply must not alter the stored pivot configuration after a reload.
  await page.reload();
  const editorAfterReload = page.getByRole('region', { name: 'Pivot table editor', exact: true });
  const summarize = editorAfterReload.getByRole('combobox', { name: 'Summarize by', exact: true });
  await expect(summarize).toHaveValue('COUNT');
});
