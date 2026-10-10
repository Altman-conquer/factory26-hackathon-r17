const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { seedData } = require('./seed_data');

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

async function createSchema(database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(lower(email));`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      device_label TEXT NOT NULL DEFAULT 'Browser session',
      last_active TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      owner_account_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS org_members (
      org_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, account_id),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_team_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, name),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS team_members (
      team_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, account_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public',
      default_branch TEXT NOT NULL DEFAULT 'main',
      creator_account_id INTEGER,
      source_repository_id INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, name),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (creator_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (source_repository_id) REFERENCES repositories(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS repo_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      account_id INTEGER,
      team_id INTEGER,
      role TEXT NOT NULL DEFAULT 'Read',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_grants_account
      ON repo_grants(repository_id, account_id) WHERE account_id IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_grants_team
      ON repo_grants(repository_id, team_id) WHERE team_id IS NOT NULL;`,
    `CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      head_commit_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, name),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (head_commit_id) REFERENCES commits(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      parent_commit_id INTEGER,
      message TEXT NOT NULL,
      author_account_id INTEGER,
      author_name TEXT NOT NULL DEFAULT 'unknown',
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_commit_id) REFERENCES commits(id) ON DELETE SET NULL,
      FOREIGN KEY (author_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS repository_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, branch_id, path),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS commit_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      change_type TEXT NOT NULL DEFAULT 'modified',
      FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, tag),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      actor_account_id INTEGER,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,

    `CREATE TABLE IF NOT EXISTS repository_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'd1d5db',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, name),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, name),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Open',
      author_account_id INTEGER,
      milestone_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      UNIQUE (repository_id, number),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (author_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_issues_repo_status ON issues(repository_id, status, number);`,
    `CREATE TABLE IF NOT EXISTS issue_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      author_account_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (author_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS issue_assignees (
      issue_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (issue_id, account_id),
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id INTEGER NOT NULL,
      label_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (issue_id, label_id),
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES repository_labels(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS issue_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      actor_account_id INTEGER,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_issue_events_issue ON issue_events(issue_id, id);`,
    `CREATE TABLE IF NOT EXISTS issue_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (issue_id, account_id, reaction),
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS branch_protection_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      branch_pattern TEXT NOT NULL,
      require_approval INTEGER NOT NULL DEFAULT 0,
      require_status_check INTEGER NOT NULL DEFAULT 0,
      status_check_name TEXT NOT NULL DEFAULT 'test',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, branch_pattern),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      author_account_id INTEGER,
      base_branch TEXT NOT NULL,
      compare_branch TEXT NOT NULL,
      base_commit_id INTEGER,
      compare_commit_id INTEGER,
      status TEXT NOT NULL DEFAULT 'Open',
      merge_conflict INTEGER NOT NULL DEFAULT 0,
      merged_by_account_id INTEGER,
      merged_at TEXT,
      merge_commit_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (repository_id, number),
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (author_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (base_commit_id) REFERENCES commits(id) ON DELETE SET NULL,
      FOREIGN KEY (compare_commit_id) REFERENCES commits(id) ON DELETE SET NULL,
      FOREIGN KEY (merged_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (merge_commit_id) REFERENCES commits(id) ON DELETE SET NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_status ON pull_requests(repository_id, status, number);`,
    `CREATE TABLE IF NOT EXISTS pr_reviewers (
      pull_request_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      requested_by_account_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (pull_request_id, account_id),
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pr_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id INTEGER NOT NULL,
      reviewer_account_id INTEGER NOT NULL,
      decision TEXT,
      summary TEXT NOT NULL DEFAULT '',
      compare_commit_id INTEGER,
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (compare_commit_id) REFERENCES commits(id) ON DELETE SET NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews(pull_request_id, id);`,
    `CREATE TABLE IF NOT EXISTS pr_review_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id INTEGER NOT NULL,
      review_id INTEGER,
      author_account_id INTEGER,
      body TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL DEFAULT 1,
      side TEXT NOT NULL DEFAULT 'RIGHT',
      state TEXT NOT NULL DEFAULT 'published',
      commit_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (review_id) REFERENCES pr_reviews(id) ON DELETE SET NULL,
      FOREIGN KEY (author_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pr_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      setter_account_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pull_request_id, name),
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (setter_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pr_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pull_request_id INTEGER NOT NULL,
      actor_account_id INTEGER,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pull_request_id) REFERENCES pull_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );`,
  ];

  for (const statement of statements) {
    await runStatement(database, statement);
  }
}

async function getTableColumns(database, tableName) {
  const rows = await new Promise((resolve, reject) => {
    database.all(`PRAGMA table_info(${tableName})`, (err, result) => {
      if (err) reject(err);
      else resolve(result || []);
    });
  });
  return rows.map((row) => row.name);
}

async function ensureColumn(database, tableName, columnName, definition) {
  const columns = await getTableColumns(database, tableName);
  if (!columns.includes(columnName)) {
    await runStatement(database, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function migrateSchema(database) {
  await ensureColumn(database, 'organizations', 'owner_account_id', 'INTEGER');
  await ensureColumn(database, 'repositories', 'default_branch', "TEXT NOT NULL DEFAULT 'main'");
  await ensureColumn(database, 'repositories', 'creator_account_id', 'INTEGER');
  await ensureColumn(database, 'repositories', 'source_repository_id', 'INTEGER');
  await ensureColumn(database, 'repositories', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(database, 'repositories', 'created_at', "TEXT NOT NULL DEFAULT ''");
}

async function initializeDatabase(options = {}) {
  if (options.dbPath) {
    await setDbPath(options.dbPath);
  }
  if (options.reset) {
    await resetDatabaseFile();
  }
  if (initPromise) {
    return initPromise;
  }

  const database = getDb();
  initPromise = (async () => {
    await runStatement(database, 'PRAGMA foreign_keys = ON;');
    await createSchema(database);
    await migrateSchema(database);
    if (options.seed !== false) {
      await seedData(database);
    }
    return database;
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
