const {
  run,
  get,
  all,
  withTransaction,
} = require('./database/db_runtime');
const {
  requireAuth,
  getCurrentSession,
} = require('./auth');
const {
  normalizeOrganizationName,
  normalizeRole,
} = require('./validation');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function bool(value) {
  return value === true || value === 'true' || value === 'on';
}

function normalizeVisibility(value, fallback = 'public') {
  const normalized = text(value).trim().toLowerCase();
  if (normalized === 'public' || normalized === 'private') {
    return normalized;
  }
  return fallback;
}

function isValidRepositoryName(value) {
  const name = text(value).trim();
  return name.length >= 1 && name.length <= 100 && !name.includes('/') && name !== '.' && name !== '..';
}

function isValidBranchName(value) {
  const name = text(value);
  if (name.length < 1 || name.length > 255) {
    return false;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    return false;
  }
  if (name.endsWith('/') || name.endsWith('.')) {
    return false;
  }
  if (name.includes('..') || name.includes('//')) {
    return false;
  }
  return true;
}

async function findOrg(name) {
  return get('SELECT * FROM organizations WHERE name = ?', [normalizeOrganizationName(name)]);
}

async function findRepository(orgName, repoName) {
  return get(
    `SELECT r.*, o.name AS org_name, o.display_name AS org_display_name, o.owner_account_id AS org_owner_account_id
     FROM repositories r
     JOIN organizations o ON o.id = r.org_id
     WHERE o.name = ? AND r.name = ?`,
    [normalizeOrganizationName(orgName), text(repoName).trim()],
  );
}

async function getOrganizationRole(accountId, orgId) {
  if (!accountId || !orgId) return null;
  const row = await get('SELECT role FROM org_members WHERE org_id = ? AND account_id = ?', [
    orgId,
    accountId,
  ]);
  return row ? row.role : null;
}

async function canRead(account, repository) {
  if (!repository) return false;
  if (repository.visibility === 'public') return true;
  if (!account) return false;
  if (await getOrganizationRole(account.id, repository.org_id) === 'Owner') return true;
  const direct = await get(
    'SELECT id FROM repo_grants WHERE repository_id = ? AND account_id = ?',
    [repository.id, account.id],
  );
  if (direct) return true;
  const team = await get(
    `SELECT g.id FROM repo_grants g
     JOIN team_members tm ON tm.team_id = g.team_id
     WHERE g.repository_id = ? AND tm.account_id = ?`,
    [repository.id, account.id],
  );
  return Boolean(team);
}

async function getEffectiveRole(account, repository) {
  if (!account || !repository) return null;
  if (await getOrganizationRole(account.id, repository.org_id) === 'Owner') return 'Admin';
  const direct = await get(
    'SELECT role FROM repo_grants WHERE repository_id = ? AND account_id = ?',
    [repository.id, account.id],
  );
  if (direct) return direct.role;
  const team = await get(
    `SELECT g.role FROM repo_grants g
     JOIN team_members tm ON tm.team_id = g.team_id
     WHERE g.repository_id = ? AND tm.account_id = ?`,
    [repository.id, account.id],
  );
  return team ? team.role : null;
}

async function canWrite(account, repository) {
  const role = await getEffectiveRole(account, repository);
  return ['Write', 'Maintain', 'Admin'].includes(role);
}

async function canAdmin(account, repository) {
  const role = await getEffectiveRole(account, repository);
  return role === 'Admin';
}

async function canCreateInNamespace(account, organization) {
  if (!account || !organization) return false;
  if (organization.owner_account_id === account.id) return true;
  return (await getOrganizationRole(account.id, organization.id)) === 'Owner';
}

async function ensurePersonalNamespace(account) {
  let org = await findOrg(account.username);
  if (!org) {
    const result = await run(
      `INSERT INTO organizations (name, display_name, owner_account_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [account.username, account.username, account.id],
    );
    org = { id: result.lastID, name: account.username, display_name: account.username };
    await run(
      `INSERT OR IGNORE INTO org_members (org_id, account_id, role, created_at)
       VALUES (?, ?, 'Owner', datetime('now'))`,
      [org.id, account.id],
    );
  }
  return org;
}

async function getBranch(repositoryId, branchName) {
  return get('SELECT * FROM branches WHERE repository_id = ? AND name = ?', [
    repositoryId,
    branchName,
  ]);
}

async function getDefaultBranchName(repository) {
  if (repository.default_branch) return repository.default_branch;
  const first = await get('SELECT name FROM branches WHERE repository_id = ? ORDER BY id LIMIT 1', [
    repository.id,
  ]);
  return first ? first.name : 'main';
}

async function resolveBranch(repository, requestedBranch) {
  const branchName = text(requestedBranch).trim() || (await getDefaultBranchName(repository));
  const branch = await getBranch(repository.id, branchName);
  return branch;
}

async function repositoryJson(repository, account = null) {
  if (!repository) return null;
  let source = null;
  if (repository.source_repository_id) {
    source = await get(
      `SELECT r.name, o.name AS org_name
       FROM repositories r JOIN organizations o ON o.id = r.org_id
       WHERE r.id = ?`,
      [repository.source_repository_id],
    );
  }
  const fullName = `${repository.org_name}/${repository.name}`;
  return {
    id: repository.id,
    name: repository.name,
    owner: repository.org_name,
    ownerDisplayName: repository.org_display_name,
    orgName: repository.org_name,
    fullName,
    description: repository.description || '',
    visibility: repository.visibility,
    defaultBranch: await getDefaultBranchName(repository),
    archived: Boolean(repository.archived),
    sourceRepositoryId: repository.source_repository_id || null,
    sourceName: source ? source.name : null,
    sourceFullName: source ? `${source.org_name}/${source.name}` : null,
    canAdmin: await canAdmin(account, repository),
    canWrite: await canWrite(account, repository),
    cloneHttps: `https://example.invalid/${fullName}.git`,
    cloneSsh: `git@example.invalid:${fullName}.git`,
  };
}

async function listAccessibleRepositories(account, queryText = '', ownerName = '') {
  const q = text(queryText).trim().toLowerCase();
  const owner = text(ownerName).trim().toLowerCase();
  const rows = await all(
    `SELECT r.*, o.name AS org_name, o.display_name AS org_display_name,
            o.owner_account_id AS org_owner_account_id
     FROM repositories r
     JOIN organizations o ON o.id = r.org_id
     ORDER BY o.name, r.name`,
  );
  const results = [];
  for (const row of rows) {
    if (owner && row.org_name.toLowerCase() !== owner) continue;
    if (!(await canRead(account, row))) continue;
    if (
      q &&
      !String(row.name).toLowerCase().includes(q) &&
      !String(row.description || '').toLowerCase().includes(q)
    ) {
      continue;
    }
    results.push(await repositoryJson(row, account));
  }
  return results;
}

async function readTree(repository, branch, dirPath = '') {
  const prefix = dirPath ? `${dirPath.replace(/\/+$/, '')}/` : '';
  const files = await all(
    'SELECT path FROM repository_files WHERE repository_id = ? AND branch_id = ? ORDER BY path',
    [repository.id, branch.id],
  );
  const entries = new Map();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (!rest) continue;
    const [segment, ...tail] = rest.split('/').filter(Boolean);
    if (segment === undefined) continue;
    if (tail.length > 0) {
      if (!entries.has(segment)) entries.set(segment, { type: 'directory', name: segment, path: `${dirPath ? `${dirPath}/` : ''}${segment}` });
    } else if (!entries.has(segment)) {
      entries.set(segment, { type: 'file', name: segment, path: file.path });
    }
  }
  return Array.from(entries.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function relativeTime(value) {
  const raw = value === null || value === undefined ? '' : String(value).replace(' ', 'T');
  const normalized = !raw || raw.endsWith('Z') || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`;
  const parsed = normalized ? new Date(normalized) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const diff = Date.now() - date.getTime();
  const seconds = Math.max(1, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

function registerModule2Routes(app) {
  app.get(
    '/api/search',
    asyncHandler(async (req, res) => {
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      const repositories = await listAccessibleRepositories(account, req.query.q, req.query.owner);
      res.json({ repositories });
    }),
  );

  app.get(
    '/api/repositories',
    asyncHandler(async (req, res) => {
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      const repositories = await listAccessibleRepositories(account, req.query.q, req.query.owner);
      res.json({ repositories });
    }),
  );

  app.get(
    '/api/users/:username/repositories',
    asyncHandler(async (req, res) => {
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      const repositories = await listAccessibleRepositories(
        account,
        req.query.q,
        req.params.username,
      );
      res.json({ repositories });
    }),
  );

  app.post(
    '/api/repositories',
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerName = text(req.body?.owner).trim();
      const name = text(req.body?.name ?? req.body?.repositoryName).trim();
      const description = text(req.body?.description).trim();
      const visibility = normalizeVisibility(req.body?.visibility, 'public');
      const addReadme = bool(req.body?.addReadme ?? req.body?.addReadmeFile);
      const errors = {};

      if (!name) errors.name = 'Repository name is required';
      else if (!isValidRepositoryName(name)) errors.name = 'Repository name is invalid';

      let organization = ownerName ? await findOrg(ownerName) : null;
      if (!organization) {
        if (!ownerName) {
          organization = await ensurePersonalNamespace(req.user);
        } else {
          errors.owner = 'Owner is invalid';
        }
      }

      if (organization && !(await canCreateInNamespace(req.user, organization))) {
        errors.owner = 'You do not have permission to create repositories for this owner';
      }

      if (!errors.name && organization) {
        const duplicate = await get('SELECT id FROM repositories WHERE org_id = ? AND name = ?', [
          organization.id,
          name,
        ]);
        if (duplicate) errors.name = 'Repository name already exists';
      }

      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }

      const repositoryId = await withTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO repositories
           (org_id, name, description, visibility, default_branch, creator_account_id, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'main', ?, 0, datetime('now'), datetime('now'))`,
          [organization.id, name, description, visibility, req.user.id],
        );
        const repository = {
          id: result.lastID,
          org_id: organization.id,
          name,
          description,
          visibility,
          default_branch: 'main',
          creator_account_id: req.user.id,
          archived: 0,
          source_repository_id: null,
          org_name: organization.name,
          org_display_name: organization.display_name,
        };
        if (addReadme) {
          const branch = await tx.run(
            `INSERT INTO branches (repository_id, name, head_commit_id, created_at)
             VALUES (?, 'main', NULL, datetime('now'))`,
            [result.lastID],
          );
          const commit = await tx.run(
            `INSERT INTO commits
             (repository_id, branch_id, parent_commit_id, message, author_account_id, author_name,
              additions, deletions, created_at)
             VALUES (?, ?, NULL, 'Initial commit', ?, ?, 1, 0, datetime('now'))`,
            [result.lastID, branch.lastID, req.user.id, req.user.username],
          );
          await tx.run(
            `INSERT INTO commit_files (commit_id, path, additions, deletions, change_type)
             VALUES (?, 'README.md', 1, 0, 'added')`,
            [commit.lastID],
          );
          await tx.run(
            `INSERT INTO repository_files (repository_id, branch_id, path, content, created_at, updated_at)
             VALUES (?, ?, 'README.md', ?, datetime('now'), datetime('now'))`,
            [result.lastID, branch.lastID, `# ${name}\n`],
          );
          await tx.run('UPDATE branches SET head_commit_id = ? WHERE id = ?', [
            commit.lastID,
            branch.lastID,
          ]);
        }
        await tx.run(
          `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
           VALUES (?, ?, 'Repository created', ?, datetime('now'))`,
          [organization.id, req.user.id, name],
        );
        return repository;
      });

      const repository = await findRepository(organization.name, name);
      res.status(201).json({ repository: await repositoryJson(repository, req.user) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      res.json({ repository: await repositoryJson(repository, account) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/visibility',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canAdmin(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const visibility = normalizeVisibility(req.body?.visibility, '');
      if (!visibility) {
        res.status(400).json({ error: 'Visibility is invalid' });
        return;
      }
      await run('UPDATE repositories SET visibility = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        visibility,
        repository.id,
      ]);
      const updated = await findRepository(req.params.orgName, req.params.repoName);
      res.json({ repository: await repositoryJson(updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/archive',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canAdmin(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      await run('UPDATE repositories SET archived = 1, updated_at = datetime(\'now\') WHERE id = ?', [
        repository.id,
      ]);
      const updated = await findRepository(req.params.orgName, req.params.repoName);
      res.json({ repository: await repositoryJson(updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/restore',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canAdmin(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      await run('UPDATE repositories SET archived = 0, updated_at = datetime(\'now\') WHERE id = ?', [
        repository.id,
      ]);
      const updated = await findRepository(req.params.orgName, req.params.repoName);
      res.json({ repository: await repositoryJson(updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/fork',
    requireAuth,
    asyncHandler(async (req, res) => {
      const sourceRepository = await findRepository(req.params.orgName, req.params.repoName);
      if (!sourceRepository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canRead(req.user, sourceRepository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const ownerName = text(req.body?.owner).trim();
      const requestedName = text(req.body?.name ?? req.body?.repositoryName).trim();
      let organization = ownerName ? await findOrg(ownerName) : null;
      if (!organization) {
        if (!ownerName) {
          organization = await ensurePersonalNamespace(req.user);
        } else {
          res.status(400).json({ errors: { owner: 'Owner is invalid' } });
          return;
        }
      }
      if (!(await canCreateInNamespace(req.user, organization))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const name = requestedName || `${sourceRepository.name}-fork`;
      if (!isValidRepositoryName(name)) {
        res.status(400).json({ errors: { name: 'Repository name is invalid' } });
        return;
      }
      const duplicate = await get('SELECT id FROM repositories WHERE org_id = ? AND name = ?', [
        organization.id,
        name,
      ]);
      if (duplicate) {
        res.status(400).json({ errors: { name: 'Repository name already exists' } });
        return;
      }
      const requestedVisibility = normalizeVisibility(req.body?.visibility, 'public');
      const visibility = sourceRepository.visibility === 'private' ? 'private' : requestedVisibility;

      const forkId = await withTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO repositories
           (org_id, name, description, visibility, default_branch, creator_account_id,
            source_repository_id, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
          [
            organization.id,
            name,
            sourceRepository.description || '',
            visibility,
            sourceRepository.default_branch || 'main',
            req.user.id,
            sourceRepository.id,
          ],
        );
        const forkRepositoryId = result.lastID;
        const branches = await tx.all('SELECT * FROM branches WHERE repository_id = ? ORDER BY id', [
          sourceRepository.id,
        ]);
        const commitMap = new Map();
        for (const branch of branches) {
          const branchInsert = await tx.run(
            `INSERT INTO branches (repository_id, name, head_commit_id, created_at)
             VALUES (?, ?, NULL, datetime('now'))`,
            [forkRepositoryId, branch.name],
          );
          const files = await tx.all(
            'SELECT * FROM repository_files WHERE repository_id = ? AND branch_id = ?',
            [sourceRepository.id, branch.id],
          );
          for (const file of files) {
            await tx.run(
              `INSERT INTO repository_files (repository_id, branch_id, path, content, created_at, updated_at)
               VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [forkRepositoryId, branchInsert.lastID, file.path, file.content],
            );
          }
          const commits = await tx.all(
            'SELECT * FROM commits WHERE repository_id = ? AND branch_id = ? ORDER BY id',
            [sourceRepository.id, branch.id],
          );
          for (const commit of commits) {
            const commitInsert = await tx.run(
              `INSERT INTO commits
               (repository_id, branch_id, parent_commit_id, message, author_account_id, author_name,
                additions, deletions, created_at)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
              [
                forkRepositoryId,
                branchInsert.lastID,
                commit.message,
                commit.author_account_id,
                commit.author_name,
                commit.additions,
                commit.deletions,
                commit.created_at,
              ],
            );
            commitMap.set(commit.id, commitInsert.lastID);
            const changedFiles = await tx.all('SELECT * FROM commit_files WHERE commit_id = ?', [
              commit.id,
            ]);
            for (const changed of changedFiles) {
              await tx.run(
                `INSERT INTO commit_files (commit_id, path, additions, deletions, change_type)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                  commitInsert.lastID,
                  changed.path,
                  changed.additions,
                  changed.deletions,
                  changed.change_type,
                ],
              );
            }
          }
          if (branch.head_commit_id && commitMap.has(branch.head_commit_id)) {
            await tx.run('UPDATE branches SET head_commit_id = ? WHERE id = ?', [
              commitMap.get(branch.head_commit_id),
              branchInsert.lastID,
            ]);
          }
        }
        return forkRepositoryId;
      });

      const fork = await findRepository(organization.name, name);
      res.status(201).json({ repository: await repositoryJson(fork, req.user), id: forkId });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/branches',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const branches = await all('SELECT name FROM branches WHERE repository_id = ? ORDER BY name', [
        repository.id,
      ]);
      res.json({ branches: branches.map((row) => row.name), defaultBranch: await getDefaultBranchName(repository) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/branches',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canWrite(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (repository.archived) {
        res.status(400).json({ error: 'Repository is archived' });
        return;
      }
      const name = text(req.body?.name ?? req.body?.branchName).trim();
      if (!isValidBranchName(name)) {
        res.status(400).json({ errors: { name: 'Invalid branch' } });
        return;
      }
      const existing = await getBranch(repository.id, name);
      if (existing) {
        res.status(400).json({ errors: { name: 'Branch name already exists' } });
        return;
      }
      const baseName = text(req.body?.baseBranch).trim() || (await getDefaultBranchName(repository));
      const base = await getBranch(repository.id, baseName);
      if (!base) {
        res.status(400).json({ error: 'Base branch not found' });
        return;
      }
      const result = await run(
        `INSERT INTO branches (repository_id, name, head_commit_id, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [repository.id, name, base.head_commit_id || null],
      );
      res.status(201).json({ branch: { id: result.lastID, name, headCommitId: base.head_commit_id || null } });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/default-branch',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canAdmin(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const branchName = text(req.body?.branch ?? req.body?.defaultBranch).trim();
      const branch = await getBranch(repository.id, branchName);
      if (!branch) {
        res.status(400).json({ error: 'Branch not found' });
        return;
      }
      await run('UPDATE repositories SET default_branch = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        branchName,
        repository.id,
      ]);
      res.json({ defaultBranch: branchName });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/tree',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const branch = await resolveBranch(repository, req.query.branch);
      if (!branch) {
        res.status(404).json({ error: 'Branch not found' });
        return;
      }
      const dirPath = text(req.query.path).replace(/^\/+|\/+$/g, '');
      const entries = await readTree(repository, branch, dirPath);
      res.json({ branch: branch.name, path: dirPath, entries });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/file',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const branch = await resolveBranch(repository, req.query.branch);
      if (!branch) {
        res.status(404).json({ error: 'Branch not found' });
        return;
      }
      const filePath = text(req.query.path).replace(/^\/+/, '');
      const file = await get(
        'SELECT * FROM repository_files WHERE repository_id = ? AND branch_id = ? AND path = ?',
        [repository.id, branch.id, filePath],
      );
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.json({
        branch: branch.name,
        file: { name: filePath.split('/').pop(), path: file.path, content: file.content },
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/files',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canWrite(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (repository.archived) {
        res.status(400).json({ error: 'Repository is archived' });
        return;
      }
      const filePath = text(req.body?.path).trim();
      const content = text(req.body?.content);
      const message = text(req.body?.message).trim();
      const errors = {};
      if (!filePath || filePath.startsWith('/') || filePath.split('/').some((segment) => segment === '..')) {
        errors.path = 'Invalid file path';
      }
      if (!message) {
        errors.message = 'Commit message is required';
      } else if (message.length > 72) {
        errors.message = 'Commit message must be 72 characters or fewer';
      }
      const branch = await resolveBranch(repository, req.body?.branch);
      if (!branch) {
        res.status(404).json({ error: 'Branch not found' });
        return;
      }
      if (!errors.path) {
        const conflict = await get(
          `SELECT id FROM repository_files
           WHERE repository_id = ? AND branch_id = ?
             AND (path = ? OR path LIKE ? OR ? LIKE path || '/%')
           LIMIT 1`,
          [repository.id, branch.id, filePath, `${filePath}/%`, filePath],
        );
        if (conflict) errors.path = 'Invalid file path';
      }
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }
      const commitId = await withTransaction(async (tx) => {
        const commit = await tx.run(
          `INSERT INTO commits
           (repository_id, branch_id, parent_commit_id, message, author_account_id, author_name,
            additions, deletions, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          [
            repository.id,
            branch.id,
            branch.head_commit_id || null,
            message,
            req.user.id,
            req.user.username,
            content ? content.split(/\r?\n/).length : 0,
          ],
        );
        await tx.run(
          `INSERT INTO commit_files (commit_id, path, additions, deletions, change_type)
           VALUES (?, ?, ?, 0, 'added')`,
          [commit.lastID, filePath, content ? content.split(/\r?\n/).length : 0],
        );
        await tx.run(
          `INSERT INTO repository_files (repository_id, branch_id, path, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [repository.id, branch.id, filePath, content],
        );
        await tx.run('UPDATE branches SET head_commit_id = ? WHERE id = ?', [
          commit.lastID,
          branch.id,
        ]);
        return commit.lastID;
      });
      res.status(201).json({ commitId, path: filePath, branch: branch.name });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/code-search',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const q = text(req.query.q);
      const branch = await resolveBranch(repository, req.query.branch);
      if (!branch) {
        res.status(404).json({ error: 'Branch not found' });
        return;
      }
      const files = await all(
        'SELECT path, content FROM repository_files WHERE repository_id = ? AND branch_id = ? ORDER BY path',
        [repository.id, branch.id],
      );
      const query = q.toLowerCase();
      const matches = files
        .filter((file) => !query || String(file.content).toLowerCase().includes(query))
        .map((file) => ({
          name: file.path.split('/').pop(),
          path: file.path,
          content: file.content,
        }));
      res.json({ branch: branch.name, query: q, results: matches });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/commits',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const branch = await resolveBranch(repository, req.query.branch);
      if (!branch) {
        res.status(404).json({ error: 'Branch not found' });
        return;
      }
      const commits = await all(
        `SELECT * FROM commits WHERE repository_id = ? AND branch_id = ?
         ORDER BY datetime(created_at) DESC, id DESC`,
        [repository.id, branch.id],
      );
      res.json({
        branch: branch.name,
        commits: commits.map((commit) => ({
          id: commit.id,
          message: commit.message,
          author: commit.author_name,
          createdAt: commit.created_at,
          relativeTime: relativeTime(commit.created_at),
          additions: commit.additions,
          deletions: commit.deletions,
        })),
      });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/commits/:commitId',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const commit = await get('SELECT * FROM commits WHERE id = ? AND repository_id = ?', [
        Number(req.params.commitId),
        repository.id,
      ]);
      if (!commit) {
        res.status(404).json({ error: 'Commit not found' });
        return;
      }
      const files = await all('SELECT * FROM commit_files WHERE commit_id = ? ORDER BY path', [
        commit.id,
      ]);
      const commitBranch = await get('SELECT name FROM branches WHERE id = ?', [commit.branch_id]);
      res.json({
        commit: {
          id: commit.id,
          message: commit.message,
          author: commit.author_name,
          createdAt: commit.created_at,
          parentCommitId: commit.parent_commit_id,
          branchName: commitBranch ? commitBranch.name : '',
          additions: commit.additions,
          deletions: commit.deletions,
          changedFiles: files.map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
            changeType: file.change_type,
          })),
        },
      });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/releases',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const releases = await all(
        'SELECT * FROM releases WHERE repository_id = ? ORDER BY datetime(created_at) DESC, id DESC',
        [repository.id],
      );
      res.json({
        releases: releases.map((release) => ({
          id: release.id,
          tag: release.tag,
          title: release.title,
          description: release.description,
          branchName: release.branch_name,
          createdAt: release.created_at,
        })),
      });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/releases/:tag',
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const session = await getCurrentSession(req);
      const account = session ? session.account : null;
      if (!(await canRead(account, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const release = await get('SELECT * FROM releases WHERE repository_id = ? AND tag = ?', [
        repository.id,
        req.params.tag,
      ]);
      if (!release) {
        res.status(404).json({ error: 'Release not found' });
        return;
      }
      res.json({
        release: {
          id: release.id,
          tag: release.tag,
          title: release.title,
          description: release.description,
          branchName: release.branch_name,
          createdAt: release.created_at,
        },
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/releases',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canWrite(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (repository.archived) {
        res.status(400).json({ error: 'Repository is archived' });
        return;
      }
      const tag = text(req.body?.tag).trim();
      const title = text(req.body?.title).trim();
      const description = text(req.body?.description).trim();
      const branchName = text(req.body?.branch ?? req.body?.targetBranch).trim() || (await getDefaultBranchName(repository));
      const branch = await getBranch(repository.id, branchName);
      const errors = {};
      if (!tag) errors.tag = 'Tag name is required';
      if (!title) errors.title = 'Release title is required';
      if (!branch) errors.branch = 'Target branch is invalid';
      if (tag) {
        const existing = await get('SELECT id FROM releases WHERE repository_id = ? AND tag = ?', [
          repository.id,
          tag,
        ]);
        if (existing) errors.tag = 'Tag already exists';
      }
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }
      const result = await run(
        `INSERT INTO releases (repository_id, tag, title, description, branch_name, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [repository.id, tag, title, description, branchName],
      );
      res.status(201).json({
        release: { id: result.lastID, tag, title, description, branchName },
      });
    }),
  );
}

module.exports = registerModule2Routes;
