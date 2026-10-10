const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const {
  hashPassword,
  verifyPassword,
} = require('./password');
const {
  setSessionCookie,
  clearSessionCookie,
  createSession,
  getCurrentSession,
  requireAuth,
} = require('./auth');
const {
  run,
  get,
  all,
  withTransaction,
} = require('./database/db_runtime');
const {
  isValidUsername,
  normalizeOrganizationName,
  isValidOrganizationName,
  isValidTeamName,
  isValidPassword,
  normalizeEmail,
  isValidEmail,
  isDisplayNameValid,
  normalizeRole,
  normalizeOrganizationRole,
} = require('./validation');
const { initializeDatabase } = require('./database/init_db');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function publicAccount(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    verified: Boolean(row.verified),
  };
}

function requireString(value) {
  return typeof value === 'string' ? value : '';
}

async function findAccountByIdentifier(identifier) {
  const raw = requireString(identifier).trim();
  if (!raw) {
    return null;
  }
  return get(
    `SELECT * FROM accounts
     WHERE username = ? OR lower(email) = lower(?)
     LIMIT 1`,
    [raw, raw],
  );
}

async function findOrganization(name) {
  return get('SELECT * FROM organizations WHERE name = ?', [normalizeOrganizationName(name)]);
}

async function getOrganizationRole(accountId, orgId) {
  if (!accountId || !orgId) {
    return null;
  }
  const row = await get(
    'SELECT role FROM org_members WHERE org_id = ? AND account_id = ?',
    [orgId, accountId],
  );
  return row ? row.role : null;
}

async function isOrganizationOwner(accountId, orgId) {
  return (await getOrganizationRole(accountId, orgId)) === 'Owner';
}

async function canReadRepository(account, repository) {
  if (!repository) {
    return false;
  }
  if (repository.visibility === 'public') {
    return true;
  }
  if (!account) {
    return false;
  }

  if (await isOrganizationOwner(account.id, repository.org_id)) {
    return true;
  }

  const directGrant = await get(
    'SELECT id FROM repo_grants WHERE repository_id = ? AND account_id = ?',
    [repository.id, account.id],
  );
  if (directGrant) {
    return true;
  }

  const teamGrant = await get(
    `SELECT g.id
     FROM repo_grants g
     JOIN team_members tm ON tm.team_id = g.team_id
     WHERE g.repository_id = ? AND tm.account_id = ?`,
    [repository.id, account.id],
  );
  return Boolean(teamGrant);
}

async function canAdminRepository(account, repository) {
  if (!account || !repository) {
    return false;
  }
  if (await isOrganizationOwner(account.id, repository.org_id)) {
    return true;
  }

  const directGrant = await get(
    `SELECT id FROM repo_grants
     WHERE repository_id = ? AND account_id = ? AND role = 'Admin'`,
    [repository.id, account.id],
  );
  if (directGrant) {
    return true;
  }

  const teamGrant = await get(
    `SELECT g.id
     FROM repo_grants g
     JOIN team_members tm ON tm.team_id = g.team_id
     WHERE g.repository_id = ? AND tm.account_id = ? AND g.role = 'Admin'`,
    [repository.id, account.id],
  );
  return Boolean(teamGrant);
}

async function findRepository(orgName, repoName) {
  return get(
    `SELECT r.* FROM repositories r
     JOIN organizations o ON o.id = r.org_id
     WHERE o.name = ? AND r.name = ?`,
    [normalizeOrganizationName(orgName), repoName],
  );
}

async function recordAudit(orgId, actorId, action, target) {
  await run(
    `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [orgId, actorId, action, target],
  );
}

app.use(cors());
app.use(bodyParser.json());

initializeDatabase().catch((error) => {
  console.error('Database initialization failed:', error);
});

app.get('/api/health', (req, res) => {
  res.json({ code: 200, message: 'Backend Ready' });
});

// ---------------------------------------------------------------------------
// Authentication and account lifecycle
// ---------------------------------------------------------------------------

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const username = requireString(req.body?.username);
    const email = normalizeEmail(req.body?.email);
    const password = requireString(req.body?.password);
    const confirmPassword = requireString(
      req.body?.confirmPassword ?? req.body?.passwordConfirmation,
    );
    const agreeToTerms = req.body?.agreeToTerms === true || req.body?.agreeToTerms === 'true';
    const errors = {};

    if (!isValidUsername(username)) {
      errors.username = 'Username format is invalid';
    }

    if (!isValidEmail(email)) {
      errors.email = 'Email format is invalid';
    }

    if (!isValidPassword(password)) {
      errors.password = 'Password requirements are not satisfied';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Password confirmation does not match';
    }

    if (!agreeToTerms) {
      errors.terms = 'Agree to terms is required';
    }

    if (isValidUsername(username)) {
      const existingUsername = await get('SELECT id FROM accounts WHERE username = ?', [username]);
      if (existingUsername) {
        errors.username = 'Username already exists';
      }
    }

    if (isValidEmail(email)) {
      const existingEmail = await get('SELECT id FROM accounts WHERE lower(email) = ?', [email]);
      if (existingEmail && !errors.username) {
        errors.email = 'Email already exists';
      }
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ errors });
      return;
    }

    const result = await run(
      `INSERT INTO accounts (username, email, password_hash, verified, created_at)
       VALUES (?, ?, ?, 1, datetime('now'))`,
      [username, email, hashPassword(password)],
    );
    res.status(201).json({
      account: {
        id: result.lastID,
        username,
        email,
        verified: true,
      },
    });
  }),
);

app.post(
  '/api/auth/signin',
  asyncHandler(async (req, res) => {
    const identifier = requireString(req.body?.identifier ?? req.body?.usernameOrEmail).trim();
    const password = requireString(req.body?.password);

    if (!identifier || !password) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const account = await get(
      `SELECT * FROM accounts
       WHERE username = ? OR lower(email) = lower(?)
       LIMIT 1`,
      [identifier, identifier],
    );

    if (!account || !account.verified || !verifyPassword(password, account.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const session = await createSession(account.id, req);
    setSessionCookie(res, session.token);
    res.json({ account: publicAccount(account) });
  }),
);

app.post(
  '/api/auth/signout',
  asyncHandler(async (req, res) => {
    const session = await getCurrentSession(req);
    if (session) {
      await run('UPDATE sessions SET active = 0 WHERE id = ?', [session.sessionId]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/auth/me',
  asyncHandler(async (req, res) => {
    const session = await getCurrentSession(req);
    if (!session) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    res.json({ account: session.account });
  }),
);

app.post(
  '/api/auth/forgot',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    res.json({ code: '123456', email });
  }),
);

app.post(
  '/api/auth/reset',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = requireString(req.body?.code ?? req.body?.verificationCode);
    const newPassword = requireString(req.body?.newPassword);
    const confirmPassword = requireString(req.body?.confirmPassword);
    const errors = {};

    if (code !== '123456') {
      errors.verificationCode = 'Verification code is invalid';
    }
    if (!isValidPassword(newPassword)) {
      errors.newPassword = 'Password requirements are not satisfied';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Password confirmation does not match';
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ errors });
      return;
    }

    const account = await get('SELECT * FROM accounts WHERE lower(email) = ?', [email]);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    await run('UPDATE accounts SET password_hash = ? WHERE id = ?', [
      hashPassword(newPassword),
      account.id,
    ]);
    res.json({ message: 'Password updated' });
  }),
);

app.get(
  '/api/auth/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await all(
      `SELECT id, device_label, last_active, created_at
       FROM sessions
       WHERE account_id = ? AND active = 1
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, last_active DESC`,
      [req.user.id, req.session.sessionId],
    );
    res.json({
      sessions: rows.map((row) => ({
        id: row.id,
        deviceLabel: row.device_label,
        lastActive: row.last_active,
        createdAt: row.created_at,
        isCurrent: row.id === req.session.sessionId,
      })),
    });
  }),
);

app.post(
  '/api/auth/sessions/:id/revoke',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      res.status(400).json({ error: 'Invalid session' });
      return;
    }
    if (sessionId === req.session.sessionId) {
      res.status(400).json({ error: 'Cannot revoke the current session' });
      return;
    }
    const target = await get(
      'SELECT id FROM sessions WHERE id = ? AND account_id = ? AND active = 1',
      [sessionId, req.user.id],
    );
    if (!target) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await run('UPDATE sessions SET active = 0 WHERE id = ?', [sessionId]);
    res.json({ message: 'Session revoked' });
  }),
);

app.post(
  '/api/auth/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = requireString(req.body?.currentPassword);
    const newPassword = requireString(req.body?.newPassword);
    const confirmPassword = requireString(req.body?.confirmPassword);
    const errors = {};

    if (!currentPassword) {
      errors.currentPassword = 'Current password is required';
    } else {
      const account = await get('SELECT * FROM accounts WHERE id = ?', [req.user.id]);
      if (!verifyPassword(currentPassword, account.password_hash)) {
        errors.currentPassword = 'Current password is incorrect';
      }
    }

    if (!isValidPassword(newPassword)) {
      errors.newPassword = 'Password requirements are not satisfied';
    }
    if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Password confirmation does not match';
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ errors });
      return;
    }

    await run('UPDATE accounts SET password_hash = ? WHERE id = ?', [
      hashPassword(newPassword),
      req.user.id,
    ]);
    res.json({ message: 'Password updated' });
  }),
);

// ---------------------------------------------------------------------------
// Organizations, membership, teams, and audit log
// ---------------------------------------------------------------------------

app.get(
  '/api/organizations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await all(
      `SELECT o.*, m.role
       FROM organizations o
       JOIN org_members m ON m.org_id = o.id
       WHERE m.account_id = ?
       ORDER BY o.name`,
      [req.user.id],
    );
    res.json({
      organizations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        role: row.role,
      })),
    });
  }),
);

app.post(
  '/api/organizations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawName = requireString(req.body?.name ?? req.body?.organizationName);
    const name = normalizeOrganizationName(rawName);
    const displayName = String(req.body?.displayName ?? '').trim();
    const errors = {};

    if (!isValidOrganizationName(name)) {
      errors.name = 'Organization name format is invalid';
    }
    if (!isDisplayNameValid(displayName)) {
      errors.displayName = 'Display name is required';
    }

    if (name && isValidOrganizationName(name)) {
      const existing = await findOrganization(name);
      if (existing) {
        res.status(400).json({ error: 'Organization name already exists' });
        return;
      }
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ errors });
      return;
    }

    const organization = await withTransaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO organizations (name, display_name, created_at)
         VALUES (?, ?, datetime('now'))`,
        [name, displayName],
      );
      await tx.run(
        `INSERT INTO org_members (org_id, account_id, role, created_at)
         VALUES (?, ?, 'Owner', datetime('now'))`,
        [result.lastID, req.user.id],
      );
      await tx.run(
        `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
         VALUES (?, ?, 'Organization created', ?, datetime('now'))`,
        [result.lastID, req.user.id, name],
      );
      return { id: result.lastID, name, displayName };
    });

    res.status(201).json({ organization });
  }),
);

app.get(
  '/api/organizations/public',
  asyncHandler(async (req, res) => {
    const rows = await all(
      `SELECT DISTINCT o.id, o.name, o.display_name
       FROM organizations o
       JOIN repositories r ON r.org_id = o.id
       WHERE r.visibility = 'public'
       ORDER BY o.name`,
    );
    res.json({
      organizations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
      })),
    });
  }),
);

app.get(
  '/api/organizations/:name',
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    const session = await getCurrentSession(req);
    const role = session ? await getOrganizationRole(session.account.id, organization.id) : null;
    res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        displayName: organization.display_name,
        role,
        isOwner: role === 'Owner',
      },
    });
  }),
);

app.get(
  '/api/organizations/:name/repositories',
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    const session = await getCurrentSession(req);
    const account = session ? session.account : null;
    const rows = await all(
      'SELECT * FROM repositories WHERE org_id = ? ORDER BY name',
      [organization.id],
    );

    const visible = [];
    for (const row of rows) {
      if (await canReadRepository(account, row)) {
        visible.push({
          id: row.id,
          name: row.name,
          description: row.description,
          visibility: row.visibility,
          updatedAt: row.updated_at,
        });
      }
    }

    const query = requireString(req.query.q).trim().toLowerCase();
    const visibility = requireString(req.query.visibility).trim().toLowerCase();
    const filtered = visible.filter((repository) => {
      const matchesQuery = !query || repository.name.toLowerCase().includes(query);
      const matchesVisibility =
        !visibility || visibility === 'all' || repository.visibility === visibility;
      return matchesQuery && matchesVisibility;
    });

    res.json({ repositories: filtered });
  }),
);

app.get(
  '/api/organizations/:name/people',
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    const rows = await all(
      `SELECT a.id, a.username, a.email, m.role
       FROM org_members m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.org_id = ?
       ORDER BY CASE WHEN m.role = 'Owner' THEN 0 ELSE 1 END, a.username`,
      [organization.id],
    );
    res.json({
      members: rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
      })),
    });
  }),
);

app.post(
  '/api/organizations/:name/people',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const role = normalizeOrganizationRole(req.body?.role, 'Member');
    if (!role) {
      res.status(400).json({ error: 'Role is invalid' });
      return;
    }

    const account = await findAccountByIdentifier(req.body?.identifier ?? req.body?.username);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const existing = await get(
      'SELECT role FROM org_members WHERE org_id = ? AND account_id = ?',
      [organization.id, account.id],
    );
    if (existing) {
      res.status(400).json({ error: 'Account is already a member' });
      return;
    }

    await withTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO org_members (org_id, account_id, role, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [organization.id, account.id, role],
      );
      await tx.run(
        `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
         VALUES (?, ?, 'Member added', ?, datetime('now'))`,
        [organization.id, req.user.id, account.username],
      );
    });

    res.status(201).json({ member: { ...publicAccount(account), role } });
  }),
);

app.delete(
  '/api/organizations/:name/people/:username',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const account = await get('SELECT * FROM accounts WHERE username = ?', [req.params.username]);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const membership = await get(
      'SELECT role FROM org_members WHERE org_id = ? AND account_id = ?',
      [organization.id, account.id],
    );
    if (!membership) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    if (membership.role === 'Owner') {
      const ownerCount = await get(
        `SELECT COUNT(*) AS count FROM org_members WHERE org_id = ? AND role = 'Owner'`,
        [organization.id],
      );
      if (ownerCount.count <= 1) {
        res.status(400).json({ error: 'Cannot remove the last owner' });
        return;
      }
    }

    await withTransaction(async (tx) => {
      await tx.run(
        `DELETE FROM repo_grants
         WHERE account_id = ? AND repository_id IN (
           SELECT id FROM repositories WHERE org_id = ?
         )`,
        [account.id, organization.id],
      );
      await tx.run(
        `DELETE FROM team_members
         WHERE account_id = ? AND team_id IN (
           SELECT id FROM teams WHERE org_id = ?
         )`,
        [account.id, organization.id],
      );
      await tx.run('DELETE FROM org_members WHERE org_id = ? AND account_id = ?', [
        organization.id,
        account.id,
      ]);
      await tx.run(
        `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
         VALUES (?, ?, 'Member removed', ?, datetime('now'))`,
        [organization.id, req.user.id, account.username],
      );
    });

    res.json({ ok: true });
  }),
);

app.get(
  '/api/organizations/:name/teams',
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    const rows = await all(
      `SELECT id, name, parent_team_id
       FROM teams
       WHERE org_id = ?
       ORDER BY name`,
      [organization.id],
    );
    res.json({
      teams: rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentTeamId: row.parent_team_id,
      })),
    });
  }),
);

app.post(
  '/api/organizations/:name/teams',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const name = requireString(req.body?.name ?? req.body?.teamName).trim();
    if (!isValidTeamName(name)) {
      res.status(400).json({ error: 'Team name is invalid' });
      return;
    }

    const existing = await get('SELECT id FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      name,
    ]);
    if (existing) {
      res.status(400).json({ error: 'Team name is already taken' });
      return;
    }

    const result = await run(
      `INSERT INTO teams (org_id, name, parent_team_id, created_at)
       VALUES (?, ?, NULL, datetime('now'))`,
      [organization.id, name],
    );
    await recordAudit(organization.id, req.user.id, 'Team created', name);
    res.status(201).json({ team: { id: result.lastID, name, parentTeamId: null } });
  }),
);

app.get(
  '/api/organizations/:name/teams/:teamName',
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    const team = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      req.params.teamName,
    ]);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    const members = await all(
      `SELECT a.id, a.username
       FROM team_members tm
       JOIN accounts a ON a.id = tm.account_id
       WHERE tm.team_id = ?
       ORDER BY a.username`,
      [team.id],
    );
    const possibleParents = await all(
      'SELECT id, name FROM teams WHERE org_id = ? ORDER BY name',
      [organization.id],
    );
    res.json({
      team: {
        id: team.id,
        name: team.name,
        parentTeamId: team.parent_team_id,
        parentTeam: team.parent_team_id
          ? (await get('SELECT name FROM teams WHERE id = ?', [team.parent_team_id]))?.name || null
          : null,
      },
      members: members.map((row) => ({ id: row.id, username: row.username })),
      possibleParents: possibleParents
        .filter((row) => row.id !== team.id)
        .map((row) => ({ id: row.id, name: row.name })),
    });
  }),
);

app.post(
  '/api/organizations/:name/teams/:teamName/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const team = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      req.params.teamName,
    ]);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const account = await findAccountByIdentifier(req.body?.identifier ?? req.body?.username);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const organizationMembership = await get(
      'SELECT role FROM org_members WHERE org_id = ? AND account_id = ?',
      [organization.id, account.id],
    );
    if (!organizationMembership) {
      res.status(400).json({ error: 'Account is not an organization member' });
      return;
    }
    const existing = await get(
      'SELECT id FROM team_members WHERE team_id = ? AND account_id = ?',
      [team.id, account.id],
    );
    if (existing) {
      res.status(400).json({ error: 'Account is already a team member' });
      return;
    }

    await run(
      `INSERT INTO team_members (team_id, account_id, created_at)
       VALUES (?, ?, datetime('now'))`,
      [team.id, account.id],
    );
    res.status(201).json({ member: { id: account.id, username: account.username } });
  }),
);

app.delete(
  '/api/organizations/:name/teams/:teamName/members/:username',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const team = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      req.params.teamName,
    ]);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    const account = await get('SELECT * FROM accounts WHERE username = ?', [req.params.username]);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    await run('DELETE FROM team_members WHERE team_id = ? AND account_id = ?', [
      team.id,
      account.id,
    ]);
    res.json({ ok: true });
  }),
);

app.patch(
  '/api/organizations/:name/teams/:teamName',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const team = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      req.params.teamName,
    ]);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const parentTeamName = requireString(
      req.body?.parentTeamName ?? req.body?.parentTeam,
    ).trim();
    if (!parentTeamName) {
      await run('UPDATE teams SET parent_team_id = NULL WHERE id = ?', [team.id]);
      res.json({ parentTeam: null });
      return;
    }

    const parent = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
      organization.id,
      parentTeamName,
    ]);
    if (!parent) {
      res.status(400).json({ error: 'Parent team must belong to the same organization' });
      return;
    }

    let cursor = parent;
    while (cursor) {
      if (cursor.id === team.id) {
        res.status(400).json({ error: 'Cyclic team hierarchy is not allowed' });
        return;
      }
      cursor = cursor.parent_team_id
        ? await get('SELECT * FROM teams WHERE id = ?', [cursor.parent_team_id])
        : null;
    }

    await run('UPDATE teams SET parent_team_id = ? WHERE id = ?', [parent.id, team.id]);
    res.json({ parentTeam: parent.name });
  }),
);

app.get(
  '/api/organizations/:name/audit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organization = await findOrganization(req.params.name);
    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!(await isOrganizationOwner(req.user.id, organization.id))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const action = requireString(req.query.action).trim();
    const rows = await all(
      `SELECT e.id, e.action, e.target, e.created_at, a.username AS actor
       FROM audit_events e
       LEFT JOIN accounts a ON a.id = e.actor_account_id
       WHERE e.org_id = ? AND (? = '' OR e.action = ?)
       ORDER BY e.created_at DESC, e.id DESC`,
      [organization.id, action, action],
    );
    res.json({
      events: rows.map((row) => ({
        id: row.id,
        actor: row.actor || 'Unknown',
        action: row.action,
        target: row.target,
        timestamp: row.created_at,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Repository access
// ---------------------------------------------------------------------------

app.get(
  '/api/repositories/:orgName/:repoName',
  asyncHandler(async (req, res) => {
    const repository = await findRepository(req.params.orgName, req.params.repoName);
    if (!repository) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const session = await getCurrentSession(req);
    const account = session ? session.account : null;
    if (!(await canReadRepository(account, repository))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const organization = await get('SELECT * FROM organizations WHERE id = ?', [repository.org_id]);
    res.json({
      repository: {
        id: repository.id,
        name: repository.name,
        fullName: `${organization.name}/${repository.name}`,
        description: repository.description,
        visibility: repository.visibility,
        updatedAt: repository.updated_at,
        canAdmin: await canAdminRepository(account, repository),
      },
    });
  }),
);

app.get(
  '/api/repositories/:orgName/:repoName/access',
  requireAuth,
  asyncHandler(async (req, res) => {
    const repository = await findRepository(req.params.orgName, req.params.repoName);
    if (!repository) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    if (!(await canAdminRepository(req.user, repository))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const rows = await all(
      `SELECT g.id, g.role, g.account_id, g.team_id,
              a.username AS account_username,
              t.name AS team_name
       FROM repo_grants g
       LEFT JOIN accounts a ON a.id = g.account_id
       LEFT JOIN teams t ON t.id = g.team_id
       WHERE g.repository_id = ?
       ORDER BY COALESCE(t.name, a.username)`,
      [repository.id],
    );
    res.json({
      grants: rows.map((row) => ({
        id: row.id,
        role: row.role,
        accountId: row.account_id,
        accountUsername: row.account_username,
        teamId: row.team_id,
        teamName: row.team_name,
      })),
    });
  }),
);

app.post(
  '/api/repositories/:orgName/:repoName/access',
  requireAuth,
  asyncHandler(async (req, res) => {
    const repository = await findRepository(req.params.orgName, req.params.repoName);
    if (!repository) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    if (!(await canAdminRepository(req.user, repository))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const role = normalizeRole(req.body?.role, 'Read');
    if (!role) {
      res.status(400).json({ error: 'Role is invalid' });
      return;
    }

    const teamName = requireString(req.body?.teamName).trim();
    const username = requireString(req.body?.username).trim();
    if (!teamName && !username) {
      res.status(400).json({ error: 'A team or account is required' });
      return;
    }

    if (teamName) {
      const team = await get('SELECT * FROM teams WHERE org_id = ? AND name = ?', [
        repository.org_id,
        teamName,
      ]);
      if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
      }
      const existing = await get(
        'SELECT id FROM repo_grants WHERE repository_id = ? AND team_id = ?',
        [repository.id, team.id],
      );
      if (existing) {
        await run('UPDATE repo_grants SET role = ? WHERE id = ?', [role, existing.id]);
        res.json({ grant: { id: existing.id, teamName, role } });
        return;
      }
      const result = await run(
        `INSERT INTO repo_grants (repository_id, account_id, team_id, role, created_at)
         VALUES (?, NULL, ?, ?, datetime('now'))`,
        [repository.id, team.id, role],
      );
      res.status(201).json({ grant: { id: result.lastID, teamName, role } });
      return;
    }

    const account = await get('SELECT * FROM accounts WHERE username = ?', [username]);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const existing = await get(
      'SELECT id FROM repo_grants WHERE repository_id = ? AND account_id = ?',
      [repository.id, account.id],
    );
    if (existing) {
      await run('UPDATE repo_grants SET role = ? WHERE id = ?', [role, existing.id]);
      res.json({ grant: { id: existing.id, accountUsername: username, role } });
      return;
    }
    const result = await run(
      `INSERT INTO repo_grants (repository_id, account_id, team_id, role, created_at)
       VALUES (?, ?, NULL, ?, datetime('now'))`,
      [repository.id, account.id, role],
    );
    res.status(201).json({ grant: { id: result.lastID, accountUsername: username, role } });
  }),
);

app.patch(
  '/api/repositories/:orgName/:repoName/access/:grantId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const repository = await findRepository(req.params.orgName, req.params.repoName);
    if (!repository) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    if (!(await canAdminRepository(req.user, repository))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const role = normalizeRole(req.body?.role, '');
    if (!role) {
      res.status(400).json({ error: 'Role is invalid' });
      return;
    }
    const grant = await get(
      'SELECT id FROM repo_grants WHERE id = ? AND repository_id = ?',
      [Number(req.params.grantId), repository.id],
    );
    if (!grant) {
      res.status(404).json({ error: 'Grant not found' });
      return;
    }
    await run('UPDATE repo_grants SET role = ? WHERE id = ?', [role, grant.id]);
    res.json({ grant: { id: grant.id, role } });
  }),
);

require('./module2_routes')(app);
require('./module3_routes')(app);
require('./module4_routes')(app);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error('Unhandled request error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));

  app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('html')
      .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Frontend Build Missing</title>
  </head>
  <body>
    <main>
      <h1>Frontend build missing</h1>
      <p>The backend is running, but <code>frontend/dist</code> is not available yet.</p>
    </main>
  </body>
</html>`);
  });
}

module.exports = app;
