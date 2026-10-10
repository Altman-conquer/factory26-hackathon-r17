import { describe, expect, test } from 'vitest';
import { createTestDatabaseHarness } from '../src/database/index.js';

describe('evolution seed initialization', () => {
  test('provisions EVO workbooks idempotently and preserves user edits', async () => {
    const harness = createTestDatabaseHarness({
      label: 'evolution-seed',
      seedDefault: true,
    });

    try {
      const runtime = await harness.setup();

      const seedRows = await runtime.all(
        'SELECT id, name, seed_key FROM workbooks WHERE seed_key LIKE ? ORDER BY seed_key ASC',
        ['evo-%'],
      );
      expect(seedRows.map((row) => row.name)).toEqual([
        'EVO-M01-ARCHIVE-RESERVED',
        'EVO-M01-RENAME-DUP',
        'EVO-M01-RENAME-LIMIT',
        'EVO-M01-RENAME-OK',
        'EVO-M02-SHEET-DUP',
        'EVO-M02-SHEET-LIMIT',
        'EVO-M02-SHEET-OK',
        'EVO-M03-CLEAR-FORMULA',
        'EVO-M03-CLEAR-RANGE',
        'EVO-M03-CLEAR-TEXT',
        'EVO-M04-FILTER-APPLY',
        'EVO-M04-FILTER-DELETE',
        'EVO-M04-FILTER-SAVE',
        'EVO-M05-VALIDATION-EDIT',
        'EVO-M05-VALIDATION-FORMULA',
        'EVO-M05-VALIDATION-GRID',
        'EVO-N01-FREEZE-BOTH',
        'EVO-N01-FREEZE-COLUMN',
        'EVO-N01-FREEZE-ROW',
        'EVO-N02-CASE-SENSITIVE',
        'EVO-N02-FIND-NEXT',
        'EVO-N02-REPLACE-ALL',
        'EVO-N03-NAMED-CREATE',
        'EVO-N03-NAMED-INVALID',
        'EVO-N03-NAMED-UPDATE',
        'EVO-N04-FORMAT-EDIT',
        'EVO-N04-FORMAT-NUMBER',
        'EVO-N04-FORMAT-TEXT',
        'EVO-N05-NOTE-CREATE',
        'EVO-N05-NOTE-DELETE',
        'EVO-N05-NOTE-EDIT',
      ]);

      const clearFormulaSheet = await runtime.get(
        `SELECT ws.id
           FROM worksheets ws
           JOIN workbooks w ON w.id = ws.workbook_id
          WHERE w.seed_key = 'evo-m03-clear-formula' AND ws.name = 'Calculations'`,
      );
      const c7 = await runtime.get(
        'SELECT value FROM cells WHERE worksheet_id = ? AND row_number = 7 AND column_number = 3',
        [clearFormulaSheet.id],
      );
      expect(c7.value).toBe('=B7*5');

      const filterApplyWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-m04-filter-apply'",
      );
      const savedView = await runtime.get(
        'SELECT name, columns_json FROM filter_views WHERE workbook_id = ?',
        [filterApplyWorkbook.id],
      );
      expect(savedView.name).toBe('Queued lanes');
      expect(JSON.parse(savedView.columns_json)).toEqual([
        { column: 5, type: 'values', values: ['Queued'] },
      ]);

      const validationWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-m05-validation-formula'",
      );
      const validationSheet = await runtime.get(
        'SELECT id FROM worksheets WHERE workbook_id = ? AND name = ?',
        [validationWorkbook.id, 'Thresholds'],
      );
      const validationRule = await runtime.get(
        'SELECT rule_type, minimum, maximum, error_message FROM validation_rules WHERE worksheet_id = ?',
        [validationSheet.id],
      );
      expect(validationRule).toMatchObject({
        rule_type: 'number',
        minimum: 25,
        maximum: 75,
        error_message: 'Capacity must be from 25 to 75',
      });

      const namedWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-n03-named-update'",
      );
      const namedRange = await runtime.get(
        'SELECT name, range_text FROM named_ranges WHERE workbook_id = ?',
        [namedWorkbook.id],
      );
      expect(namedRange).toEqual({ name: 'MarginBase', range_text: 'ForecastModel!K2:K3' });

      const formatWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-n04-format-edit'",
      );
      const formatSheet = await runtime.get(
        'SELECT id FROM worksheets WHERE workbook_id = ? AND name = ?',
        [formatWorkbook.id, 'Signals'],
      );
      const formatRule = await runtime.get(
        'SELECT condition_type, compare_value, style FROM conditional_formats WHERE worksheet_id = ?',
        [formatSheet.id],
      );
      expect(formatRule).toEqual({
        condition_type: 'greater_than',
        compare_value: '20',
        style: 'red',
      });

      const noteEditWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-n05-note-edit'",
      );
      const noteEditCell = await runtime.get(
        `SELECT cn.id, cn.note
           FROM cell_notes cn
           JOIN worksheets ws ON ws.id = cn.worksheet_id
          WHERE ws.workbook_id = ? AND ws.name = 'ReviewQueue'
            AND cn.row_number = 6 AND cn.column_number = 6`,
        [noteEditWorkbook.id],
      );
      expect(noteEditCell.note).toBe('Awaiting controller sign-off');

      const noteDeleteWorkbook = await runtime.get(
        "SELECT id FROM workbooks WHERE seed_key = 'evo-n05-note-delete'",
      );
      const noteDeleteCell = await runtime.get(
        `SELECT cn.note
           FROM cell_notes cn
           JOIN worksheets ws ON ws.id = cn.worksheet_id
          WHERE ws.workbook_id = ? AND ws.name = 'ReviewQueue'
            AND cn.row_number = 3 AND cn.column_number = 10`,
        [noteDeleteWorkbook.id],
      );
      expect(noteDeleteCell.note).toBe('Retire after audit');

      const identitySheet = await runtime.get(
        `SELECT ws.id
           FROM worksheets ws
           JOIN workbooks w ON w.id = ws.workbook_id
          WHERE w.seed_key = 'evo-m01-rename-ok' AND ws.name = 'IdentityLog'`,
      );
      const f3 = await runtime.get(
        'SELECT value FROM cells WHERE worksheet_id = ? AND row_number = 3 AND column_number = 6',
        [identitySheet.id],
      );
      expect(f3.value).toBe('unreviewed');

      // Re-running startup seeding must not create duplicates.
      await runtime.seedDefault();
      const countAfterReseed = await runtime.get(
        'SELECT COUNT(*) AS count FROM workbooks WHERE seed_key LIKE ?',
        ['evo-%'],
      );
      expect(countAfterReseed.count).toBe(31);

      // Simulate user edits through stored state; a restart must preserve them.
      await runtime.run(
        "UPDATE workbooks SET name = 'User Renamed EVO Workbook' WHERE seed_key = 'evo-m01-rename-ok'",
      );
      await runtime.run("UPDATE worksheets SET name = 'Edited Identity Log' WHERE id = ?", [identitySheet.id]);
      await runtime.run("UPDATE cells SET value = 'user edit sentinel' WHERE worksheet_id = ? AND row_number = 3 AND column_number = 6", [identitySheet.id]);
      await runtime.run("UPDATE cell_notes SET note = 'user note edit sentinel' WHERE id = ?", [noteEditCell.id]);

      await runtime.seedDefault();

      const workbookAfter = await runtime.get(
        "SELECT name FROM workbooks WHERE seed_key = 'evo-m01-rename-ok'",
      );
      const sheetAfter = await runtime.get('SELECT name FROM worksheets WHERE id = ?', [identitySheet.id]);
      const cellAfter = await runtime.get(
        'SELECT value FROM cells WHERE worksheet_id = ? AND row_number = 3 AND column_number = 6',
        [identitySheet.id],
      );
      const noteAfter = await runtime.get('SELECT note FROM cell_notes WHERE id = ?', [noteEditCell.id]);

      expect(workbookAfter.name).toBe('User Renamed EVO Workbook');
      expect(sheetAfter.name).toBe('Edited Identity Log');
      expect(cellAfter.value).toBe('user edit sentinel');
      expect(noteAfter.note).toBe('user note edit sentinel');
      expect(await runtime.get(
        "SELECT id FROM workbooks WHERE name = 'EVO-M01-RENAME-OK'",
      )).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
