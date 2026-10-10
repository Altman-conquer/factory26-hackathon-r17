const express = require('express');
const { withTransaction, get: dbGet, all: dbAll } = require('../database/db_runtime');
const { parseCsv, serializeCsv, CsvParseError } = require('../lib/csv');
const { isFormula, computeDisplayValues, adjustFormulaReferences, adjustFormulaForRowInsert, adjustFormulaForRowDelete, adjustFormulaForColumnInsert, adjustFormulaForColumnDelete, replaceCellRefs } = require('../lib/formula');

const undoStacks = new Map(); // workbookId -> array of snapshots
const redoStacks = new Map(); // workbookId -> array of snapshots

const router = express.Router();

const DEFAULT_NEW_WORKBOOK_NAME = 'Untitled workbook';
const INVALID_CSV_MESSAGE = 'Invalid CSV file format. Import failed.';

function formatLastUpdated(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWorkbookName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorksheetName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function columnName(index) {
  let name = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function assertWorksheetExists(tx, workbookId, worksheetId) {
  return tx.get(
    'SELECT * FROM worksheets WHERE id = ? AND workbook_id = ?',
    [worksheetId, workbookId],
  );
}

function normalizeRangePart(value, fallback, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return fallback;
  return n;
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (e) {
    // fall back to comma-separated parsing
  }
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

async function getFilterForWorksheet(txOrDb, worksheetId) {
  const filter = await txOrDb.get(
    'SELECT * FROM filters WHERE worksheet_id = ?',
    [worksheetId],
  );
  if (!filter) return null;
  const conditions = await txOrDb.all(
    'SELECT * FROM filter_conditions WHERE filter_id = ? ORDER BY column_number ASC, id ASC',
    [filter.id],
  );
  return {
    startRow: filter.start_row,
    startColumn: filter.start_column,
    endRow: filter.end_row,
    endColumn: filter.end_column,
    columns: (conditions || []).map((condition) => {
      const base = {
        column: condition.column_number,
        type: condition.condition_type,
      };
      if (condition.condition_type === 'values') {
        return { ...base, values: parseJsonArray(condition.selected_values) };
      }
      return { ...base, value: condition.value || '' };
    }),
  };
}

async function getValidationRulesForWorksheet(txOrDb, worksheetId) {
  const rules = await txOrDb.all(
    'SELECT * FROM validation_rules WHERE worksheet_id = ? ORDER BY id ASC',
    [worksheetId],
  );
  return (rules || []).map((rule) => ({
    id: rule.id,
    startRow: rule.start_row,
    startColumn: rule.start_column,
    endRow: rule.end_row,
    endColumn: rule.end_column,
    type: rule.rule_type,
    allowedValues: rule.rule_type === 'dropdown' ? parseJsonArray(rule.allowed_values) : undefined,
    minimum: rule.rule_type === 'number' ? rule.minimum : undefined,
    maximum: rule.rule_type === 'number' ? rule.maximum : undefined,
    errorMessage: rule.error_message ? String(rule.error_message).trim() : null,
  }));
}

function parseColumnsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function getFilterViewsForWorkbook(txOrDb, workbookId) {
  const views = await txOrDb.all(
    'SELECT * FROM filter_views WHERE workbook_id = ? ORDER BY id ASC',
    [workbookId],
  );
  return (views || []).map((view) => ({
    id: view.id,
    workbookId: view.workbook_id,
    worksheetId: view.worksheet_id,
    name: view.name,
    startRow: view.start_row,
    startColumn: view.start_column,
    endRow: view.end_row,
    endColumn: view.end_column,
    columns: parseColumnsJson(view.columns_json),
  }));
}

function mapNamedRange(row) {
  return {
    id: row.id,
    name: row.name,
    range: row.range_text,
  };
}

async function getNamedRangesForWorkbook(txOrDb, workbookId) {
  const rows = await txOrDb.all(
    'SELECT * FROM named_ranges WHERE workbook_id = ? ORDER BY LOWER(name) ASC, id ASC',
    [workbookId],
  );
  return (rows || []).map(mapNamedRange);
}

function namedRangeMap(namedRanges) {
  const map = {};
  for (const namedRange of namedRanges || []) {
    if (namedRange?.name) map[namedRange.name] = namedRange.range;
  }
  return map;
}

function mapConditionalFormat(row) {
  return {
    id: row.id,
    startRow: row.start_row,
    startColumn: row.start_column,
    endRow: row.end_row,
    endColumn: row.end_column,
    condition: row.condition_type,
    value: row.compare_value || '',
    style: row.style,
  };
}

async function getConditionalFormatsForWorksheet(txOrDb, worksheetId) {
  const rows = await txOrDb.all(
    'SELECT * FROM conditional_formats WHERE worksheet_id = ? ORDER BY id ASC',
    [worksheetId],
  );
  return (rows || []).map(mapConditionalFormat);
}

function mapCellNote(row) {
  return {
    id: row.id,
    row: row.row_number,
    column: row.column_number,
    text: row.note,
  };
}

async function getCellNotesForWorksheet(txOrDb, worksheetId) {
  const rows = await txOrDb.all(
    'SELECT * FROM cell_notes WHERE worksheet_id = ? ORDER BY row_number ASC, column_number ASC',
    [worksheetId],
  );
  return (rows || []).map(mapCellNote);
}

async function captureFilterSnapshot(tx, worksheetId) {
  const filter = await tx.get(
    'SELECT * FROM filters WHERE worksheet_id = ?',
    [worksheetId],
  );
  if (!filter) return null;
  const conditions = await tx.all(
    'SELECT * FROM filter_conditions WHERE filter_id = ? ORDER BY column_number ASC, id ASC',
    [filter.id],
  );
  return {
    startRow: filter.start_row,
    startColumn: filter.start_column,
    endRow: filter.end_row,
    endColumn: filter.end_column,
    columns: (conditions || []).map((condition) => ({
      column: condition.column_number,
      type: condition.condition_type,
      values: condition.condition_type === 'values' ? parseJsonArray(condition.selected_values) : undefined,
      value: condition.condition_type === 'values' ? undefined : condition.value || '',
    })),
  };
}

async function restoreFilterSnapshot(tx, worksheetId, snapshot) {
  await tx.run('DELETE FROM filters WHERE worksheet_id = ?', [worksheetId]);
  if (!snapshot) return;
  const result = await tx.run(
    `INSERT INTO filters (worksheet_id, start_row, start_column, end_row, end_column)
     VALUES (?, ?, ?, ?, ?)`,
    [worksheetId, snapshot.startRow, snapshot.startColumn, snapshot.endRow, snapshot.endColumn],
  );
  const filterId = result.lastID;
  for (const column of snapshot.columns || []) {
    await tx.run(
      `INSERT INTO filter_conditions (filter_id, column_number, condition_type, selected_values, value)
       VALUES (?, ?, ?, ?, ?)`,
      [
        filterId,
        column.column,
        column.type,
        column.type === 'values' ? JSON.stringify(column.values || []) : null,
        column.type === 'values' ? null : (column.value || ''),
      ],
    );
  }
}

function isNumericCellValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  return Number.isFinite(Number(String(value).trim()));
}

function isDateCellValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const parsed = Date.parse(String(value).trim());
  return Number.isFinite(parsed);
}

function compareCellValues(a, b) {
  const aBlank = a === null || a === undefined || String(a).trim() === '';
  const bBlank = b === null || b === undefined || String(b).trim() === '';
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  const aNum = isNumericCellValue(a);
  const bNum = isNumericCellValue(b);
  if (aNum && bNum) {
    const an = Number(String(a).trim());
    const bn = Number(String(b).trim());
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  }
  const aDate = isDateCellValue(a);
  const bDate = isDateCellValue(b);
  if (aDate && bDate) {
    const at = Date.parse(String(a).trim());
    const bt = Date.parse(String(b).trim());
    if (at < bt) return -1;
    if (at > bt) return 1;
    return 0;
  }
  const sa = String(a ?? '').toLowerCase();
  const sb = String(b ?? '').toLowerCase();
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function adjustFormulaForSort(formula, rowMap) {
  if (!isFormula(formula)) return formula;
  return replaceCellRefs(formula, ({ row, rowAbs, colAbs, letters, match }) => {
    if (!rowAbs && Object.prototype.hasOwnProperty.call(rowMap, row)) {
      const newRow = rowMap[row];
      return `${colAbs ? '$' : ''}${letters}${newRow}`;
    }
    return match;
  });
}


function toWorkbookSummary(row) {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    lastUpdated: formatLastUpdated(row.updated_at),
    worksheetCount: row.worksheet_count || 0,
  };
}

function mapRows(rows) {
  return rows.map((row) => ({
    row: row.row_number,
    column: row.column_number,
    value: row.value,
  }));
}

async function getPivotForWorkbook(txOrDb, workbookId) {
  const pivot = await txOrDb.get(
    'SELECT * FROM pivot_tables WHERE workbook_id = ?',
    [workbookId],
  );
  if (!pivot) return null;
  return {
    id: pivot.id,
    sourceWorksheetId: pivot.source_worksheet_id,
    resultWorksheetId: pivot.result_worksheet_id,
    startRow: pivot.start_row,
    startColumn: pivot.start_column,
    endRow: pivot.end_row,
    endColumn: pivot.end_column,
    rowField: pivot.row_field,
    columnField: pivot.column_field,
    valueField: pivot.value_field,
    summarizeBy: pivot.summarize_by,
    rowFieldHeader: pivot.row_field_header,
    columnFieldHeader: pivot.column_field_header,
    valueFieldHeader: pivot.value_field_header,
  };
}

async function getWorkbookState(id) {
  const workbook = await dbGet('SELECT * FROM workbooks WHERE id = ?', [id]);
  if (!workbook) return null;

  const worksheets = await dbAll(
    'SELECT * FROM worksheets WHERE workbook_id = ? ORDER BY position ASC, id ASC',
    [id],
  );
  const workbookPivot = await getPivotForWorkbook({ get: dbGet, all: dbAll }, id);
  const namedRanges = await getNamedRangesForWorkbook({ get: dbGet, all: dbAll }, id);
  const resolutionMap = namedRangeMap(namedRanges);

  const worksheetStates = [];
  for (const sheet of worksheets) {
    const cells = await dbAll(
      'SELECT row_number, column_number, value FROM cells WHERE worksheet_id = ? ORDER BY row_number ASC, column_number ASC',
      [sheet.id],
    );
    const displayMap = computeDisplayValues(
      cells.map((cell) => ({ row: cell.row_number, column: cell.column_number, value: cell.value })),
      sheet.row_count,
      sheet.column_count,
      resolutionMap,
    );
    const mappedCells = mapRows(cells).map((cell) => ({
      ...cell,
      displayValue: displayMap.get(`${cell.row}:${cell.column}`) ?? cell.value,
    }));
    const filter = await getFilterForWorksheet({ get: dbGet, all: dbAll }, sheet.id);
    const validations = await getValidationRulesForWorksheet({ get: dbGet, all: dbAll }, sheet.id);
    const conditionalFormats = await getConditionalFormatsForWorksheet({ get: dbGet, all: dbAll }, sheet.id);
    const notes = await getCellNotesForWorksheet({ get: dbGet, all: dbAll }, sheet.id);
    worksheetStates.push({
      id: sheet.id,
      name: sheet.name,
      position: sheet.position,
      active: sheet.id === workbook.active_worksheet_id,
      rowCount: sheet.row_count,
      columnCount: sheet.column_count,
      selectedRow: sheet.selected_row,
      selectedColumn: sheet.selected_column,
      selectedEndRow: sheet.selected_end_row || sheet.selected_row || 1,
      selectedEndColumn: sheet.selected_end_column || sheet.selected_column || 1,
      frozenRows: sheet.frozen_row_count || 0,
      frozenColumns: sheet.frozen_column_count || 0,
      cells: mappedCells,
      filter,
      validations,
      conditionalFormats,
      notes,
      pivot: workbookPivot && workbookPivot.resultWorksheetId === sheet.id ? workbookPivot : null,
    });
  }

  const filterViews = await getFilterViewsForWorkbook({ get: dbGet, all: dbAll }, id);

  return {
    id: workbook.id,
    name: workbook.name,
    updatedAt: workbook.updated_at,
    lastUpdated: formatLastUpdated(workbook.updated_at),
    activeWorksheetId: workbook.active_worksheet_id,
    canUndo: (undoStacks.get(id) || []).length > 0,
    canRedo: (redoStacks.get(id) || []).length > 0,
    filterViews,
    namedRanges,
    worksheets: worksheetStates,
  };
}

async function captureWorkbookSnapshot(tx, workbookId) {
  const workbook = await tx.get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
  if (!workbook) return null;
  const worksheets = await tx.all(
    'SELECT * FROM worksheets WHERE workbook_id = ? ORDER BY position ASC, id ASC',
    [workbookId],
  );
  const sheetSnapshots = [];
  for (const sheet of worksheets) {
    const cells = await tx.all(
      'SELECT row_number, column_number, value FROM cells WHERE worksheet_id = ? ORDER BY row_number ASC, column_number ASC',
      [sheet.id],
    );
    const filter = await captureFilterSnapshot(tx, sheet.id);
    const validations = await getValidationRulesForWorksheet(tx, sheet.id);
    const conditionalFormats = await getConditionalFormatsForWorksheet(tx, sheet.id);
    sheetSnapshots.push({
      id: sheet.id,
      name: sheet.name,
      position: sheet.position,
      rowCount: sheet.row_count,
      columnCount: sheet.column_count,
      selectedRow: sheet.selected_row,
      selectedColumn: sheet.selected_column,
      selectedEndRow: sheet.selected_end_row || sheet.selected_row || 1,
      selectedEndColumn: sheet.selected_end_column || sheet.selected_column || 1,
      frozenRows: sheet.frozen_row_count || 0,
      frozenColumns: sheet.frozen_column_count || 0,
      cells: cells.map((cell) => ({ row: cell.row_number, column: cell.column_number, value: cell.value })),
      filter,
      validations,
      conditionalFormats,
    });
  }
  const pivots = await tx.all(
    'SELECT * FROM pivot_tables WHERE workbook_id = ?',
    [workbookId],
  );
  const filterViews = await tx.all(
    'SELECT * FROM filter_views WHERE workbook_id = ? ORDER BY id ASC',
    [workbookId],
  );
  const namedRanges = await getNamedRangesForWorkbook(tx, workbookId);
  return {
    workbook: {
      id: workbook.id,
      name: workbook.name,
      updatedAt: workbook.updated_at,
      activeWorksheetId: workbook.active_worksheet_id,
    },
    worksheets: sheetSnapshots,
    filterViews: (filterViews || []).map((view) => ({
      id: view.id,
      worksheetId: view.worksheet_id,
      name: view.name,
      startRow: view.start_row,
      startColumn: view.start_column,
      endRow: view.end_row,
      endColumn: view.end_column,
      columns: parseColumnsJson(view.columns_json),
    })),
    namedRanges,
    pivots: (pivots || []).map((pivot) => ({
      id: pivot.id,
      sourceWorksheetId: pivot.source_worksheet_id,
      resultWorksheetId: pivot.result_worksheet_id,
      startRow: pivot.start_row,
      startColumn: pivot.start_column,
      endRow: pivot.end_row,
      endColumn: pivot.end_column,
      rowField: pivot.row_field,
      columnField: pivot.column_field,
      valueField: pivot.value_field,
      summarizeBy: pivot.summarize_by,
      rowFieldHeader: pivot.row_field_header,
      columnFieldHeader: pivot.column_field_header,
      valueFieldHeader: pivot.value_field_header,
    })),
  };
}

async function restoreWorkbookSnapshot(tx, workbookId, snapshot) {
  if (!snapshot) return;
  await tx.run(
    'UPDATE workbooks SET name = ?, updated_at = ?, active_worksheet_id = ? WHERE id = ?',
    [snapshot.workbook.name, nowIso(), snapshot.workbook.activeWorksheetId, workbookId],
  );
  for (const sheet of snapshot.worksheets) {
    const existing = await tx.get('SELECT id FROM worksheets WHERE id = ? AND workbook_id = ?', [sheet.id, workbookId]);
    if (!existing) {
      const result = await tx.run(
        `INSERT INTO worksheets (id, workbook_id, name, position, row_count, column_count, selected_row, selected_column, selected_end_row, selected_end_column)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sheet.id, workbookId, sheet.name, sheet.position, sheet.rowCount, sheet.columnCount, sheet.selectedRow, sheet.selectedColumn, sheet.selectedEndRow, sheet.selectedEndColumn],
      );
      // sqlite may ignore explicit id if not set; but IDs should exist.
      void result;
    } else {
      await tx.run(
        `UPDATE worksheets SET name = ?, position = ?, row_count = ?, column_count = ?, selected_row = ?, selected_column = ?, selected_end_row = ?, selected_end_column = ?, frozen_row_count = ?, frozen_column_count = ? WHERE id = ?`,
        [sheet.name, sheet.position, sheet.rowCount, sheet.columnCount, sheet.selectedRow, sheet.selectedColumn, sheet.selectedEndRow, sheet.selectedEndColumn, sheet.frozenRows || 0, sheet.frozenColumns || 0, sheet.id],
      );
    }
    await tx.run('DELETE FROM cells WHERE worksheet_id = ?', [sheet.id]);
    for (const cell of sheet.cells) {
      await tx.run(
        'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
        [sheet.id, cell.row, cell.column, cell.value],
      );
    }
    await restoreFilterSnapshot(tx, sheet.id, sheet.filter);
    await tx.run('DELETE FROM conditional_formats WHERE worksheet_id = ?', [sheet.id]);
    for (const rule of (sheet.conditionalFormats || [])) {
      await tx.run(
        `INSERT INTO conditional_formats
           (worksheet_id, start_row, start_column, end_row, end_column, condition_type, compare_value, style)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sheet.id,
          rule.startRow,
          rule.startColumn,
          rule.endRow,
          rule.endColumn,
          rule.condition,
          rule.value || '',
          rule.style,
        ],
      );
    }
    await tx.run('DELETE FROM validation_rules WHERE worksheet_id = ?', [sheet.id]);
    for (const rule of (sheet.validations || [])) {
      await tx.run(
        `INSERT INTO validation_rules
           (worksheet_id, start_row, start_column, end_row, end_column, rule_type, allowed_values, minimum, maximum, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sheet.id,
          rule.startRow,
          rule.startColumn,
          rule.endRow,
          rule.endColumn,
          rule.type,
          rule.type === 'dropdown' ? JSON.stringify(rule.allowedValues || []) : null,
          rule.type === 'number' ? rule.minimum : null,
          rule.type === 'number' ? rule.maximum : null,
          rule.errorMessage || null,
        ],
      );
    }
  }

  await tx.run('DELETE FROM pivot_tables WHERE workbook_id = ?', [workbookId]);
  for (const pivot of (snapshot.pivots || [])) {
    await tx.run(
      `INSERT INTO pivot_tables
         (workbook_id, source_worksheet_id, result_worksheet_id, start_row, start_column, end_row, end_column,
          row_field, column_field, value_field, summarize_by, row_field_header, column_field_header, value_field_header)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workbookId,
        pivot.sourceWorksheetId,
        pivot.resultWorksheetId,
        pivot.startRow,
        pivot.startColumn,
        pivot.endRow,
        pivot.endColumn,
        pivot.rowField,
        pivot.columnField,
        pivot.valueField,
        pivot.summarizeBy,
        pivot.rowFieldHeader,
        pivot.columnFieldHeader,
        pivot.valueFieldHeader,
      ],
    );
  }

  await tx.run('DELETE FROM named_ranges WHERE workbook_id = ?', [workbookId]);
  for (const namedRange of (snapshot.namedRanges || [])) {
    await tx.run(
      `INSERT INTO named_ranges (workbook_id, name, range_text) VALUES (?, ?, ?)`,
      [workbookId, namedRange.name, namedRange.range],
    );
  }

  await tx.run('DELETE FROM filter_views WHERE workbook_id = ?', [workbookId]);
  for (const view of (snapshot.filterViews || [])) {
    await tx.run(
      `INSERT INTO filter_views
         (workbook_id, worksheet_id, name, start_row, start_column, end_row, end_column, columns_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workbookId,
        view.worksheetId,
        view.name,
        view.startRow,
        view.startColumn,
        view.endRow,
        view.endColumn,
        JSON.stringify(view.columns || []),
      ],
    );
  }
}

function pushUndo(workbookId, snapshot) {
  if (!snapshot) return;
  const stack = undoStacks.get(workbookId) || [];
  stack.push(snapshot);
  undoStacks.set(workbookId, stack);
  redoStacks.delete(workbookId);
}

function clearRedo(workbookId) {
  redoStacks.delete(workbookId);
}

async function uniqueWorkbookName(get, preferredName) {
  let candidate = preferredName;
  let suffix = 2;
  while (await get('SELECT id FROM workbooks WHERE LOWER(name) = LOWER(?)', [candidate])) {
    candidate = `${preferredName} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}


async function nextSheetName(all, workbookId) {
  const sheets = await all(
    `SELECT name FROM worksheets WHERE workbook_id = ? AND name LIKE 'Sheet%'`,
    [workbookId],
  );
  const used = new Set();
  for (const sheet of sheets || []) {
    const match = /^Sheet(\d+)$/.exec(sheet.name);
    if (match) used.add(Number(match[1]));
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return `Sheet${candidate}`;
}

async function createWorksheet(workbookId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }

    const name = await nextSheetName(all, workbookId);
    const maxPosition = await get(
      'SELECT COALESCE(MAX(position), 0) AS max_position FROM worksheets WHERE workbook_id = ?',
      [workbookId],
    );
    const position = (maxPosition?.max_position || 0) + 1;

    const result = await run(
      `INSERT INTO worksheets
         (workbook_id, name, position, row_count, column_count, selected_row, selected_column)
       VALUES (?, ?, ?, 10, 10, 1, 1)`,
      [workbookId, name, position],
    );
    const worksheetId = result.lastID;

    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [worksheetId, nowIso(), workbookId],
    );

    return getWorkbookState(workbookId);
  });
}

async function renameWorksheet(workbookId, worksheetId, nextName) {
  return withTransaction(async ({ run, get }) => {
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const trimmed = normalizeWorksheetName(nextName);
    if (!trimmed) {
      const error = new Error('Worksheet name cannot be empty');
      error.status = 400;
      throw error;
    }

    if (trimmed.length > 50) {
      const error = new Error('Worksheet name must be 50 characters or fewer');
      error.status = 400;
      throw error;
    }

    const duplicate = await get(
      `SELECT id FROM worksheets
        WHERE workbook_id = ? AND id <> ? AND LOWER(name) = LOWER(?)`,
      [workbookId, worksheetId, trimmed],
    );
    if (duplicate) {
      const error = new Error('Worksheet name already exists');
      error.status = 409;
      throw error;
    }

    await run(
      'UPDATE worksheets SET name = ? WHERE id = ?',
      [trimmed, worksheetId],
    );
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );

    return getWorkbookState(workbookId);
  });
}

async function deleteWorksheet(workbookId, worksheetId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }

    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const countRow = await get(
      'SELECT COUNT(*) AS count FROM worksheets WHERE workbook_id = ?',
      [workbookId],
    );
    if ((countRow?.count || 0) <= 1) {
      const error = new Error('A workbook must contain at least one worksheet');
      error.status = 400;
      throw error;
    }

    await run('DELETE FROM worksheets WHERE id = ?', [worksheetId]);

    const remaining = await all(
      'SELECT id, position FROM worksheets WHERE workbook_id = ? ORDER BY position ASC, id ASC',
      [workbookId],
    );
    let nextActiveId = remaining[0].id;
    if (workbook.active_worksheet_id === worksheetId) {
      const remainingSheets = remaining;
      const deletedPosition = sheet.position;
      const next = remainingSheets.find((s) => s.position > deletedPosition) || remainingSheets[remainingSheets.length - 1];
      nextActiveId = next.id;
    } else {
      nextActiveId = workbook.active_worksheet_id || remaining[0].id;
    }

    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [nextActiveId, nowIso(), workbookId],
    );

    return getWorkbookState(workbookId);
  });
}

async function setActiveWorksheet(workbookId, worksheetId) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [worksheetId, nowIso(), workbookId],
    );
    return getWorkbookState(workbookId);
  });
}

async function setWorksheetSelection(workbookId, worksheetId, row, column, endRow, endColumn) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    const safeRow = Number.isInteger(row) && row >= 1 ? row : sheet.selected_row || 1;
    const safeColumn = Number.isInteger(column) && column >= 1 ? column : sheet.selected_column || 1;
    const safeEndRow = Number.isInteger(endRow) && endRow >= 1 ? endRow : safeRow;
    const safeEndColumn = Number.isInteger(endColumn) && endColumn >= 1 ? endColumn : safeColumn;
    await run(
      'UPDATE worksheets SET selected_row = ?, selected_column = ?, selected_end_row = ?, selected_end_column = ? WHERE id = ?',
      [safeRow, safeColumn, safeEndRow, safeEndColumn, worksheetId],
    );
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    return getWorkbookState(workbookId);
  });
}

async function setWorksheetFreeze(workbookId, worksheetId, rows, columns) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const nextRows = Number(rows);
    const nextColumns = Number(columns);
    const safeRows = Number.isInteger(nextRows) && nextRows >= 0
      ? Math.min(nextRows, sheet.row_count || 10)
      : 0;
    const safeColumns = Number.isInteger(nextColumns) && nextColumns >= 0
      ? Math.min(nextColumns, sheet.column_count || 10)
      : 0;

    await run(
      'UPDATE worksheets SET frozen_row_count = ?, frozen_column_count = ? WHERE id = ?',
      [safeRows, safeColumns, worksheetId],
    );
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    return getWorkbookState(workbookId);
  });
}

function normalizeNamedRangeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNamedRangeReference(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function createNamedRange(workbookId, data) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const name = normalizeNamedRangeName(data?.name);
    const range = normalizeNamedRangeReference(data?.range ?? data?.rangeText);
    if (!/^[A-Za-z]/.test(name)) {
      const error = new Error('Named range must start with a letter');
      error.status = 400;
      throw error;
    }
    if (!range) {
      const error = new Error('Range is required');
      error.status = 400;
      throw error;
    }
    await run(
      'INSERT INTO named_ranges (workbook_id, name, range_text) VALUES (?, ?, ?)',
      [workbookId, name, range],
    );
    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

async function updateNamedRange(workbookId, rangeId, data) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const existing = await get(
      'SELECT * FROM named_ranges WHERE id = ? AND workbook_id = ?',
      [rangeId, workbookId],
    );
    if (!existing) {
      const error = new Error('Named range not found');
      error.status = 404;
      throw error;
    }
    const name = data?.name === undefined ? existing.name : normalizeNamedRangeName(data.name);
    const range = data?.range === undefined && data?.rangeText === undefined
      ? existing.range_text
      : normalizeNamedRangeReference(data?.range ?? data?.rangeText);
    if (!/^[A-Za-z]/.test(name)) {
      const error = new Error('Named range must start with a letter');
      error.status = 400;
      throw error;
    }
    if (!range) {
      const error = new Error('Range is required');
      error.status = 400;
      throw error;
    }
    await run(
      'UPDATE named_ranges SET name = ?, range_text = ?, updated_at = ? WHERE id = ?',
      [name, range, nowIso(), rangeId],
    );
    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

function normalizeConditionalStyle(value) {
  const style = String(value || '').trim().toLowerCase();
  if (style === 'red' || style === 'red fill') return 'red';
  if (style === 'yellow' || style === 'yellow fill') return 'yellow';
  if (style === 'green' || style === 'green fill') return 'green';
  return '';
}

function normalizeConditionalCondition(value) {
  const condition = String(value || '').trim().toLowerCase();
  if (condition === 'greater_than' || condition === 'greater than') return 'greater_than';
  if (condition === 'text_contains' || condition === 'text contains') return 'text_contains';
  return '';
}

async function saveConditionalFormat(workbookId, worksheetId, ruleId, data) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const condition = normalizeConditionalCondition(data?.condition);
    const style = normalizeConditionalStyle(data?.style);
    const compareValue = data?.value === undefined || data?.value === null ? '' : String(data.value).trim();
    if (!condition) {
      const error = new Error('Condition is invalid');
      error.status = 400;
      throw error;
    }
    if (!style) {
      const error = new Error('Style is invalid');
      error.status = 400;
      throw error;
    }
    if (!compareValue) {
      const error = new Error('Value is required');
      error.status = 400;
      throw error;
    }

    let startRow = normalizeRangePart(data?.startRow, null, sheet.row_count || 10);
    let startColumn = normalizeRangePart(data?.startColumn, null, sheet.column_count || 10);
    let endRow = normalizeRangePart(data?.endRow, null, sheet.row_count || 10);
    let endColumn = normalizeRangePart(data?.endColumn, null, sheet.column_count || 10);
    if (startRow === null || startColumn === null || endRow === null || endColumn === null) {
      const error = new Error('Invalid conditional formatting range');
      error.status = 400;
      throw error;
    }
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    if (startColumn > endColumn) [startColumn, endColumn] = [endColumn, startColumn];

    if (ruleId) {
      const existing = await get(
        'SELECT id FROM conditional_formats WHERE id = ? AND worksheet_id = ?',
        [ruleId, worksheetId],
      );
      if (!existing) {
        const error = new Error('Conditional formatting rule not found');
        error.status = 404;
        throw error;
      }
      await run(
        `UPDATE conditional_formats
            SET start_row = ?, start_column = ?, end_row = ?, end_column = ?,
                condition_type = ?, compare_value = ?, style = ?, updated_at = ?
          WHERE id = ?`,
        [startRow, startColumn, endRow, endColumn, condition, compareValue, style, nowIso(), ruleId],
      );
    } else {
      await run(
        `INSERT INTO conditional_formats
           (worksheet_id, start_row, start_column, end_row, end_column, condition_type, compare_value, style)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [worksheetId, startRow, startColumn, endRow, endColumn, condition, compareValue, style],
      );
    }

    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

async function deleteConditionalFormat(workbookId, worksheetId, ruleId) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    const existing = await get(
      'SELECT id FROM conditional_formats WHERE id = ? AND worksheet_id = ?',
      [ruleId, worksheetId],
    );
    if (!existing) {
      const error = new Error('Conditional formatting rule not found');
      error.status = 404;
      throw error;
    }
    await run('DELETE FROM conditional_formats WHERE id = ?', [ruleId]);
    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

function normalizeCellNoteText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

async function saveCellNote(workbookId, worksheetId, noteId, data) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    let row = Number(data?.row);
    let column = Number(data?.column);
    const text = normalizeCellNoteText(data?.text ?? data?.note);

    if (noteId) {
      const existing = await get(
        'SELECT * FROM cell_notes WHERE id = ? AND worksheet_id = ?',
        [noteId, worksheetId],
      );
      if (!existing) {
        const error = new Error('Cell note not found');
        error.status = 404;
        throw error;
      }
      row = existing.row_number;
      column = existing.column_number;
      await run(
        'UPDATE cell_notes SET note = ?, updated_at = ? WHERE id = ?',
        [text, nowIso(), noteId],
      );
    } else {
      const maxRow = sheet.row_count || 10;
      const maxColumn = sheet.column_count || 10;
      if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || row > maxRow || column > maxColumn) {
        const error = new Error('Invalid cell note coordinate');
        error.status = 400;
        throw error;
      }
      const existing = await get(
        'SELECT id FROM cell_notes WHERE worksheet_id = ? AND row_number = ? AND column_number = ?',
        [worksheetId, row, column],
      );
      if (existing) {
        const error = new Error('A note already exists for this cell');
        error.status = 409;
        throw error;
      }
      await run(
        'INSERT INTO cell_notes (worksheet_id, row_number, column_number, note) VALUES (?, ?, ?, ?)',
        [worksheetId, row, column, text],
      );
    }

    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

async function deleteCellNote(workbookId, worksheetId, noteId) {
  return withTransaction(async ({ run, get }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    const existing = await get(
      'SELECT id FROM cell_notes WHERE id = ? AND worksheet_id = ?',
      [noteId, worksheetId],
    );
    if (!existing) {
      const error = new Error('Cell note not found');
      error.status = 404;
      throw error;
    }
    await run('DELETE FROM cell_notes WHERE id = ?', [noteId]);
    await run('UPDATE workbooks SET updated_at = ? WHERE id = ?', [nowIso(), workbookId]);
    return getWorkbookState(workbookId);
  });
}

async function modifyRows(workbookId, worksheetId, action, targetRow) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const row = Number(targetRow);
    if (!Number.isInteger(row) || row < 1 || row > (sheet.row_count || 10)) {
      const error = new Error('Row number is invalid');
      error.status = 400;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);

    if (action === 'insertAbove' || action === 'insertBelow') {
      const cells = await all(
        'SELECT id, row_number, column_number, value FROM cells WHERE worksheet_id = ? ORDER BY row_number DESC, column_number DESC',
        [worksheetId],
      );
      const start = action === 'insertAbove' ? row : row + 1;
      for (const cell of cells) {
        if (cell.row_number >= start) {
          await run(
            'UPDATE cells SET row_number = ? WHERE id = ?',
            [cell.row_number + 1, cell.id],
          );
        }
      }
      await run(
        'UPDATE worksheets SET row_count = row_count + 1 WHERE id = ?',
        [worksheetId],
      );
      const formulaCellsAfterRowInsert = await all(
        'SELECT id, value FROM cells WHERE worksheet_id = ?',
        [worksheetId],
      );
      for (const formulaCell of formulaCellsAfterRowInsert) {
        if (isFormula(formulaCell.value)) {
          const adjusted = adjustFormulaForRowInsert(formulaCell.value, start);
          if (adjusted !== formulaCell.value) {
            await run('UPDATE cells SET value = ? WHERE id = ?', [adjusted, formulaCell.id]);
          }
        }
      }
      await adjustValidationRulesForRowChange({ run, get, all }, worksheetId, action, row);
      await adjustPivotForRowChange({ run, get, all }, workbookId, worksheetId, action, row);
      if (sheet.selected_row >= start) {
        await run(
          'UPDATE worksheets SET selected_row = selected_row + 1, selected_end_row = selected_end_row + 1 WHERE id = ?',
          [worksheetId],
        );
      } else if (sheet.selected_end_row >= start) {
        await run(
          'UPDATE worksheets SET selected_end_row = selected_end_row + 1 WHERE id = ?',
          [worksheetId],
        );
      }
    } else if (action === 'delete') {
      if ((sheet.row_count || 1) <= 1) {
        const error = new Error('A worksheet must contain at least one row');
        error.status = 400;
        throw error;
      }
      await run(
        'DELETE FROM cells WHERE worksheet_id = ? AND row_number = ?',
        [worksheetId, row],
      );
      const cells = await all(
        'SELECT id, row_number, column_number, value FROM cells WHERE worksheet_id = ? AND row_number > ? ORDER BY row_number ASC, column_number ASC',
        [worksheetId, row],
      );
      for (const cell of cells) {
        await run(
          'UPDATE cells SET row_number = ? WHERE id = ?',
          [cell.row_number - 1, cell.id],
        );
      }
      await run(
        'UPDATE worksheets SET row_count = row_count - 1 WHERE id = ?',
        [worksheetId],
      );
      const formulaCellsAfterRowDelete = await all(
        'SELECT id, value FROM cells WHERE worksheet_id = ?',
        [worksheetId],
      );
      for (const formulaCell of formulaCellsAfterRowDelete) {
        if (isFormula(formulaCell.value)) {
          const adjusted = adjustFormulaForRowDelete(formulaCell.value, row);
          if (adjusted !== formulaCell.value) {
            await run('UPDATE cells SET value = ? WHERE id = ?', [adjusted, formulaCell.id]);
          }
        }
      }
      await adjustValidationRulesForRowChange({ run, get, all }, worksheetId, action, row);
      await adjustPivotForRowChange({ run, get, all }, workbookId, worksheetId, action, row);
      const newSelectedRow = sheet.selected_row === row
        ? Math.min(row, Math.max(1, (sheet.row_count || 1) - 1))
        : sheet.selected_row > row ? sheet.selected_row - 1 : sheet.selected_row;
      const newSelectedEndRow = sheet.selected_end_row === row
        ? Math.min(row, Math.max(1, (sheet.row_count || 1) - 1))
        : sheet.selected_end_row > row ? sheet.selected_end_row - 1 : sheet.selected_end_row;
      await run(
        'UPDATE worksheets SET selected_row = ?, selected_end_row = ? WHERE id = ?',
        [newSelectedRow, newSelectedEndRow, worksheetId],
      );
    } else {
      const error = new Error('Unknown row action');
      error.status = 400;
      throw error;
    }

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function modifyColumns(workbookId, worksheetId, action, targetColumn) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const column = Number(targetColumn);
    if (!Number.isInteger(column) || column < 1 || column > (sheet.column_count || 10)) {
      const error = new Error('Column number is invalid');
      error.status = 400;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);

    if (action === 'insertLeft' || action === 'insertRight') {
      const cells = await all(
        'SELECT id, row_number, column_number, value FROM cells WHERE worksheet_id = ? ORDER BY column_number DESC, row_number DESC',
        [worksheetId],
      );
      const start = action === 'insertLeft' ? column : column + 1;
      for (const cell of cells) {
        if (cell.column_number >= start) {
          await run(
            'UPDATE cells SET column_number = ? WHERE id = ?',
            [cell.column_number + 1, cell.id],
          );
        }
      }
      await run(
        'UPDATE worksheets SET column_count = column_count + 1 WHERE id = ?',
        [worksheetId],
      );
      const formulaCellsAfterColumnInsert = await all(
        'SELECT id, value FROM cells WHERE worksheet_id = ?',
        [worksheetId],
      );
      for (const formulaCell of formulaCellsAfterColumnInsert) {
        if (isFormula(formulaCell.value)) {
          const adjusted = adjustFormulaForColumnInsert(formulaCell.value, start);
          if (adjusted !== formulaCell.value) {
            await run('UPDATE cells SET value = ? WHERE id = ?', [adjusted, formulaCell.id]);
          }
        }
      }
      await adjustValidationRulesForColumnChange({ run, get, all }, worksheetId, action, column);
      await adjustPivotForColumnChange({ run, get, all }, workbookId, worksheetId, action, column);
      if (sheet.selected_column >= start) {
        await run(
          'UPDATE worksheets SET selected_column = selected_column + 1, selected_end_column = selected_end_column + 1 WHERE id = ?',
          [worksheetId],
        );
      } else if (sheet.selected_end_column >= start) {
        await run(
          'UPDATE worksheets SET selected_end_column = selected_end_column + 1 WHERE id = ?',
          [worksheetId],
        );
      }
    } else if (action === 'delete') {
      if ((sheet.column_count || 1) <= 1) {
        const error = new Error('A worksheet must contain at least one column');
        error.status = 400;
        throw error;
      }
      await run(
        'DELETE FROM cells WHERE worksheet_id = ? AND column_number = ?',
        [worksheetId, column],
      );
      const cells = await all(
        'SELECT id, row_number, column_number, value FROM cells WHERE worksheet_id = ? AND column_number > ? ORDER BY column_number ASC, row_number ASC',
        [worksheetId, column],
      );
      for (const cell of cells) {
        await run(
          'UPDATE cells SET column_number = ? WHERE id = ?',
          [cell.column_number - 1, cell.id],
        );
      }
      await run(
        'UPDATE worksheets SET column_count = column_count - 1 WHERE id = ?',
        [worksheetId],
      );
      const formulaCellsAfterColumnDelete = await all(
        'SELECT id, value FROM cells WHERE worksheet_id = ?',
        [worksheetId],
      );
      for (const formulaCell of formulaCellsAfterColumnDelete) {
        if (isFormula(formulaCell.value)) {
          const adjusted = adjustFormulaForColumnDelete(formulaCell.value, column);
          if (adjusted !== formulaCell.value) {
            await run('UPDATE cells SET value = ? WHERE id = ?', [adjusted, formulaCell.id]);
          }
        }
      }
      await adjustValidationRulesForColumnChange({ run, get, all }, worksheetId, action, column);
      await adjustPivotForColumnChange({ run, get, all }, workbookId, worksheetId, action, column);
      const newSelectedColumn = sheet.selected_column === column
        ? Math.min(column, Math.max(1, (sheet.column_count || 1) - 1))
        : sheet.selected_column > column ? sheet.selected_column - 1 : sheet.selected_column;
      const newSelectedEndColumn = sheet.selected_end_column === column
        ? Math.min(column, Math.max(1, (sheet.column_count || 1) - 1))
        : sheet.selected_end_column > column ? sheet.selected_end_column - 1 : sheet.selected_end_column;
      await run(
        'UPDATE worksheets SET selected_column = ?, selected_end_column = ? WHERE id = ?',
        [newSelectedColumn, newSelectedEndColumn, worksheetId],
      );
    } else {
      const error = new Error('Unknown column action');
      error.status = 400;
      throw error;
    }

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

function rangesIntersect(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

async function adjustValidationRulesForRowChange(tx, worksheetId, action, row) {
  const rules = await tx.all(
    'SELECT id, start_row, end_row FROM validation_rules WHERE worksheet_id = ?',
    [worksheetId],
  );
  if (!rules || rules.length === 0) return;
  const start = action === 'insertAbove' ? row : row + 1;
  for (const rule of rules) {
    let startRow = rule.start_row;
    let endRow = rule.end_row;
    if (action === 'insertAbove' || action === 'insertBelow') {
      if (startRow >= start) startRow += 1;
      if (endRow >= start) endRow += 1;
      await tx.run(
        'UPDATE validation_rules SET start_row = ?, end_row = ? WHERE id = ?',
        [startRow, endRow, rule.id],
      );
    } else if (action === 'delete') {
      if (startRow === row && endRow === row) {
        await tx.run('DELETE FROM validation_rules WHERE id = ?', [rule.id]);
        continue;
      }
      if (startRow > row) startRow -= 1;
      if (endRow > row) endRow -= 1;
      await tx.run(
        'UPDATE validation_rules SET start_row = ?, end_row = ? WHERE id = ?',
        [startRow, endRow, rule.id],
      );
    }
  }
}

async function adjustValidationRulesForColumnChange(tx, worksheetId, action, column) {
  const rules = await tx.all(
    'SELECT id, start_column, end_column FROM validation_rules WHERE worksheet_id = ?',
    [worksheetId],
  );
  if (!rules || rules.length === 0) return;
  const start = action === 'insertLeft' ? column : column + 1;
  for (const rule of rules) {
    let startColumn = rule.start_column;
    let endColumn = rule.end_column;
    if (action === 'insertLeft' || action === 'insertRight') {
      if (startColumn >= start) startColumn += 1;
      if (endColumn >= start) endColumn += 1;
      await tx.run(
        'UPDATE validation_rules SET start_column = ?, end_column = ? WHERE id = ?',
        [startColumn, endColumn, rule.id],
      );
    } else if (action === 'delete') {
      if (startColumn === column && endColumn === column) {
        await tx.run('DELETE FROM validation_rules WHERE id = ?', [rule.id]);
        continue;
      }
      if (startColumn > column) startColumn -= 1;
      if (endColumn > column) endColumn -= 1;
      await tx.run(
        'UPDATE validation_rules SET start_column = ?, end_column = ? WHERE id = ?',
        [startColumn, endColumn, rule.id],
      );
    }
  }
}

async function adjustPivotForRowChange(tx, workbookId, worksheetId, action, row) {
  const pivot = await tx.get(
    'SELECT * FROM pivot_tables WHERE workbook_id = ? AND source_worksheet_id = ?',
    [workbookId, worksheetId],
  );
  if (!pivot) return;

  let startRow = pivot.start_row;
  let endRow = pivot.end_row;
  const start = action === 'insertAbove' ? row : row + 1;
  if (action === 'insertAbove' || action === 'insertBelow') {
    if (startRow >= start) startRow += 1;
    if (endRow >= start) endRow += 1;
  } else if (action === 'delete') {
    if (startRow > row) startRow -= 1;
    if (endRow > row) endRow -= 1;
  }
  await tx.run(
    'UPDATE pivot_tables SET start_row = ?, end_row = ?, updated_at = ? WHERE id = ?',
    [startRow, endRow, nowIso(), pivot.id],
  );
}

async function adjustPivotForColumnChange(tx, workbookId, worksheetId, action, column) {
  const pivot = await tx.get(
    'SELECT * FROM pivot_tables WHERE workbook_id = ? AND source_worksheet_id = ?',
    [workbookId, worksheetId],
  );
  if (!pivot) return;

  let startColumn = pivot.start_column;
  let endColumn = pivot.end_column;
  let rowField = pivot.row_field;
  let columnField = pivot.column_field;
  let valueField = pivot.value_field;
  const start = action === 'insertLeft' ? column : column + 1;
  if (action === 'insertLeft' || action === 'insertRight') {
    if (startColumn >= start) startColumn += 1;
    if (endColumn >= start) endColumn += 1;
    if (rowField !== null && rowField >= start) rowField += 1;
    if (columnField !== null && columnField >= start) columnField += 1;
    if (valueField !== null && valueField >= start) valueField += 1;
  } else if (action === 'delete') {
    if (startColumn > column) startColumn -= 1;
    if (endColumn > column) endColumn -= 1;
    if (rowField === column) rowField = null;
    else if (rowField !== null && rowField > column) rowField -= 1;
    if (columnField === column) columnField = null;
    else if (columnField !== null && columnField > column) columnField -= 1;
    if (valueField === column) valueField = null;
    else if (valueField !== null && valueField > column) valueField -= 1;
  }
  await tx.run(
    `UPDATE pivot_tables
       SET start_column = ?, end_column = ?, row_field = ?, column_field = ?, value_field = ?, updated_at = ?
     WHERE id = ?`,
    [startColumn, endColumn, rowField, columnField, valueField, nowIso(), pivot.id],
  );
}

async function validateCellWrites(tx, workbookId, worksheetId, cells) {
  const rules = await tx.all(
    'SELECT * FROM validation_rules WHERE worksheet_id = ? ORDER BY id ASC',
    [worksheetId],
  );
  if (!rules || rules.length === 0) return;

  function parseAllowed(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {
      // fall through to comma-separated parsing
    }
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }

  const sheet = await tx.get(
    'SELECT row_count, column_count FROM worksheets WHERE id = ?',
    [worksheetId],
  );
  const existingCells = await tx.all(
    'SELECT row_number, column_number, value FROM cells WHERE worksheet_id = ?',
    [worksheetId],
  );
  const candidateRows = existingCells.map((cell) => ({
    row: cell.row_number,
    column: cell.column_number,
    value: cell.value,
  }));
  const overlay = new Map(candidateRows.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  for (const cell of cells) {
    const value = cell.value === undefined || cell.value === null ? '' : String(cell.value);
    overlay.set(`${cell.row}:${cell.column}`, value);
  }
  const candidateList = Array.from(overlay.entries()).map(([key, value]) => {
    const [row, column] = key.split(':').map(Number);
    return { row, column, value };
  });
  const namedRanges = await getNamedRangesForWorkbook(tx, workbookId);
  const displayMap = computeDisplayValues(candidateList, sheet.row_count, sheet.column_count, namedRangeMap(namedRanges));

  for (const cell of cells) {
    const rawValue = cell.value === undefined || cell.value === null ? '' : String(cell.value);
    if (rawValue === '') continue;
    const value = displayMap.get(`${cell.row}:${cell.column}`) ?? rawValue;
    for (const rule of rules) {
      const minRow = Math.min(rule.start_row, rule.end_row);
      const maxRow = Math.max(rule.start_row, rule.end_row);
      const minCol = Math.min(rule.start_column, rule.end_column);
      const maxCol = Math.max(rule.start_column, rule.end_column);
      if (cell.row < minRow || cell.row > maxRow || cell.column < minCol || cell.column > maxCol) {
        continue;
      }
      const customMessage = rule.error_message ? String(rule.error_message).trim() : '';
      if (rule.rule_type === 'number') {
        const numeric = Number(String(value).trim());
        const min = rule.minimum;
        const max = rule.maximum;
        if (!Number.isFinite(numeric) || (min !== null && min !== undefined && numeric < min) || (max !== null && max !== undefined && numeric > max)) {
          const standardMessage =
            min === 0 && max === 100
              ? 'Please enter a number from 0 to 100'
              : `Please enter a number between ${min} and ${max}`;
          const error = new Error(customMessage || standardMessage);
          error.status = 400;
          throw error;
        }
      } else if (rule.rule_type === 'dropdown') {
        const allowed = parseAllowed(rule.allowed_values).map((s) => s.trim());
        if (!allowed.includes(String(value).trim())) {
          const error = new Error(
            customMessage || `Please select one of the following values: ${allowed.join(', ')}`,
          );
          error.status = 400;
          throw error;
        }
      }
    }
  }
}

async function saveValidationRule(workbookId, worksheetId, data) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    let startRow = normalizeRangePart(data?.startRow, null, sheet.row_count || 10);
    let startColumn = normalizeRangePart(data?.startColumn, null, sheet.column_count || 10);
    let endRow = normalizeRangePart(data?.endRow, null, sheet.row_count || 10);
    let endColumn = normalizeRangePart(data?.endColumn, null, sheet.column_count || 10);
    if (startRow === null || startColumn === null || endRow === null || endColumn === null) {
      const error = new Error('Invalid validation range');
      error.status = 400;
      throw error;
    }
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    if (startColumn > endColumn) [startColumn, endColumn] = [endColumn, startColumn];

    const ruleType = String(data?.ruleType || data?.type || '').toLowerCase();
    if (ruleType !== 'dropdown' && ruleType !== 'number') {
      const error = new Error('Rule type is invalid');
      error.status = 400;
      throw error;
    }

    const rawErrorMessage =
      data?.errorMessage === undefined || data?.errorMessage === null
        ? ''
        : String(data.errorMessage);
    const errorMessage = rawErrorMessage.trim() || null;

    let allowedValues = [];
    let minimum = null;
    let maximum = null;
    if (ruleType === 'dropdown') {
      const raw = data?.allowedValues;
      if (Array.isArray(raw)) {
        allowedValues = raw.map((item) => String(item).trim()).filter(Boolean);
      } else {
        allowedValues = String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      }
      if (allowedValues.length === 0) {
        const error = new Error('Allowed values cannot be empty');
        error.status = 400;
        throw error;
      }
    } else {
      minimum = data?.minimum === '' || data?.minimum === null || data?.minimum === undefined ? null : Number(data.minimum);
      maximum = data?.maximum === '' || data?.maximum === null || data?.maximum === undefined ? null : Number(data.maximum);
      if (minimum === null || maximum === null || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
        const error = new Error('Minimum and maximum must be numbers');
        error.status = 400;
        throw error;
      }
      if (minimum > maximum) {
        const error = new Error('Minimum must be less than or equal to maximum');
        error.status = 400;
        throw error;
      }
    }

    const rules = await all(
      'SELECT * FROM validation_rules WHERE worksheet_id = ?',
      [worksheetId],
    );
    const overlapping = (rules || []).filter((rule) =>
      rangesIntersect(
        Math.min(rule.start_row, rule.end_row),
        Math.max(rule.start_row, rule.end_row),
        startRow,
        endRow,
      ) &&
      rangesIntersect(
        Math.min(rule.start_column, rule.end_column),
        Math.max(rule.start_column, rule.end_column),
        startColumn,
        endColumn,
      )
    );

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    for (const existing of overlapping) {
      await run('DELETE FROM validation_rules WHERE id = ?', [existing.id]);
    }

    await run(
      `INSERT INTO validation_rules
         (worksheet_id, start_row, start_column, end_row, end_column, rule_type, allowed_values, minimum, maximum, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        worksheetId,
        startRow,
        startColumn,
        endRow,
        endColumn,
        ruleType,
        ruleType === 'dropdown' ? JSON.stringify(allowedValues) : null,
        ruleType === 'number' ? minimum : null,
        ruleType === 'number' ? maximum : null,
        errorMessage,
      ],
    );

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function deleteValidationRule(workbookId, worksheetId, ruleId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    const rule = await get(
      'SELECT * FROM validation_rules WHERE id = ? AND worksheet_id = ?',
      [ruleId, worksheetId],
    );
    if (!rule) {
      const error = new Error('Validation rule not found');
      error.status = 404;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await run('DELETE FROM validation_rules WHERE id = ?', [ruleId]);
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function writeCells(workbookId, worksheetId, cells) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    if (!Array.isArray(cells) || cells.length === 0) {
      const error = new Error('No cells to write');
      error.status = 400;
      throw error;
    }
    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await validateCellWrites({ run, get, all }, workbookId, worksheetId, cells);

    for (const cell of cells) {
      const row = Number(cell?.row);
      const column = Number(cell?.column);
      if (!Number.isInteger(row) || row < 1 || row > (sheet.row_count || 10) ||
          !Number.isInteger(column) || column < 1 || column > (sheet.column_count || 10)) {
        const error = new Error('Cell coordinates are invalid');
        error.status = 400;
        throw error;
      }
      const value = cell.value === undefined || cell.value === null ? '' : String(cell.value);
      const existing = await get(
        'SELECT id FROM cells WHERE worksheet_id = ? AND row_number = ? AND column_number = ?',
        [worksheetId, row, column],
      );
      if (existing) {
        await run(
          'UPDATE cells SET value = ?, updated_at = ? WHERE id = ?',
          [value, nowIso(), existing.id],
        );
      } else {
        await run(
          'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
          [worksheetId, row, column, value],
        );
      }
    }

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}


async function sortRange(workbookId, worksheetId, range) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    let startRow = normalizeRangePart(range?.startRow, null, sheet.row_count || 10);
    let startColumn = normalizeRangePart(range?.startColumn, null, sheet.column_count || 10);
    let endRow = normalizeRangePart(range?.endRow, null, sheet.row_count || 10);
    let endColumn = normalizeRangePart(range?.endColumn, null, sheet.column_count || 10);
    if (startRow === null || startColumn === null || endRow === null || endColumn === null) {
      const error = new Error('Invalid sort range');
      error.status = 400;
      throw error;
    }
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    if (startColumn > endColumn) [startColumn, endColumn] = [endColumn, startColumn];

    const sortByColumn = Number(range?.sortByColumn);
    if (!Number.isInteger(sortByColumn) || sortByColumn < startColumn || sortByColumn > endColumn) {
      const error = new Error('Sort column is invalid');
      error.status = 400;
      throw error;
    }
    const order = String(range?.order || 'asc').toLowerCase();
    if (order !== 'asc' && order !== 'desc') {
      const error = new Error('Sort order is invalid');
      error.status = 400;
      throw error;
    }
    const hasHeader = Boolean(range?.hasHeader);

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);

    const cells = await all(
      `SELECT row_number, column_number, value FROM cells
        WHERE worksheet_id = ? AND row_number BETWEEN ? AND ? AND column_number BETWEEN ? AND ?
        ORDER BY row_number ASC, column_number ASC`,
      [worksheetId, startRow, endRow, startColumn, endColumn],
    );
    const cellMap = new Map();
    for (const cell of cells) {
      cellMap.set(`${cell.row_number}:${cell.column_number}`, cell.value);
    }

    const rows = [];
    for (let r = startRow; r <= endRow; r += 1) {
      const values = new Map();
      for (let c = startColumn; c <= endColumn; c += 1) {
        values.set(c, cellMap.get(`${r}:${c}`) ?? '');
      }
      rows.push({ row: r, values, index: r });
    }

    const dataStart = hasHeader ? startRow + 1 : startRow;
    const dataRows = rows.filter((row) => row.row >= dataStart);
    dataRows.sort((a, b) => {
      const av = a.values.get(sortByColumn) ?? '';
      const bv = b.values.get(sortByColumn) ?? '';
      const comparison = compareCellValues(av, bv);
      if (comparison !== 0) {
        const aBlank = String(av).trim() === '';
        const bBlank = String(bv).trim() === '';
        if (aBlank || bBlank) return comparison;
        return order === 'desc' ? -comparison : comparison;
      }
      return a.index - b.index;
    });

    const rowMap = {};
    if (hasHeader) rowMap[startRow] = startRow;
    let nextRow = dataStart;
    for (const item of dataRows) {
      rowMap[item.row] = nextRow;
      nextRow += 1;
    }

    await run(
      `DELETE FROM cells WHERE worksheet_id = ? AND row_number BETWEEN ? AND ? AND column_number BETWEEN ? AND ?`,
      [worksheetId, startRow, endRow, startColumn, endColumn],
    );

    for (const item of rows) {
      const newRow = rowMap[item.row] ?? item.row;
      for (let c = startColumn; c <= endColumn; c += 1) {
        const value = item.values.get(c) ?? '';
        if (value === '') continue;
        const adjusted = adjustFormulaForSort(value, rowMap);
        await run(
          'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
          [worksheetId, newRow, c, adjusted],
        );
      }
    }

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

const FILTER_TYPES = new Set(['values', 'text_contains', 'greater_than', 'before', 'is_empty', 'is_not_empty']);

async function createFilter(workbookId, worksheetId, filterData) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    let startRow = normalizeRangePart(filterData?.startRow, null, sheet.row_count || 10);
    let startColumn = normalizeRangePart(filterData?.startColumn, null, sheet.column_count || 10);
    let endRow = normalizeRangePart(filterData?.endRow, null, sheet.row_count || 10);
    let endColumn = normalizeRangePart(filterData?.endColumn, null, sheet.column_count || 10);
    if (startRow === null || startColumn === null || endRow === null || endColumn === null) {
      const error = new Error('Invalid filter range');
      error.status = 400;
      throw error;
    }
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    if (startColumn > endColumn) [startColumn, endColumn] = [endColumn, startColumn];

    const columns = Array.isArray(filterData?.columns) ? filterData.columns : [];
    for (const column of columns) {
      const colNum = Number(column?.column);
      if (!Number.isInteger(colNum) || colNum < startColumn || colNum > endColumn) {
        const error = new Error('Filter column is invalid');
        error.status = 400;
        throw error;
      }
      if (!FILTER_TYPES.has(String(column?.type))) {
        const error = new Error('Filter condition is invalid');
        error.status = 400;
        throw error;
      }
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);

    await run('DELETE FROM filters WHERE worksheet_id = ?', [worksheetId]);
    const result = await run(
      `INSERT INTO filters (worksheet_id, start_row, start_column, end_row, end_column)
       VALUES (?, ?, ?, ?, ?)`,
      [worksheetId, startRow, startColumn, endRow, endColumn],
    );
    const filterId = result.lastID;
    for (const column of columns) {
      const type = String(column.type);
      await run(
        `INSERT INTO filter_conditions (filter_id, column_number, condition_type, selected_values, value)
         VALUES (?, ?, ?, ?, ?)`,
        [
          filterId,
          Number(column.column),
          type,
          type === 'values' ? JSON.stringify(Array.isArray(column.values) ? column.values.map(String) : []) : null,
          type === 'values' ? null : (column.value === undefined || column.value === null ? '' : String(column.value)),
        ],
      );
    }

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function clearFilter(workbookId, worksheetId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await run('DELETE FROM filters WHERE worksheet_id = ?', [worksheetId]);
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function saveFilterView(workbookId, worksheetId, data) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, worksheetId);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }
    const filter = await getFilterForWorksheet({ get, all }, worksheetId);
    if (!filter) {
      const error = new Error('Create a filter before saving a view');
      error.status = 400;
      throw error;
    }

    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (!name) {
      const error = new Error('Filter view name cannot be empty');
      error.status = 400;
      throw error;
    }

    const duplicate = await get(
      'SELECT id FROM filter_views WHERE workbook_id = ? AND LOWER(TRIM(name)) = LOWER(?)',
      [workbookId, name],
    );
    if (duplicate) {
      const error = new Error('Filter view name already exists');
      error.status = 400;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await run(
      `INSERT INTO filter_views
         (workbook_id, worksheet_id, name, start_row, start_column, end_row, end_column, columns_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workbookId,
        worksheetId,
        name,
        filter.startRow,
        filter.startColumn,
        filter.endRow,
        filter.endColumn,
        JSON.stringify(filter.columns || []),
      ],
    );
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function applyFilterView(workbookId, viewId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const view = await get(
      'SELECT * FROM filter_views WHERE id = ? AND workbook_id = ?',
      [viewId, workbookId],
    );
    if (!view) {
      const error = new Error('Filter view not found');
      error.status = 404;
      throw error;
    }
    const sheet = await assertWorksheetExists({ get }, workbookId, view.worksheet_id);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await restoreFilterSnapshot(
      { run, get, all },
      view.worksheet_id,
      {
        startRow: view.start_row,
        startColumn: view.start_column,
        endRow: view.end_row,
        endColumn: view.end_column,
        columns: parseColumnsJson(view.columns_json),
      },
    );
    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [view.worksheet_id, nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function deleteFilterView(workbookId, viewId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const view = await get(
      'SELECT * FROM filter_views WHERE id = ? AND workbook_id = ?',
      [viewId, workbookId],
    );
    if (!view) {
      const error = new Error('Filter view not found');
      error.status = 404;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await run('DELETE FROM filter_views WHERE id = ?', [viewId]);
    await run('DELETE FROM filters WHERE worksheet_id = ?', [view.worksheet_id]);
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function undoWorkbook(workbookId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const undoStack = undoStacks.get(workbookId) || [];
    if (undoStack.length === 0) {
      const error = new Error('Nothing to undo');
      error.status = 400;
      throw error;
    }
    const snapshot = undoStack.pop();
    const current = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    const redoStack = redoStacks.get(workbookId) || [];
    redoStack.push(current);
    redoStacks.set(workbookId, redoStack);
    await restoreWorkbookSnapshot({ run, get, all }, workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function redoWorkbook(workbookId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const redoStack = redoStacks.get(workbookId) || [];
    if (redoStack.length === 0) {
      const error = new Error('Nothing to redo');
      error.status = 400;
      throw error;
    }
    const snapshot = redoStack.pop();
    const current = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    const undoStack = undoStacks.get(workbookId) || [];
    undoStack.push(current);
    undoStacks.set(workbookId, undoStack);
    await restoreWorkbookSnapshot({ run, get, all }, workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function createWorkbook(name) {
  return withTransaction(async ({ run, get }) => {
    const preferredName = name || DEFAULT_NEW_WORKBOOK_NAME;
    const workbookName = await uniqueWorkbookName(get, preferredName);

    const workbookResult = await run(
      'INSERT INTO workbooks (name, updated_at) VALUES (?, ?)',
      [workbookName, nowIso()],
    );
    const workbookId = workbookResult.lastID;

    const sheetResult = await run(
      'INSERT INTO worksheets (workbook_id, name, position) VALUES (?, ?, ?)',
      [workbookId, 'Sheet1', 1],
    );
    const worksheetId = sheetResult.lastID;

    await run('UPDATE workbooks SET active_worksheet_id = ? WHERE id = ?', [worksheetId, workbookId]);

    return getWorkbookState(workbookId);
  });
}

async function renameWorkbook(id, nextName) {
  return withTransaction(async ({ run, get }) => {
    const current = await get('SELECT * FROM workbooks WHERE id = ?', [id]);
    if (!current) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }

    const trimmed = normalizeWorkbookName(nextName);
    if (!trimmed) {
      const error = new Error('Workbook name cannot be empty');
      error.status = 400;
      throw error;
    }

    if (trimmed.length > 80) {
      const error = new Error('Workbook name must be 80 characters or fewer');
      error.status = 400;
      throw error;
    }

    const duplicate = await get(
      'SELECT id FROM workbooks WHERE LOWER(name) = LOWER(?) AND id <> ?',
      [trimmed, id],
    );
    if (duplicate) {
      const error = new Error('Workbook name already exists');
      error.status = 409;
      throw error;
    }

    await run(
      'UPDATE workbooks SET name = ?, updated_at = ? WHERE id = ?',
      [trimmed, nowIso(), id],
    );

    return getWorkbookState(id);
  });
}

async function importCsv(fileName, content) {
  const rows = parseCsv(content);

  const baseName = String(fileName || 'import.csv').replace(/\.csv$/i, '').trim() || 'Imported workbook';

  return withTransaction(async ({ run, get }) => {
    const workbookName = await uniqueWorkbookName(get, baseName);

    const workbookResult = await run(
      'INSERT INTO workbooks (name, updated_at) VALUES (?, ?)',
      [workbookName, nowIso()],
    );
    const workbookId = workbookResult.lastID;

    const sheetResult = await run(
      'INSERT INTO worksheets (workbook_id, name, position) VALUES (?, ?, ?)',
      [workbookId, 'Sheet1', 1],
    );
    const worksheetId = sheetResult.lastID;

    for (let r = 0; r < rows.length; r += 1) {
      const rowValues = rows[r];
      for (let c = 0; c < rowValues.length; c += 1) {
        const value = rowValues[c];
        if (value === '') continue;
        await run(
          'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
          [worksheetId, r + 1, c + 1, value],
        );
      }
    }

    const maxRow = Math.max(10, rows.length);
    const maxColumn = Math.max(10, ...rows.map((row) => row.length));
    await run(
      'UPDATE worksheets SET row_count = ?, column_count = ? WHERE id = ?',
      [maxRow, maxColumn, worksheetId],
    );

    await run('UPDATE workbooks SET active_worksheet_id = ? WHERE id = ?', [worksheetId, workbookId]);

    return getWorkbookState(workbookId);
  });
}

async function exportWorksheet(workbookId, worksheetId) {
  return withTransaction(async ({ get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }

    const targetWorksheetId = worksheetId || workbook.active_worksheet_id;
    const sheet = await get('SELECT * FROM worksheets WHERE id = ? AND workbook_id = ?', [targetWorksheetId, workbookId]);
    if (!sheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    const cells = await all(
      'SELECT row_number, column_number, value FROM cells WHERE worksheet_id = ? ORDER BY row_number ASC, column_number ASC',
      [sheet.id],
    );

    let maxRow = 0;
    let maxCol = 0;
    const cellMap = new Map();
    for (const cell of cells) {
      maxRow = Math.max(maxRow, cell.row_number);
      maxCol = Math.max(maxCol, cell.column_number);
      cellMap.set(`${cell.row_number}:${cell.column_number}`, cell.value);
    }

    const rows = [];
    for (let r = 1; r <= maxRow; r += 1) {
      const row = [];
      for (let c = 1; c <= maxCol; c += 1) {
        row.push(cellMap.get(`${r}:${c}`) ?? '');
      }
      rows.push(row);
    }

    return {
      fileName: `${sheet.name}.csv`,
      content: serializeCsv(rows),
      sheet,
    };
  });
}


async function nextPivotName(all, workbookId) {
  const sheets = await all(
    `SELECT name FROM worksheets WHERE workbook_id = ? AND name LIKE 'Pivot%'`,
    [workbookId],
  );
  const used = new Set();
  for (const sheet of sheets || []) {
    const match = /^Pivot(\d+)$/.exec(sheet.name);
    if (match) used.add(Number(match[1]));
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return `Pivot${candidate}`;
}

function parsePivotNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function formatPivotNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(10)));
}

function parseNumericValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function isNonEmptyValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

async function getPivotForWorkbookTx(tx, workbookId) {
  return tx.get('SELECT * FROM pivot_tables WHERE workbook_id = ?', [workbookId]);
}

async function computePivotTable(tx, pivot) {
  const sourceSheet = await tx.get(
    'SELECT * FROM worksheets WHERE id = ?',
    [pivot.source_worksheet_id],
  );
  if (!sourceSheet) {
    const error = new Error('Pivot source worksheet is no longer available.');
    error.status = 400;
    throw error;
  }

  const startRow = pivot.start_row;
  const startColumn = pivot.start_column;
  const endRow = pivot.end_row;
  const endColumn = pivot.end_column;
  if (
    !Number.isInteger(startRow) || !Number.isInteger(startColumn) ||
    !Number.isInteger(endRow) || !Number.isInteger(endColumn) ||
    startRow < 1 || startColumn < 1 ||
    endRow < startRow || endColumn < startColumn ||
    endRow > (sourceSheet.row_count || 10) || endColumn > (sourceSheet.column_count || 10)
  ) {
    const error = new Error('Invalid pivot source range.');
    error.status = 400;
    throw error;
  }

  const rows = await tx.all(
    `SELECT * FROM cells
       WHERE worksheet_id = ? AND row_number BETWEEN ? AND ? AND column_number BETWEEN ? AND ?`,
    [pivot.source_worksheet_id, startRow, endRow, startColumn, endColumn],
  );
  const cellMap = new Map();
  for (const cell of rows) {
    cellMap.set(`${cell.row_number}:${cell.column_number}`, cell.value);
  }

  function headerForColumn(column) {
    return cellMap.get(`${startRow}:${column}`) ?? '';
  }

  const rowField = pivot.row_field;
  const columnField = pivot.column_field;
  const valueField = pivot.value_field;
  const summarizeBy = (pivot.summarize_by || '').toUpperCase();

  const fieldChecks = [
    { label: 'row field', field: rowField, header: pivot.row_field_header },
    { label: 'column field', field: columnField, header: pivot.column_field_header },
    { label: 'value field', field: valueField, header: pivot.value_field_header },
  ];
  for (const check of fieldChecks) {
    if (check.field === null || check.field === undefined) continue;
    if (check.field < startColumn || check.field > endColumn) {
      const error = new Error('Pivot field is no longer available. Select a new field.');
      error.status = 400;
      throw error;
    }
    const currentHeader = headerForColumn(check.field);
    if (check.header && currentHeader !== check.header) {
      const error = new Error('Pivot field is no longer available. Select a new field.');
      error.status = 400;
      throw error;
    }
  }

  if (rowField === null || rowField === undefined || valueField === null || valueField === undefined) {
    const error = new Error('Pivot configuration is incomplete. Select row and value fields.');
    error.status = 400;
    throw error;
  }
  if (summarizeBy !== 'SUM' && summarizeBy !== 'COUNT' && summarizeBy !== 'AVERAGE') {
    const error = new Error('Summarize by is invalid.');
    error.status = 400;
    throw error;
  }

  const rowHeader = headerForColumn(rowField);
  const valueHeader = headerForColumn(valueField);
  const records = [];
  for (let r = startRow + 1; r <= endRow; r += 1) {
    const rowKey = cellMap.get(`${r}:${rowField}`) ?? '';
    const colKey = columnField === null || columnField === undefined ? null : (cellMap.get(`${r}:${columnField}`) ?? '');
    const rawValue = cellMap.get(`${r}:${valueField}`) ?? '';
    records.push({ rowKey: String(rowKey), colKey: colKey === null ? null : String(colKey), value: rawValue });
  }

  const rowOrder = [];
  for (const record of records) {
    if (!rowOrder.includes(record.rowKey)) rowOrder.push(record.rowKey);
  }
  const colOrder = [];
  if (columnField !== null && columnField !== undefined) {
    for (const record of records) {
      if (record.colKey !== null && !colOrder.includes(record.colKey)) colOrder.push(record.colKey);
    }
  }

  const allValueNumbers = records.map((record) => parseNumericValue(record.value)).filter((n) => n !== null);
  if (summarizeBy !== 'COUNT' && allValueNumbers.length === 0) {
    const error = new Error('Value field requires numeric values');
    error.status = 400;
    throw error;
  }

  function aggregateValues(values) {
    if (summarizeBy === 'COUNT') {
      return values.filter(isNonEmptyValue).length;
    }
    const numbers = values.map(parseNumericValue).filter((n) => n !== null);
    if (summarizeBy === 'AVERAGE') {
      if (numbers.length === 0) return '';
      return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    }
    return numbers.reduce((sum, n) => sum + n, 0);
  }

  function aggregateAll() {
    return aggregateValues(records.map((record) => record.value));
  }

  function aggregateGroup(rowKey, colKey) {
    const group = records.filter((record) => record.rowKey === rowKey && record.colKey === colKey);
    if (group.length === 0) {
      if (summarizeBy === 'AVERAGE') return '';
      return 0;
    }
    return aggregateValues(group.map((record) => record.value));
  }

  function aggregateRow(rowKey) {
    return aggregateValues(records.filter((record) => record.rowKey === rowKey).map((record) => record.value));
  }

  function aggregateColumn(colKey) {
    return aggregateValues(records.filter((record) => record.colKey === colKey).map((record) => record.value));
  }

  const outputCells = [];
  if (columnField === null || columnField === undefined) {
    outputCells.push({ row: 1, column: 1, value: rowHeader });
    outputCells.push({ row: 1, column: 2, value: `${summarizeBy} of ${valueHeader}` });
    let row = 2;
    for (const rowKey of rowOrder) {
      outputCells.push({ row, column: 1, value: rowKey });
      const value = aggregateGroup(rowKey, null);
      if (value !== '') outputCells.push({ row, column: 2, value: formatPivotNumber(value) });
      row += 1;
    }
    const grandTotal = aggregateAll();
    outputCells.push({ row, column: 1, value: 'Grand Total' });
    if (grandTotal !== '') outputCells.push({ row, column: 2, value: formatPivotNumber(grandTotal) });
    return { cells: outputCells, rowCount: row, columnCount: 2 };
  }

  outputCells.push({ row: 1, column: 1, value: rowHeader });
  let col = 2;
  for (const colKey of colOrder) {
    outputCells.push({ row: 1, column: col, value: colKey });
    col += 1;
  }
  outputCells.push({ row: 1, column: col, value: 'Grand Total' });

  let row = 2;
  for (const rowKey of rowOrder) {
    outputCells.push({ row, column: 1, value: rowKey });
    let c = 2;
    for (const colKey of colOrder) {
      const value = aggregateGroup(rowKey, colKey);
      if (value !== '') outputCells.push({ row, column: c, value: formatPivotNumber(value) });
      c += 1;
    }
    const rowTotal = aggregateRow(rowKey);
    outputCells.push({ row, column: c, value: formatPivotNumber(rowTotal) });
    row += 1;
  }

  outputCells.push({ row, column: 1, value: 'Grand Total' });
  let c = 2;
  for (const colKey of colOrder) {
    const colTotal = aggregateColumn(colKey);
    outputCells.push({ row, column: c, value: formatPivotNumber(colTotal) });
    c += 1;
  }
  const grandTotal = aggregateAll();
  outputCells.push({ row, column: c, value: formatPivotNumber(grandTotal) });

  return { cells: outputCells, rowCount: row, columnCount: c };
}

async function replacePivotResults(tx, pivotId, resultWorksheetId, result) {
  await tx.run('DELETE FROM cells WHERE worksheet_id = ?', [resultWorksheetId]);
  for (const cell of result.cells) {
    await tx.run(
      'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
      [resultWorksheetId, cell.row, cell.column, cell.value],
    );
  }
  await tx.run(
    'UPDATE worksheets SET row_count = ?, column_count = ? WHERE id = ?',
    [Math.max(10, result.rowCount), Math.max(10, result.columnCount), resultWorksheetId],
  );
  await tx.run('UPDATE pivot_tables SET updated_at = ? WHERE id = ?', [nowIso(), pivotId]);
}

async function createPivotTable(workbookId, data) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const sourceSheet = await assertWorksheetExists({ get }, workbookId, data?.sourceWorksheetId);
    if (!sourceSheet) {
      const error = new Error('Worksheet not found');
      error.status = 404;
      throw error;
    }

    let startRow = normalizeRangePart(data?.startRow, null, sourceSheet.row_count || 10);
    let startColumn = normalizeRangePart(data?.startColumn, null, sourceSheet.column_count || 10);
    let endRow = normalizeRangePart(data?.endRow, null, sourceSheet.row_count || 10);
    let endColumn = normalizeRangePart(data?.endColumn, null, sourceSheet.column_count || 10);
    if (startRow === null || startColumn === null || endRow === null || endColumn === null) {
      const error = new Error('Invalid pivot source range');
      error.status = 400;
      throw error;
    }
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    if (startColumn > endColumn) [startColumn, endColumn] = [endColumn, startColumn];

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    let pivot = await getPivotForWorkbookTx({ get }, workbookId);
    let resultWorksheetId;
    if (pivot) {
      resultWorksheetId = pivot.result_worksheet_id;
      await run(
        `UPDATE pivot_tables
           SET source_worksheet_id = ?, start_row = ?, start_column = ?, end_row = ?, end_column = ?,
               row_field = NULL, column_field = NULL, value_field = NULL,
               summarize_by = NULL, row_field_header = NULL, column_field_header = NULL, value_field_header = NULL,
               updated_at = ?
         WHERE id = ?`,
        [sourceSheet.id, startRow, startColumn, endRow, endColumn, nowIso(), pivot.id],
      );
      await run('DELETE FROM cells WHERE worksheet_id = ?', [resultWorksheetId]);
    } else {
      const name = await nextPivotName(all, workbookId);
      const maxPosition = await get(
        'SELECT COALESCE(MAX(position), 0) AS max_position FROM worksheets WHERE workbook_id = ?',
        [workbookId],
      );
      const position = (maxPosition?.max_position || 0) + 1;
      const sheetResult = await run(
        `INSERT INTO worksheets (workbook_id, name, position, row_count, column_count, selected_row, selected_column)
         VALUES (?, ?, ?, 10, 10, 1, 1)`,
        [workbookId, name, position],
      );
      resultWorksheetId = sheetResult.lastID;
      await run(
        `INSERT INTO pivot_tables
           (workbook_id, source_worksheet_id, result_worksheet_id, start_row, start_column, end_row, end_column)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [workbookId, sourceSheet.id, resultWorksheetId, startRow, startColumn, endRow, endColumn],
      );
    }

    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [resultWorksheetId, nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function applyPivotTable(workbookId, data) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const pivot = await getPivotForWorkbookTx({ get }, workbookId);
    if (!pivot) {
      const error = new Error('Pivot table not found');
      error.status = 404;
      throw error;
    }

    const rowField = parsePivotNumber(data?.rowField);
    const columnField = data?.columnField === null || data?.columnField === undefined || data?.columnField === '' ? null : parsePivotNumber(data.columnField);
    const valueField = parsePivotNumber(data?.valueField);
    const summarizeBy = String(data?.summarizeBy || '').toUpperCase();
    if (rowField === null || valueField === null || !['SUM', 'COUNT', 'AVERAGE'].includes(summarizeBy)) {
      const error = new Error('Pivot configuration is incomplete. Select row, value, and summarize by fields.');
      error.status = 400;
      throw error;
    }

    const sourceSheet = await get('SELECT * FROM worksheets WHERE id = ? AND workbook_id = ?', [pivot.source_worksheet_id, workbookId]);
    if (!sourceSheet) {
      const error = new Error('Pivot source worksheet is no longer available.');
      error.status = 400;
      throw error;
    }

    const sourceRows = await all(
      `SELECT * FROM cells
         WHERE worksheet_id = ? AND row_number BETWEEN ? AND ? AND column_number BETWEEN ? AND ?`,
      [pivot.source_worksheet_id, pivot.start_row, pivot.end_row, pivot.start_column, pivot.end_column],
    );
    const sourceMap = new Map(sourceRows.map((cell) => [`${cell.row_number}:${cell.column_number}`, cell.value]));
    const header = (column) => sourceMap.get(`${pivot.start_row}:${column}`) ?? '';

    const rowFieldHeader = header(rowField);
    const columnFieldHeader = columnField === null ? null : header(columnField);
    const valueFieldHeader = header(valueField);
    if (!rowFieldHeader || !valueFieldHeader || (columnField !== null && !columnFieldHeader)) {
      const error = new Error('Pivot field is no longer available. Select a new field.');
      error.status = 400;
      throw error;
    }

    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    await run(
      `UPDATE pivot_tables
         SET row_field = ?, column_field = ?, value_field = ?, summarize_by = ?,
             row_field_header = ?, column_field_header = ?, value_field_header = ?, updated_at = ?
       WHERE id = ?`,
      [rowField, columnField, valueField, summarizeBy, rowFieldHeader, columnFieldHeader, valueFieldHeader, nowIso(), pivot.id],
    );

    const updatedPivot = await getPivotForWorkbookTx({ get }, workbookId);
    const result = await computePivotTable({ get, all }, updatedPivot);
    await replacePivotResults({ run, get, all }, pivot.id, pivot.result_worksheet_id, result);

    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

async function refreshPivotTable(workbookId) {
  return withTransaction(async ({ run, get, all }) => {
    const workbook = await get('SELECT * FROM workbooks WHERE id = ?', [workbookId]);
    if (!workbook) {
      const error = new Error('Workbook not found');
      error.status = 404;
      throw error;
    }
    const pivot = await getPivotForWorkbookTx({ get }, workbookId);
    if (!pivot) {
      const error = new Error('Pivot table not found');
      error.status = 404;
      throw error;
    }
    const missingConfiguredField =
      (pivot.row_field_header && pivot.row_field === null) ||
      (pivot.value_field_header && pivot.value_field === null) ||
      (pivot.column_field_header && pivot.column_field === null);
    if (missingConfiguredField) {
      const error = new Error('Pivot field is no longer available. Select a new field.');
      error.status = 400;
      throw error;
    }
    if (pivot.row_field === null || pivot.value_field === null || !pivot.summarize_by) {
      const error = new Error('Pivot configuration is incomplete. Select row and value fields.');
      error.status = 400;
      throw error;
    }
    const snapshot = await captureWorkbookSnapshot({ run, get, all }, workbookId);
    const result = await computePivotTable({ get, all }, pivot);
    await replacePivotResults({ run, get, all }, pivot.id, pivot.result_worksheet_id, result);
    await run(
      'UPDATE workbooks SET updated_at = ? WHERE id = ?',
      [nowIso(), workbookId],
    );
    pushUndo(workbookId, snapshot);
    return getWorkbookState(workbookId);
  });
}

router.get('/', async (req, res) => {
  try {
    const { all } = require('../database/db_runtime');
    const rows = await all(
      `SELECT w.*,
              (SELECT COUNT(*) FROM worksheets ws WHERE ws.workbook_id = w.id) AS worksheet_count
         FROM workbooks w
        ORDER BY w.updated_at DESC, w.id DESC`,
    );
    res.json({ workbooks: rows.map(toWorkbookSummary) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = normalizeWorkbookName(req.body?.name);
    const workbook = await createWorkbook(name);
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { fileName, content } = req.body || {};
    if (typeof content !== 'string') {
      res.status(400).json({ error: INVALID_CSV_MESSAGE });
      return;
    }
    const workbook = await importCsv(fileName, content);
    res.status(201).json({ workbook });
  } catch (error) {
    if (error instanceof CsvParseError || error.csvInvalid) {
      res.status(400).json({ error: INVALID_CSV_MESSAGE });
      return;
    }
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await getWorkbookState(id);
    if (!workbook) {
      res.status(404).json({ error: 'Workbook not found' });
      return;
    }
    res.json({ workbook });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pivot', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await createPivotTable(id, req.body || {});
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/pivot/apply', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await applyPivotTable(id, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/pivot/refresh', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await refreshPivotTable(id);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = normalizeWorkbookName(req.body?.name);
    const workbook = await renameWorkbook(id, name);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});


router.post('/:id/worksheets', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await createWorksheet(id);
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const name = normalizeWorksheetName(req.body?.name);
    const workbook = await renameWorksheet(id, worksheetId, name);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/worksheets/:worksheetId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await deleteWorksheet(id, worksheetId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/active-worksheet', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.body?.worksheetId);
    const workbook = await setActiveWorksheet(id, worksheetId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/selection', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const row = Number(req.body?.row);
    const column = Number(req.body?.column);
    const endRow = Number(req.body?.endRow);
    const endColumn = Number(req.body?.endColumn);
    const workbook = await setWorksheetSelection(id, worksheetId, row, column, endRow, endColumn);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/freeze', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await setWorksheetFreeze(id, worksheetId, req.body?.rows, req.body?.columns);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/named-ranges', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await createNamedRange(id, req.body || {});
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/named-ranges/:rangeId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rangeId = Number(req.params.rangeId);
    const workbook = await updateNamedRange(id, rangeId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/conditional-formats', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await saveConditionalFormat(id, worksheetId, null, req.body || {});
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/conditional-formats/:ruleId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const ruleId = Number(req.params.ruleId);
    const workbook = await saveConditionalFormat(id, worksheetId, ruleId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/worksheets/:worksheetId/conditional-formats/:ruleId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const ruleId = Number(req.params.ruleId);
    const workbook = await deleteConditionalFormat(id, worksheetId, ruleId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/cell-notes', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await saveCellNote(id, worksheetId, null, req.body || {});
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/cell-notes/:noteId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const noteId = Number(req.params.noteId);
    const workbook = await saveCellNote(id, worksheetId, noteId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/worksheets/:worksheetId/cell-notes/:noteId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const noteId = Number(req.params.noteId);
    const workbook = await deleteCellNote(id, worksheetId, noteId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/rows', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const { action, row } = req.body || {};
    const workbook = await modifyRows(id, worksheetId, action, row);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/columns', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const { action, column } = req.body || {};
    const workbook = await modifyColumns(id, worksheetId, action, column);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/validation', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await saveValidationRule(id, worksheetId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/worksheets/:worksheetId/validation/:ruleId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const ruleId = Number(req.params.ruleId);
    const workbook = await deleteValidationRule(id, worksheetId, ruleId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/cells/:row/:column', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const row = Number(req.params.row);
    const column = Number(req.params.column);
    const value = req.body?.value;
    const workbook = await writeCells(id, worksheetId, [{ row, column, value }]);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id/worksheets/:worksheetId/cells', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const cells = req.body?.cells;
    const workbook = await writeCells(id, worksheetId, cells);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/sort', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await sortRange(id, worksheetId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/worksheets/:worksheetId/filter', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await createFilter(id, worksheetId, req.body || {});
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/worksheets/:worksheetId/filter', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.params.worksheetId);
    const workbook = await clearFilter(id, worksheetId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/filter-views', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = Number(req.body?.worksheetId);
    const workbook = await saveFilterView(id, worksheetId, req.body || {});
    res.status(201).json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/filter-views/:viewId/apply', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const viewId = Number(req.params.viewId);
    const workbook = await applyFilterView(id, viewId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/filter-views/:viewId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const viewId = Number(req.params.viewId);
    const workbook = await deleteFilterView(id, viewId);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/undo', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await undoWorkbook(id);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/:id/redo', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const workbook = await redoWorkbook(id);
    res.json({ workbook });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const worksheetId = req.query.worksheetId ? Number(req.query.worksheetId) : null;
    const result = await exportWorksheet(id, worksheetId);
    const safeFileName = result.fileName.replace(/[^a-z0-9\-_. ]/gi, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName}"`,
    );
    res.send(result.content);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.parseCsv = parseCsv;
module.exports.serializeCsv = serializeCsv;
module.exports.createWorkbook = createWorkbook;
module.exports.importCsv = importCsv;
module.exports.renameWorkbook = renameWorkbook;
module.exports.getWorkbookState = getWorkbookState;
module.exports.saveCellNote = saveCellNote;
module.exports.deleteCellNote = deleteCellNote;
module.exports.createWorksheet = createWorksheet;
module.exports.renameWorksheet = renameWorksheet;
module.exports.deleteWorksheet = deleteWorksheet;
module.exports.setActiveWorksheet = setActiveWorksheet;
module.exports.setWorksheetSelection = setWorksheetSelection;
module.exports.modifyRows = modifyRows;
module.exports.modifyColumns = modifyColumns;
module.exports.writeCells = writeCells;
module.exports.saveValidationRule = saveValidationRule;
module.exports.deleteValidationRule = deleteValidationRule;
module.exports.sortRange = sortRange;
module.exports.createFilter = createFilter;
module.exports.clearFilter = clearFilter;
module.exports.saveFilterView = saveFilterView;
module.exports.applyFilterView = applyFilterView;
module.exports.deleteFilterView = deleteFilterView;
module.exports.undoWorkbook = undoWorkbook;
module.exports.redoWorkbook = redoWorkbook;
module.exports.createPivotTable = createPivotTable;
module.exports.applyPivotTable = applyPivotTable;
module.exports.refreshPivotTable = refreshPivotTable;
