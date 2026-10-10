const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openWorkbook(page, name) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function gridCell(page, name) {
  return page.getByRole('grid', { name: 'Worksheet grid' }).getByRole('gridcell', { name, exact: true });
}

async function selectRange(page, start, end) {
  await gridCell(page, start).click();
  await gridCell(page, end).click({ modifiers: ['Shift'] });
}

async function openDataMenu(page) {
  await page.getByRole('button', { name: 'Data', exact: true }).click();
}

async function createFilterForRange(page, start, end) {
  await selectRange(page, start, end);
  await openDataMenu(page);
  await page.getByRole('menuitem', { name: 'Create filter', exact: true }).click();
}

async function chooseCondition(dialog, label) {
  const condition = dialog.getByRole('combobox', { name: 'Condition', exact: true });
  await condition.click();
  await dialog.getByRole('option', { name: label, exact: true }).click();
}

test.describe('REQ-3-1-1 Delete clears grid selections', () => {
  test('clears a text cell and persists an empty formula bar', async ({ page }) => {
    await openWorkbook(page, 'EVO-M03-CLEAR-TEXT');
    const h4 = gridCell(page, 'H4');
    const formulaBar = page.getByLabel('Formula bar');

    await h4.click();
    await expect(h4).toHaveText('obsolete tag');
    await expect(formulaBar).toHaveValue('obsolete tag');

    await page.keyboard.press('Delete');

    await expect(h4).toHaveText('');
    await expect(h4).toHaveAttribute('aria-selected', 'true');
    await expect(formulaBar).toHaveValue('');

    await page.reload();
    await expect(gridCell(page, 'H4')).toHaveText('');
    await gridCell(page, 'H4').click();
    await expect(page.getByLabel('Formula bar')).toHaveValue('');
  });

  test('clears a formula, recalculates dependents, and persists', async ({ page }) => {
    await openWorkbook(page, 'EVO-M03-CLEAR-FORMULA');
    const c7 = gridCell(page, 'C7');
    const d7 = gridCell(page, 'D7');
    const formulaBar = page.getByLabel('Formula bar');

    await c7.click();
    await expect(c7).toHaveText('65');
    await expect(formulaBar).toHaveValue('=B7*5');
    await expect(d7).toHaveText('67');

    await page.keyboard.press('Delete');

    await expect(c7).toHaveText('');
    await expect(formulaBar).toHaveValue('');
    await expect(d7).toHaveText('2');

    await page.reload();
    await expect(gridCell(page, 'C7')).toHaveText('');
    await expect(gridCell(page, 'D7')).toHaveText('2');
  });

  test('clears every cell in a rectangular selection and keeps it selected', async ({ page }) => {
    await openWorkbook(page, 'EVO-M03-CLEAR-RANGE');
    await selectRange(page, 'H4', 'I5');

    for (const name of ['H4', 'I4', 'H5', 'I5']) {
      await expect(gridCell(page, name)).not.toHaveText('');
    }

    await page.keyboard.press('Delete');

    for (const name of ['H4', 'I4', 'H5', 'I5']) {
      await expect(gridCell(page, name)).toHaveText('');
      await expect(gridCell(page, name)).toHaveAttribute('aria-selected', 'true');
    }

    await page.reload();
    for (const name of ['H4', 'I4', 'H5', 'I5']) {
      await expect(gridCell(page, name)).toHaveText('');
    }
  });
});

test.describe('REQ-5-1-2 saved filter views', () => {
  test('saves two-condition filter view and persists it', async ({ page }) => {
    await openWorkbook(page, 'EVO-M04-FILTER-SAVE');
    await createFilterForRange(page, 'D3', 'F7');

    const workstreamFilter = page.getByRole('button', { name: 'Filter Workstream', exact: true });
    await workstreamFilter.click();
    const workstreamDialog = page.getByRole('dialog', { name: 'Filter Workstream', exact: true });
    await chooseCondition(workstreamDialog, 'Text contains');
    await workstreamDialog.getByLabel('Value').fill('Atlas');
    await workstreamDialog.getByRole('button', { name: 'Apply', exact: true }).click();

    const loadFilter = page.getByRole('button', { name: 'Filter Load', exact: true });
    await loadFilter.click();
    const loadDialog = page.getByRole('dialog', { name: 'Filter Load', exact: true });
    await chooseCondition(loadDialog, 'Greater than');
    await loadDialog.getByLabel('Value').fill('20');
    await loadDialog.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(gridCell(page, 'D5')).toHaveText('Atlas');
    await expect(gridCell(page, 'E5')).toHaveText('Active');
    await expect(gridCell(page, 'F5')).toHaveText('31');
    await expect(gridCell(page, 'D4')).toHaveCount(0);
    await expect(gridCell(page, 'D6')).toHaveCount(0);
    await expect(gridCell(page, 'D7')).toHaveCount(0);

    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Save filter view', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save filter view', exact: true });
    await saveDialog.getByRole('textbox', { name: 'Filter view name', exact: true }).fill('Atlas active load');
    await saveDialog.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(saveDialog).toHaveCount(0);

    await page.reload();
    await expect(gridCell(page, 'D5')).toHaveText('Atlas');
    await expect(gridCell(page, 'D4')).toHaveCount(0);

    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
    const viewsDialog = page.getByRole('dialog', { name: 'Filter views', exact: true });
    await expect(viewsDialog.getByRole('button', { name: 'Atlas active load', exact: true })).toHaveCount(1);
  });

  test('applies a persisted saved filter view and keeps it selected', async ({ page }) => {
    await openWorkbook(page, 'EVO-M04-FILTER-APPLY');

    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
    const viewsDialog = page.getByRole('dialog', { name: 'Filter views', exact: true });
    const queuedView = viewsDialog.getByRole('button', { name: 'Queued lanes', exact: true });
    await expect(queuedView).toBeVisible();
    await queuedView.click();

    await expect(queuedView).toHaveAttribute('aria-pressed', 'true');
    await expect(viewsDialog).toBeVisible();
    await expect(gridCell(page, 'D4')).toHaveText('Atlas');
    await expect(gridCell(page, 'D6')).toHaveText('Beacon');
    await expect(gridCell(page, 'D7')).toHaveText('Cirrus');
    await expect(gridCell(page, 'D5')).toHaveCount(0);

    await page.reload();
    await expect(gridCell(page, 'D4')).toHaveText('Atlas');
    await expect(gridCell(page, 'D5')).toHaveCount(0);
  });

  test('rejects a trimmed case-insensitive duplicate and deletes the selected view', async ({ page }) => {
    await openWorkbook(page, 'EVO-M04-FILTER-DELETE');
    await createFilterForRange(page, 'D3', 'F7');

    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Save filter view', exact: true }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save filter view', exact: true });
    await saveDialog.getByRole('textbox', { name: 'Filter view name', exact: true }).fill(' queued lanes ');
    await saveDialog.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(saveDialog.getByText('Filter view name already exists', { exact: true })).toBeVisible();
    await expect(saveDialog).toBeVisible();
    await saveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
    const viewsDialog = page.getByRole('dialog', { name: 'Filter views', exact: true });
    const queuedView = viewsDialog.getByRole('button', { name: 'Queued lanes', exact: true });
    await queuedView.click();
    await expect(queuedView).toHaveAttribute('aria-pressed', 'true');
    await expect(gridCell(page, 'D5')).toHaveCount(0);

    await viewsDialog.getByRole('button', { name: 'Delete filter view', exact: true }).click();
    await expect(viewsDialog.getByRole('button', { name: 'Queued lanes', exact: true })).toHaveCount(0);
    await expect(gridCell(page, 'D4')).toHaveText('Atlas');
    await expect(gridCell(page, 'D5')).toHaveText('Atlas');
    await expect(gridCell(page, 'D6')).toHaveText('Beacon');
    await expect(gridCell(page, 'D7')).toHaveText('Cirrus');

    await page.reload();
    await expect(gridCell(page, 'D4')).toHaveText('Atlas');
    await expect(gridCell(page, 'D5')).toHaveText('Atlas');
    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Filter views', exact: true }).click();
    const reloadedViewsDialog = page.getByRole('dialog', { name: 'Filter views', exact: true });
    await expect(reloadedViewsDialog.getByRole('button', { name: 'Queued lanes', exact: true })).toHaveCount(0);
  });
});

test.describe('REQ-5-2-1 custom validation error messages', () => {
  test('shows a custom numeric error from the formula bar and persists it', async ({ page }) => {
    await openWorkbook(page, 'EVO-M05-VALIDATION-FORMULA');
    const formulaBar = page.getByLabel('Formula bar');

    await gridCell(page, 'J6').click();
    await expect(formulaBar).toHaveValue('37');
    await formulaBar.fill('88');
    await formulaBar.press('Enter');

    await expect(page.getByText('Capacity must be from 25 to 75', { exact: true })).toBeVisible();
    await expect(gridCell(page, 'J6')).toHaveText('37');

    await page.reload();
    await gridCell(page, 'J6').click();
    await page.getByLabel('Formula bar').fill('88');
    await page.getByLabel('Formula bar').press('Enter');
    await expect(page.getByText('Capacity must be from 25 to 75', { exact: true })).toBeVisible();
    await expect(gridCell(page, 'J6')).toHaveText('37');
  });

  test('shows a custom dropdown error from the grid editor and persists it', async ({ page }) => {
    await openWorkbook(page, 'EVO-M05-VALIDATION-GRID');
    const k8 = gridCell(page, 'K8');
    await expect(k8).toHaveText('Ready');

    await k8.dblclick();
    const editor = page.getByRole('textbox', { name: 'Edit K8', exact: true });
    await editor.fill('Paused');
    await editor.press('Enter');

    await expect(page.getByText('Choose a queue state', { exact: true })).toBeVisible();
    await expect(k8).toHaveText('Ready');

    await page.reload();
    await gridCell(page, 'K8').dblclick();
    await page.getByRole('textbox', { name: 'Edit K8', exact: true }).fill('Paused');
    await page.getByRole('textbox', { name: 'Edit K8', exact: true }).press('Enter');
    await expect(page.getByText('Choose a queue state', { exact: true })).toBeVisible();
    await expect(gridCell(page, 'K8')).toHaveText('Ready');
  });

  test('updates a persisted custom message and accepts valid values', async ({ page }) => {
    await openWorkbook(page, 'EVO-M05-VALIDATION-EDIT');
    await gridCell(page, 'L4').click();
    await openDataMenu(page);
    await page.getByRole('menuitem', { name: 'Data validation', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Data validation', exact: true });
    const errorInput = dialog.getByRole('textbox', { name: 'Error message', exact: true });
    await expect(errorInput).toHaveValue('Capacity must be from 25 to 75');
    await errorInput.fill('Allocate between 25 and 75');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const formulaBar = page.getByLabel('Formula bar');
    await formulaBar.fill('24');
    await formulaBar.press('Enter');
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

    // Clearing the optional message restores the standard validation message.
    await dialog.getByRole('textbox', { name: 'Error message', exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel('Formula bar').fill('24');
    await page.getByLabel('Formula bar').press('Enter');
    await expect(page.getByText('Please enter a number between 25 and 75', { exact: true })).toBeVisible();
    await expect(gridCell(page, 'L4')).toHaveText('42');

    // A valid value is accepted.
    await page.getByLabel('Formula bar').fill('50');
    await page.getByLabel('Formula bar').press('Enter');
    await expect(gridCell(page, 'L4')).toHaveText('50');
    await page.reload();
    await expect(gridCell(page, 'L4')).toHaveText('50');
  });
});
