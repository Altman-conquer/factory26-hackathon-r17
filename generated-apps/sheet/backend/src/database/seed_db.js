const { closeDb } = require('./init_db');
const { withTransaction } = require('./db_runtime');
const { seedEvolutionWorkbooks } = require('./evolution_seed');

const SEED_UPDATED_AT = '2026-01-15T09:30:00.000Z';
const SEED_KEY = 'q3-sales';

const SEED_SHEETS = [
  { name: 'Sheet1', position: 1 },
  { name: 'Sheet2', position: 2 },
];

const SEED_CELLS = [
  { row: 1, column: 1, value: 'Region' },
  { row: 1, column: 2, value: 'Sales' },
  { row: 1, column: 3, value: 'Status' },
  { row: 2, column: 1, value: 'East' },
  { row: 2, column: 2, value: '1200' },
  { row: 2, column: 3, value: 'Open' },
  { row: 3, column: 1, value: 'North' },
  { row: 3, column: 2, value: '800' },
  { row: 3, column: 3, value: 'Closed' },
  { row: 4, column: 1, value: 'South' },
  { row: 4, column: 2, value: '700' },
  { row: 4, column: 3, value: 'Open' },
];

async function ensureCell(tx, worksheetId, row, column, value) {
  const existing = await tx.get(
    'SELECT id FROM cells WHERE worksheet_id = ? AND row_number = ? AND column_number = ?',
    [worksheetId, row, column],
  );
  if (existing) {
    await tx.run('UPDATE cells SET value = ? WHERE id = ?', [value, existing.id]);
  } else {
    await tx.run(
      'INSERT INTO cells (worksheet_id, row_number, column_number, value) VALUES (?, ?, ?, ?)',
      [worksheetId, row, column, value],
    );
  }
}

async function seedDatabase() {
  return withTransaction(async ({ run, get }) => {
    let workbook = await get('SELECT id FROM workbooks WHERE seed_key = ?', [SEED_KEY]);

    if (!workbook) {
      // Backward compatibility with databases seeded before the seed_key column existed.
      workbook = await get('SELECT id FROM workbooks WHERE name = ?', ['Q3 Sales']);
      if (workbook) {
        await run('UPDATE workbooks SET seed_key = ? WHERE id = ?', [SEED_KEY, workbook.id]);
      } else {
        const result = await run(
          'INSERT INTO workbooks (name, updated_at, seed_key) VALUES (?, ?, ?)',
          ['Q3 Sales', SEED_UPDATED_AT, SEED_KEY],
        );
        workbook = { id: result.lastID };
      }
    }

    const workbookId = workbook.id;
    let firstSheetId = null;

    for (const sheetSeed of SEED_SHEETS) {
      let sheet = await get(
        'SELECT id FROM worksheets WHERE workbook_id = ? AND name = ?',
        [workbookId, sheetSeed.name],
      );

      let worksheetId;
      if (sheet) {
        worksheetId = sheet.id;
        await run(
          `UPDATE worksheets
             SET name = ?, position = ?, row_count = 10, column_count = 10,
                 selected_row = 1, selected_column = 1,
                 selected_end_row = 1, selected_end_column = 1
           WHERE id = ?`,
          [sheetSeed.name, sheetSeed.position, worksheetId],
        );
      } else {
        const result = await run(
          `INSERT INTO worksheets
             (workbook_id, name, position, row_count, column_count, selected_row, selected_column, selected_end_row, selected_end_column)
           VALUES (?, ?, ?, 10, 10, 1, 1, 1, 1)`,
          [workbookId, sheetSeed.name, sheetSeed.position],
        );
        worksheetId = result.lastID;
      }

      if (!firstSheetId) firstSheetId = worksheetId;

      for (const cellSeed of SEED_CELLS) {
        await ensureCell({ run, get }, worksheetId, cellSeed.row, cellSeed.column, cellSeed.value);
      }
    }

    await run(
      'UPDATE workbooks SET active_worksheet_id = ?, updated_at = ? WHERE id = ?',
      [firstSheetId, SEED_UPDATED_AT, workbookId],
    );

    await seedEvolutionWorkbooks({ run, get });

    return { workbookId, worksheetId: firstSheetId };
  });
}

if (require.main === module) {
  seedDatabase()
    .then(() => closeDb())
    .catch((error) => {
      console.error('Database seed failed:', error);
      process.exitCode = 1;
    });
}

module.exports = seedDatabase;
module.exports.seedDatabase = seedDatabase;
module.exports.seed = seedDatabase;
