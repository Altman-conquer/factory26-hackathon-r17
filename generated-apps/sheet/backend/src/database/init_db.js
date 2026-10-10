const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_DB_FILENAME = 'database.db';

let db = null;
let initPromise = null;
let currentDbPath = resolveDbPath(
  process.env.ARC_DB_FILE || process.env.DATABASE_FILE || DEFAULT_DB_FILENAME,
);

function resolveDbPath(inputPath = DEFAULT_DB_FILENAME) {
  const candidate = String(inputPath || DEFAULT_DB_FILENAME).trim() || DEFAULT_DB_FILENAME;
  return path.resolve(process.cwd(), candidate);
}

function ensureDbDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getDbPath() {
  return currentDbPath;
}

async function setDbPath(nextPath) {
  const resolvedPath = resolveDbPath(nextPath);
  if (resolvedPath === currentDbPath) {
    return currentDbPath;
  }

  await closeDb();
  currentDbPath = resolvedPath;
  return currentDbPath;
}

function getDb() {
  if (!db) {
    ensureDbDirectory(currentDbPath);
    db = new sqlite3.Database(currentDbPath);
  }
  return db;
}

async function addColumnIfMissing(database, tableName, columnName, columnType) {
  const columns = await new Promise((resolve, reject) => {
    database.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
  if (!columns.some((column) => column.name === columnName)) {
    await runStatement(database, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function runStatement(database, sql) {
  return new Promise((resolve, reject) => {
    database.run(sql, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function initializeDatabase(options = {}) {
  if (options.dbPath) {
    await setDbPath(options.dbPath);
  }
  if (options.reset) {
    await resetDatabaseFile();
  }
  if (initPromise) {
    return initPromise.then(() => getDb());
  }

  const database = getDb();
  initPromise = (async () => {
    await runStatement(database, 'PRAGMA foreign_keys = ON;');

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS workbooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        updated_at TEXT NOT NULL,
        active_worksheet_id INTEGER,
        seed_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // Add seed_key to older workbooks tables created before this column existed.
    await addColumnIfMissing(database, 'workbooks', 'seed_key', 'TEXT');

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS worksheets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workbook_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 10,
        column_count INTEGER NOT NULL DEFAULT 10,
        selected_row INTEGER NOT NULL DEFAULT 1,
        selected_column INTEGER NOT NULL DEFAULT 1,
        selected_end_row INTEGER NOT NULL DEFAULT 1,
        selected_end_column INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workbook_id, position),
        UNIQUE(workbook_id, name),
        FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
      );`,
    );

    await addColumnIfMissing(database, 'worksheets', 'row_count', 'INTEGER NOT NULL DEFAULT 10');
    await addColumnIfMissing(database, 'worksheets', 'column_count', 'INTEGER NOT NULL DEFAULT 10');
    await addColumnIfMissing(database, 'worksheets', 'selected_row', 'INTEGER NOT NULL DEFAULT 1');
    await addColumnIfMissing(database, 'worksheets', 'selected_column', 'INTEGER NOT NULL DEFAULT 1');
    await addColumnIfMissing(database, 'worksheets', 'selected_end_row', 'INTEGER NOT NULL DEFAULT 1');
    await addColumnIfMissing(database, 'worksheets', 'selected_end_column', 'INTEGER NOT NULL DEFAULT 1');
    await addColumnIfMissing(database, 'worksheets', 'frozen_row_count', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(database, 'worksheets', 'frozen_column_count', 'INTEGER NOT NULL DEFAULT 0');


    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS cells (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worksheet_id INTEGER NOT NULL,
        row_number INTEGER NOT NULL,
        column_number INTEGER NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(worksheet_id, row_number, column_number),
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS validation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worksheet_id INTEGER NOT NULL,
        start_row INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        rule_type TEXT NOT NULL,
        allowed_values TEXT,
        minimum REAL,
        maximum REAL,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worksheet_id INTEGER NOT NULL UNIQUE,
        start_row INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );


    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS pivot_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workbook_id INTEGER NOT NULL,
        source_worksheet_id INTEGER NOT NULL,
        result_worksheet_id INTEGER NOT NULL,
        start_row INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        row_field INTEGER,
        column_field INTEGER,
        value_field INTEGER,
        summarize_by TEXT,
        row_field_header TEXT,
        column_field_header TEXT,
        value_field_header TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workbook_id),
        UNIQUE(result_worksheet_id),
        FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE,
        FOREIGN KEY (source_worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE,
        FOREIGN KEY (result_worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );

    await addColumnIfMissing(database, 'validation_rules', 'error_message', 'TEXT');

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS filter_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filter_id INTEGER NOT NULL,
        column_number INTEGER NOT NULL,
        condition_type TEXT NOT NULL,
        selected_values TEXT,
        value TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (filter_id) REFERENCES filters(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS filter_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workbook_id INTEGER NOT NULL,
        worksheet_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_row INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        columns_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE,
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS named_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workbook_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        range_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS conditional_formats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worksheet_id INTEGER NOT NULL,
        start_row INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        condition_type TEXT NOT NULL,
        compare_value TEXT NOT NULL DEFAULT '',
        style TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );

    await runStatement(
      database,
      `CREATE TABLE IF NOT EXISTS cell_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worksheet_id INTEGER NOT NULL,
        row_number INTEGER NOT NULL,
        column_number INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(worksheet_id, row_number, column_number),
        FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
      );`,
    );
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }

  return database;
}

function closeDb() {
  if (!db) {
    initPromise = null;
    return Promise.resolve();
  }

  const currentDb = db;
  db = null;
  initPromise = null;
  return new Promise((resolve, reject) => {
    currentDb.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function removeDatabaseFile(targetPath = currentDbPath) {
  const resolvedPath = resolveDbPath(targetPath);
  if (resolvedPath === currentDbPath) {
    await closeDb();
  }
  if (fs.existsSync(resolvedPath)) {
    fs.rmSync(resolvedPath, { force: true });
  }
}

async function resetDatabaseFile(targetPath = currentDbPath) {
  await removeDatabaseFile(targetPath);
}

module.exports = {
  DEFAULT_DB_FILENAME,
  resolveDbPath,
  getDbPath,
  setDbPath,
  getDb,
  initializeDatabase,
  closeDb,
  removeDatabaseFile,
  resetDatabaseFile,
};
