const EVOLUTION_SEED_UPDATED_AT = '2026-01-16T09:30:00.000Z';

const EVOLUTION_WORKBOOKS = [
  {
    key: 'evo-m01-rename-ok',
    name: 'EVO-M01-RENAME-OK',
    activeSheet: 'IdentityLog',
    sheets: [
      { name: 'IdentityLog', cells: [{ row: 3, column: 6, value: 'unreviewed' }] },
    ],
  },
  {
    key: 'evo-m01-rename-dup',
    name: 'EVO-M01-RENAME-DUP',
    activeSheet: 'IdentityLog',
    sheets: [
      { name: 'IdentityLog', cells: [] },
    ],
  },
  {
    key: 'evo-m01-archive-reserved',
    name: 'EVO-M01-ARCHIVE-RESERVED',
    activeSheet: 'Reserved',
    sheets: [
      { name: 'Reserved', cells: [] },
    ],
  },
  {
    key: 'evo-m01-rename-limit',
    name: 'EVO-M01-RENAME-LIMIT',
    activeSheet: 'LimitProbe',
    sheets: [
      { name: 'LimitProbe', cells: [{ row: 2, column: 3, value: 'limit sentinel' }] },
    ],
  },
  {
    key: 'evo-m02-sheet-ok',
    name: 'EVO-M02-SHEET-OK',
    activeSheet: 'HarborDraft',
    sheets: [
      { name: 'HarborDraft', cells: [{ row: 5, column: 4, value: 'dock marker' }] },
      { name: 'LedgerView', cells: [] },
    ],
  },
  {
    key: 'evo-m02-sheet-dup',
    name: 'EVO-M02-SHEET-DUP',
    activeSheet: 'ArchiveBay',
    sheets: [
      { name: 'Meridian', cells: [] },
      { name: 'ArchiveBay', cells: [] },
    ],
  },
  {
    key: 'evo-m02-sheet-limit',
    name: 'EVO-M02-SHEET-LIMIT',
    activeSheet: 'LengthGauge',
    sheets: [
      { name: 'LengthGauge', cells: [{ row: 4, column: 7, value: 'sheet sentinel' }] },
    ],
  },
  {
    key: 'evo-m03-clear-text',
    name: 'EVO-M03-CLEAR-TEXT',
    activeSheet: 'Staging',
    sheets: [
      { name: 'Staging', cells: [{ row: 4, column: 8, value: 'obsolete tag' }] },
    ],
  },
  {
    key: 'evo-m03-clear-formula',
    name: 'EVO-M03-CLEAR-FORMULA',
    activeSheet: 'Calculations',
    sheets: [
      {
        name: 'Calculations',
        cells: [
          { row: 7, column: 2, value: '13' },
          { row: 7, column: 3, value: '=B7*5' },
          { row: 7, column: 4, value: '=C7+2' },
        ],
      },
    ],
  },
  {
    key: 'evo-m03-clear-range',
    name: 'EVO-M03-CLEAR-RANGE',
    activeSheet: 'Matrix',
    sheets: [
      {
        name: 'Matrix',
        cells: [
          { row: 4, column: 8, value: 'Amber' },
          { row: 4, column: 9, value: 'Delta' },
          { row: 5, column: 8, value: 'Kite' },
          { row: 5, column: 9, value: 'Orchid' },
        ],
      },
    ],
  },
  {
    key: 'evo-m04-filter-save',
    name: 'EVO-M04-FILTER-SAVE',
    activeSheet: 'Workload',
    sheets: [
      {
        name: 'Workload',
        cells: [
          { row: 3, column: 4, value: 'Workstream' },
          { row: 3, column: 5, value: 'Phase' },
          { row: 3, column: 6, value: 'Load' },
          { row: 4, column: 4, value: 'Atlas' },
          { row: 4, column: 5, value: 'Queued' },
          { row: 4, column: 6, value: '17' },
          { row: 5, column: 4, value: 'Atlas' },
          { row: 5, column: 5, value: 'Active' },
          { row: 5, column: 6, value: '31' },
          { row: 6, column: 4, value: 'Beacon' },
          { row: 6, column: 5, value: 'Queued' },
          { row: 6, column: 6, value: '22' },
          { row: 7, column: 4, value: 'Cirrus' },
          { row: 7, column: 5, value: 'Queued' },
          { row: 7, column: 6, value: '9' },
        ],
      },
    ],
  },
  {
    key: 'evo-m04-filter-apply',
    name: 'EVO-M04-FILTER-APPLY',
    activeSheet: 'Workload',
    sheets: [
      {
        name: 'Workload',
        cells: [
          { row: 3, column: 4, value: 'Workstream' },
          { row: 3, column: 5, value: 'Phase' },
          { row: 3, column: 6, value: 'Load' },
          { row: 4, column: 4, value: 'Atlas' },
          { row: 4, column: 5, value: 'Queued' },
          { row: 4, column: 6, value: '17' },
          { row: 5, column: 4, value: 'Atlas' },
          { row: 5, column: 5, value: 'Active' },
          { row: 5, column: 6, value: '31' },
          { row: 6, column: 4, value: 'Beacon' },
          { row: 6, column: 5, value: 'Queued' },
          { row: 6, column: 6, value: '22' },
          { row: 7, column: 4, value: 'Cirrus' },
          { row: 7, column: 5, value: 'Queued' },
          { row: 7, column: 6, value: '9' },
        ],
        savedViews: [
          {
            name: 'Queued lanes',
            startRow: 3,
            startColumn: 4,
            endRow: 7,
            endColumn: 6,
            columns: [{ column: 5, type: 'values', values: ['Queued'] }],
          },
        ],
      },
    ],
  },
  {
    key: 'evo-m04-filter-delete',
    name: 'EVO-M04-FILTER-DELETE',
    activeSheet: 'Workload',
    sheets: [
      {
        name: 'Workload',
        cells: [
          { row: 3, column: 4, value: 'Workstream' },
          { row: 3, column: 5, value: 'Phase' },
          { row: 3, column: 6, value: 'Load' },
          { row: 4, column: 4, value: 'Atlas' },
          { row: 4, column: 5, value: 'Queued' },
          { row: 4, column: 6, value: '17' },
          { row: 5, column: 4, value: 'Atlas' },
          { row: 5, column: 5, value: 'Active' },
          { row: 5, column: 6, value: '31' },
          { row: 6, column: 4, value: 'Beacon' },
          { row: 6, column: 5, value: 'Queued' },
          { row: 6, column: 6, value: '22' },
          { row: 7, column: 4, value: 'Cirrus' },
          { row: 7, column: 5, value: 'Queued' },
          { row: 7, column: 6, value: '9' },
        ],
        savedViews: [
          {
            name: 'Queued lanes',
            startRow: 3,
            startColumn: 4,
            endRow: 7,
            endColumn: 6,
            columns: [{ column: 5, type: 'values', values: ['Queued'] }],
          },
        ],
      },
    ],
  },
  {
    key: 'evo-m05-validation-formula',
    name: 'EVO-M05-VALIDATION-FORMULA',
    activeSheet: 'Thresholds',
    sheets: [
      {
        name: 'Thresholds',
        cells: [{ row: 6, column: 10, value: '37' }],
        validations: [
          {
            startRow: 6,
            startColumn: 10,
            endRow: 6,
            endColumn: 10,
            ruleType: 'number',
            minimum: 25,
            maximum: 75,
            errorMessage: 'Capacity must be from 25 to 75',
          },
        ],
      },
    ],
  },
  {
    key: 'evo-m05-validation-grid',
    name: 'EVO-M05-VALIDATION-GRID',
    activeSheet: 'Thresholds',
    sheets: [
      {
        name: 'Thresholds',
        cells: [{ row: 8, column: 11, value: 'Ready' }],
        validations: [
          {
            startRow: 8,
            startColumn: 11,
            endRow: 8,
            endColumn: 11,
            ruleType: 'dropdown',
            allowedValues: ['Ready', 'Holding', 'Released'],
            errorMessage: 'Choose a queue state',
          },
        ],
      },
    ],
  },
  {
    key: 'evo-m05-validation-edit',
    name: 'EVO-M05-VALIDATION-EDIT',
    activeSheet: 'Thresholds',
    sheets: [
      {
        name: 'Thresholds',
        cells: [{ row: 4, column: 12, value: '42' }],
        validations: [
          {
            startRow: 4,
            startColumn: 12,
            endRow: 4,
            endColumn: 12,
            ruleType: 'number',
            minimum: 25,
            maximum: 75,
            errorMessage: 'Capacity must be from 25 to 75',
          },
        ],
      },
    ],
  },
  {
    key: 'evo-n01-freeze-row',
    name: 'EVO-N01-FREEZE-ROW',
    activeSheet: 'ScrollLedger',
    sheets: [
      {
        name: 'ScrollLedger',
        rowCount: 40,
        columnCount: 10,
        cells: [
          { row: 1, column: 1, value: 'Item' },
          { row: 1, column: 2, value: 'Amount' },
          { row: 2, column: 1, value: 'Opening' },
          { row: 2, column: 2, value: '120' },
          { row: 40, column: 1, value: 'Closing' },
          { row: 40, column: 2, value: '980' },
        ],
      },
    ],
  },
  {
    key: 'evo-n01-freeze-column',
    name: 'EVO-N01-FREEZE-COLUMN',
    activeSheet: 'ScrollLedger',
    sheets: [
      {
        name: 'ScrollLedger',
        rowCount: 40,
        columnCount: 12,
        cells: [
          { row: 1, column: 1, value: 'Code' },
          { row: 8, column: 1, value: 'North' },
          { row: 40, column: 12, value: 'Tail' },
        ],
      },
    ],
  },
  {
    key: 'evo-n01-freeze-both',
    name: 'EVO-N01-FREEZE-BOTH',
    activeSheet: 'ScrollLedger',
    sheets: [
      {
        name: 'ScrollLedger',
        rowCount: 40,
        columnCount: 12,
        cells: [
          { row: 1, column: 1, value: 'Code' },
          { row: 1, column: 2, value: 'Amount' },
          { row: 4, column: 3, value: 'Locked anchor' },
          { row: 40, column: 12, value: 'Tail' },
        ],
      },
    ],
  },
  {
    key: 'evo-n02-find-next',
    name: 'EVO-N02-FIND-NEXT',
    activeSheet: 'Narrative',
    sheets: [
      {
        name: 'Narrative',
        rowCount: 20,
        columnCount: 10,
        cells: [
          { row: 4, column: 5, value: 'Cobalt' },
          { row: 7, column: 5, value: 'Cobalt' },
          { row: 11, column: 5, value: 'Cobalt' },
        ],
      },
    ],
  },
  {
    key: 'evo-n02-replace-all',
    name: 'EVO-N02-REPLACE-ALL',
    activeSheet: 'Narrative',
    sheets: [
      {
        name: 'Narrative',
        rowCount: 20,
        columnCount: 10,
        cells: [
          { row: 3, column: 6, value: 'Cobalt' },
          { row: 6, column: 6, value: 'Cobalt' },
          { row: 9, column: 6, value: 'Cobalt' },
          { row: 12, column: 6, value: 'Copper' },
        ],
      },
    ],
  },
  {
    key: 'evo-n02-case-sensitive',
    name: 'EVO-N02-CASE-SENSITIVE',
    activeSheet: 'Narrative',
    sheets: [
      {
        name: 'Narrative',
        rowCount: 20,
        columnCount: 10,
        cells: [
          { row: 3, column: 7, value: 'Cobalt' },
          { row: 4, column: 7, value: 'cobalt' },
          { row: 5, column: 7, value: 'Cobalt-7' },
        ],
      },
    ],
  },
  {
    key: 'evo-n03-named-create',
    name: 'EVO-N03-NAMED-CREATE',
    activeSheet: 'ForecastModel',
    sheets: [
      {
        name: 'ForecastModel',
        rowCount: 10,
        columnCount: 12,
        cells: [
          { row: 3, column: 10, value: '18' },
          { row: 4, column: 10, value: '24' },
          { row: 5, column: 10, value: '31' },
        ],
      },
    ],
  },
  {
    key: 'evo-n03-named-invalid',
    name: 'EVO-N03-NAMED-INVALID',
    activeSheet: 'ForecastModel',
    sheets: [
      {
        name: 'ForecastModel',
        rowCount: 10,
        columnCount: 12,
        cells: [
          { row: 2, column: 11, value: '6' },
          { row: 3, column: 11, value: '14' },
        ],
      },
    ],
  },
  {
    key: 'evo-n03-named-update',
    name: 'EVO-N03-NAMED-UPDATE',
    activeSheet: 'ForecastModel',
    sheets: [
      {
        name: 'ForecastModel',
        rowCount: 10,
        columnCount: 13,
        cells: [
          { row: 2, column: 11, value: '5' },
          { row: 3, column: 11, value: '8' },
          { row: 4, column: 11, value: '12' },
          { row: 2, column: 13, value: '=SUM(MarginBase)' },
        ],
        namedRanges: [
          { name: 'MarginBase', range: 'ForecastModel!K2:K3' },
        ],
      },
    ],
  },
  {
    key: 'evo-n04-format-number',
    name: 'EVO-N04-FORMAT-NUMBER',
    activeSheet: 'Signals',
    sheets: [
      {
        name: 'Signals',
        rowCount: 10,
        columnCount: 12,
        cells: [
          { row: 4, column: 10, value: '11' },
          { row: 5, column: 10, value: '29' },
          { row: 6, column: 10, value: '46' },
        ],
      },
    ],
  },
  {
    key: 'evo-n04-format-text',
    name: 'EVO-N04-FORMAT-TEXT',
    activeSheet: 'Signals',
    sheets: [
      {
        name: 'Signals',
        rowCount: 10,
        columnCount: 12,
        cells: [
          { row: 4, column: 11, value: 'Watch' },
          { row: 5, column: 11, value: 'Stable' },
          { row: 6, column: 11, value: 'Elevated' },
        ],
      },
    ],
  },
  {
    key: 'evo-n04-format-edit',
    name: 'EVO-N04-FORMAT-EDIT',
    activeSheet: 'Signals',
    sheets: [
      {
        name: 'Signals',
        rowCount: 10,
        columnCount: 12,
        cells: [
          { row: 3, column: 12, value: '16' },
          { row: 4, column: 12, value: '28' },
          { row: 5, column: 12, value: '39' },
        ],
        conditionalFormats: [
          {
            startRow: 3,
            startColumn: 12,
            endRow: 5,
            endColumn: 12,
            condition: 'greater_than',
            value: '20',
            style: 'red',
          },
        ],
      },
    ],
  },
  {
    key: 'evo-n05-note-create',
    name: 'EVO-N05-NOTE-CREATE',
    activeSheet: 'ReviewQueue',
    sheets: [
      {
        name: 'ReviewQueue',
        rowCount: 10,
        columnCount: 10,
        cells: [
          { row: 8, column: 4, value: 'Manifest R41' },
        ],
      },
    ],
  },
  {
    key: 'evo-n05-note-delete',
    name: 'EVO-N05-NOTE-DELETE',
    activeSheet: 'ReviewQueue',
    sheets: [
      {
        name: 'ReviewQueue',
        rowCount: 10,
        columnCount: 10,
        cells: [
          { row: 3, column: 10, value: 'Route Zeta' },
        ],
        notes: [
          { row: 3, column: 10, text: 'Retire after audit' },
        ],
      },
    ],
  },
  {
    key: 'evo-n05-note-edit',
    name: 'EVO-N05-NOTE-EDIT',
    activeSheet: 'ReviewQueue',
    sheets: [
      {
        name: 'ReviewQueue',
        rowCount: 10,
        columnCount: 10,
        cells: [
          { row: 6, column: 6, value: 'Gate Rho' },
        ],
        notes: [
          { row: 6, column: 6, text: 'Awaiting controller sign-off' },
        ],
      },
    ],
  },
];

async function insertCells(tx, worksheetId, cells = []) {
  for (const cell of cells) {
    await tx.run(
      `INSERT INTO cells (worksheet_id, row_number, column_number, value)
       VALUES (?, ?, ?, ?)`,
      [worksheetId, cell.row, cell.column, cell.value],
    );
  }
}

async function insertCellNote(tx, worksheetId, noteSeed) {
  await tx.run(
    `INSERT INTO cell_notes (worksheet_id, row_number, column_number, note)
     VALUES (?, ?, ?, ?)`,
    [worksheetId, noteSeed.row, noteSeed.column, noteSeed.text ?? noteSeed.note ?? ''],
  );
}

async function insertValidationRule(tx, worksheetId, rule) {
  await tx.run(
    `INSERT INTO validation_rules
       (worksheet_id, start_row, start_column, end_row, end_column, rule_type, allowed_values, minimum, maximum, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      worksheetId,
      rule.startRow,
      rule.startColumn,
      rule.endRow,
      rule.endColumn,
      rule.ruleType,
      rule.ruleType === 'dropdown' ? JSON.stringify(rule.allowedValues || []) : null,
      rule.ruleType === 'number' ? rule.minimum : null,
      rule.ruleType === 'number' ? rule.maximum : null,
      rule.errorMessage || null,
    ],
  );
}

async function insertFilter(tx, worksheetId, filter) {
  const result = await tx.run(
    `INSERT INTO filters (worksheet_id, start_row, start_column, end_row, end_column)
     VALUES (?, ?, ?, ?, ?)`,
    [worksheetId, filter.startRow, filter.startColumn, filter.endRow, filter.endColumn],
  );
  for (const column of filter.columns || []) {
    await tx.run(
      `INSERT INTO filter_conditions (filter_id, column_number, condition_type, selected_values, value)
       VALUES (?, ?, ?, ?, ?)`,
      [
        result.lastID,
        column.column,
        column.type,
        column.type === 'values' ? JSON.stringify(column.values || []) : null,
        column.type === 'values' ? null : (column.value || ''),
      ],
    );
  }
}

async function insertSavedView(tx, workbookId, worksheetId, view) {
  await tx.run(
    `INSERT INTO filter_views
       (workbook_id, worksheet_id, name, start_row, start_column, end_row, end_column, columns_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workbookId,
      worksheetId,
      view.name,
      view.startRow,
      view.startColumn,
      view.endRow,
      view.endColumn,
      JSON.stringify(view.columns || []),
    ],
  );
}

async function insertNamedRange(tx, workbookId, namedRange) {
  await tx.run(
    `INSERT INTO named_ranges (workbook_id, name, range_text)
     VALUES (?, ?, ?)`,
    [workbookId, namedRange.name, namedRange.range],
  );
}

async function insertConditionalFormat(tx, worksheetId, rule) {
  await tx.run(
    `INSERT INTO conditional_formats
       (worksheet_id, start_row, start_column, end_row, end_column, condition_type, compare_value, style)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      worksheetId,
      rule.startRow,
      rule.startColumn,
      rule.endRow,
      rule.endColumn,
      rule.condition,
      rule.value == null ? '' : String(rule.value),
      rule.style,
    ],
  );
}

async function seedEvolutionWorkbooks(tx) {
  for (const workbookSeed of EVOLUTION_WORKBOOKS) {
    const existingByKey = await tx.get(
      'SELECT id FROM workbooks WHERE seed_key = ?',
      [workbookSeed.key],
    );

    // Once provisioned, never reset the workbook or its sheets/cells. This keeps
    // user edits (including renames, cell changes, filters and validation rules)
    // intact across restarts.
    if (existingByKey) {
      continue;
    }

    const existingByName = await tx.get(
      'SELECT id FROM workbooks WHERE LOWER(name) = LOWER(?)',
      [workbookSeed.name],
    );
    if (existingByName) {
      continue;
    }

    const workbookResult = await tx.run(
      'INSERT INTO workbooks (name, updated_at, seed_key) VALUES (?, ?, ?)',
      [workbookSeed.name, EVOLUTION_SEED_UPDATED_AT, workbookSeed.key],
    );
    const workbookId = workbookResult.lastID;

    let activeWorksheetId = null;
    for (let index = 0; index < workbookSeed.sheets.length; index += 1) {
      const sheetSeed = workbookSeed.sheets[index];
      const maxCellRow = (sheetSeed.cells || []).reduce((max, cell) => Math.max(max, cell.row || 0), 0);
      const maxCellColumn = (sheetSeed.cells || []).reduce((max, cell) => Math.max(max, cell.column || 0), 0);
      const maxRuleRow = (sheetSeed.validations || []).reduce(
        (max, rule) => Math.max(max, rule.startRow || 0, rule.endRow || 0),
        0,
      );
      const maxRuleColumn = (sheetSeed.validations || []).reduce(
        (max, rule) => Math.max(max, rule.startColumn || 0, rule.endColumn || 0),
        0,
      );
      const rowCount = Math.max(10, maxCellRow, maxRuleRow, sheetSeed.rowCount || 0);
      const columnCount = Math.max(10, maxCellColumn, maxRuleColumn, sheetSeed.columnCount || 0);
      const sheetResult = await tx.run(
        `INSERT INTO worksheets
           (workbook_id, name, position, row_count, column_count, selected_row, selected_column)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [workbookId, sheetSeed.name, index + 1, rowCount, columnCount],
      );
      const worksheetId = sheetResult.lastID;

      if (sheetSeed.name === workbookSeed.activeSheet) {
        activeWorksheetId = worksheetId;
      }

      await insertCells(tx, worksheetId, sheetSeed.cells || []);
      for (const cellNote of sheetSeed.notes || []) {
        await insertCellNote(tx, worksheetId, cellNote);
      }
      for (const namedRange of sheetSeed.namedRanges || []) {
        await insertNamedRange(tx, workbookId, namedRange);
      }
      for (const rule of sheetSeed.validations || []) {
        await insertValidationRule(tx, worksheetId, rule);
      }
      for (const rule of sheetSeed.conditionalFormats || []) {
        await insertConditionalFormat(tx, worksheetId, rule);
      }
      if (sheetSeed.filter) {
        await insertFilter(tx, worksheetId, sheetSeed.filter);
      }
      for (const view of sheetSeed.savedViews || []) {
        await insertSavedView(tx, workbookId, worksheetId, view);
      }
    }

    await tx.run(
      'UPDATE workbooks SET active_worksheet_id = ? WHERE id = ?',
      [activeWorksheetId, workbookId],
    );
  }
}

module.exports = {
  EVOLUTION_SEED_UPDATED_AT,
  EVOLUTION_WORKBOOKS,
  seedEvolutionWorkbooks,
};
