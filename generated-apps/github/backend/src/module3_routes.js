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
const { normalizeOrganizationName } = require('./validation');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function issueNumber(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function findRepository(orgName, repoName) {
  return get(
    `SELECT r.*, o.name AS org_name, o.display_name AS org_display_name,
            o.owner_account_id AS org_owner_account_id
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

async function getEffectiveRole(account, repository) {
  if (!account || !repository) return null;
  if ((await getOrganizationRole(account.id, repository.org_id)) === 'Owner') return 'Admin';

  const direct = await get(
    'SELECT role FROM repo_grants WHERE repository_id = ? AND account_id = ?',
    [repository.id, account.id],
  );
  if (direct) return direct.role;

  const team = await get(
    `SELECT g.role FROM repo_grants g
     JOIN team_members tm ON tm.team_id = g.team_id
     WHERE g.repository_id = ? AND tm.account_id = ?
     LIMIT 1`,
    [repository.id, account.id],
  );
  return team ? team.role : null;
}

async function canRead(account, repository) {
  if (!repository) return false;
  if (repository.visibility === 'public') return true;
  if (!account) return false;
  if ((await getOrganizationRole(account.id, repository.org_id)) === 'Owner') return true;
  return Boolean(await getEffectiveRole(account, repository));
}

function canWrite(role) {
  return ['Write', 'Maintain', 'Admin'].includes(role);
}

function canManage(role) {
  return ['Triage', 'Maintain', 'Admin'].includes(role);
}

async function requireRepositoryAccess(req, res) {
  const repository = await findRepository(req.params.orgName, req.params.repoName);
  if (!repository) {
    res.status(404).json({ error: 'Repository not found' });
    return null;
  }
  const session = await getCurrentSession(req);
  const account = session ? session.account : null;
  if (!(await canRead(account, repository))) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return { repository, account };
}

async function issueByNumber(repositoryId, number) {
  return get(
    `SELECT i.*, a.username AS author
     FROM issues i
     LEFT JOIN accounts a ON a.id = i.author_account_id
     WHERE i.repository_id = ? AND i.number = ?`,
    [repositoryId, number],
  );
}

async function issueLabels(issueId) {
  return all(
    `SELECT l.id, l.name, l.color
     FROM issue_labels il
     JOIN repository_labels l ON l.id = il.label_id
     WHERE il.issue_id = ?
     ORDER BY l.name`,
    [issueId],
  );
}

async function issueAssignees(issueId) {
  return all(
    `SELECT a.id, a.username
     FROM issue_assignees ia
     JOIN accounts a ON a.id = ia.account_id
     WHERE ia.issue_id = ?
     ORDER BY a.username`,
    [issueId],
  );
}

async function issueMilestone(issueId) {
  return get(
    `SELECT m.id, m.name, m.description, m.due_date AS dueDate
     FROM issues i
     JOIN milestones m ON m.id = i.milestone_id
     WHERE i.id = ?`,
    [issueId],
  );
}

async function issueComments(issueId) {
  return all(
    `SELECT c.id, c.body, c.created_at AS createdAt, a.username AS author
     FROM issue_comments c
     LEFT JOIN accounts a ON a.id = c.author_account_id
     WHERE c.issue_id = ?
     ORDER BY c.id`,
    [issueId],
  );
}

async function issueEvents(issueId) {
  return all(
    `SELECT e.id, e.event_type AS eventType, e.detail, e.created_at AS createdAt,
            a.username AS actor
     FROM issue_events e
     LEFT JOIN accounts a ON a.id = e.actor_account_id
     WHERE e.issue_id = ?
     ORDER BY e.id`,
    [issueId],
  );
}

async function issueReactions(issueId, accountId = null) {
  const rows = await all(
    `SELECT reaction, COUNT(*) AS count
     FROM issue_reactions
     WHERE issue_id = ?
     GROUP BY reaction
     ORDER BY reaction`,
    [issueId],
  );
  const mine = accountId
    ? await all(
        'SELECT reaction FROM issue_reactions WHERE issue_id = ? AND account_id = ?',
        [issueId, accountId],
      )
    : [];
  const mineSet = new Set(mine.map((row) => row.reaction));
  return rows.map((row) => ({
    type: row.reaction,
    count: Number(row.count),
    reacted: mineSet.has(row.reaction),
  }));
}

async function issueSummary(issue) {
  if (!issue) return null;
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    status: issue.status,
    author: issue.author || null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    labels: await issueLabels(issue.id),
  };
}

async function issueDetail(issue, account, repository) {
  if (!issue) return null;
  const role = await getEffectiveRole(account, repository);
  const labels = await issueLabels(issue.id);
  const assignees = await issueAssignees(issue.id);
  const milestone = await issueMilestone(issue.id);
  const comments = await issueComments(issue.id);
  const events = await issueEvents(issue.id);
  const reactions = await issueReactions(issue.id, account ? account.id : null);
  return {
    ...(await issueSummary(issue)),
    description: issue.description || '',
    closedAt: issue.closed_at,
    assignees,
    milestone,
    comments,
    activity: events,
    reactions,
    permissions: {
      canEdit: canWrite(role),
      canComment: canWrite(role),
      canManage: canManage(role),
      canReact: Boolean(account) && (await canRead(account, repository)),
      canView: await canRead(account, repository),
    },
  };
}

async function issueCandidates(repository, queryText = '') {
  const q = text(queryText).trim().toLowerCase();
  const rows = await all(
    `SELECT DISTINCT a.id, a.username
     FROM accounts a
     LEFT JOIN org_members om ON om.account_id = a.id AND om.org_id = ?
     LEFT JOIN repo_grants rg ON rg.account_id = a.id AND rg.repository_id = ?
     LEFT JOIN team_members tm ON tm.account_id = a.id
     LEFT JOIN repo_grants trg ON trg.team_id = tm.team_id AND trg.repository_id = ?
     WHERE (om.account_id IS NOT NULL OR rg.id IS NOT NULL OR trg.id IS NOT NULL)
       AND (? = '' OR lower(a.username) LIKE ?)
     ORDER BY a.username`,
    [
      repository.org_id,
      repository.id,
      repository.id,
      q,
      `%${q}%`,
    ],
  );
  return rows;
}

async function recordIssueEvent(issueId, actorId, eventType, detail) {
  await run(
    `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [issueId, actorId, eventType, detail || ''],
  );
}

function titleError(value) {
  const title = text(value).trim();
  if (!title) return 'Title is required';
  if (title.length > 256) return 'Title is too long (maximum 256 characters)';
  return null;
}

function descriptionError(value) {
  if (typeof value !== 'string') return 'Description is invalid';
  if (value.length > 65536) return 'Description is too long (maximum 65536 characters)';
  return null;
}

function commentError(value) {
  const body = text(value).trim();
  if (!body) return 'Comment is required';
  if (body.length > 65536) return 'Comment is too long (maximum 65536 characters)';
  return null;
}

function registerModule3Routes(app) {
  app.get(
    '/api/repository-details/:orgName/:repoName/issues',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository, account } = access;
      const statusFilter = text(req.query.status).trim().toLowerCase();
      const q = text(req.query.q).trim().toLowerCase();
      const params = [repository.id];
      let where = 'WHERE i.repository_id = ?';
      if (statusFilter === 'open' || statusFilter === 'closed') {
        where += ' AND lower(i.status) = ?';
        params.push(statusFilter);
      }
      if (q) {
        where += ' AND lower(i.title) LIKE ?';
        params.push(`%${q}%`);
      }
      const rows = await all(
        `SELECT i.*, a.username AS author
         FROM issues i
         LEFT JOIN accounts a ON a.id = i.author_account_id
         ${where}
         ORDER BY i.number DESC`,
        params,
      );
      const issues = [];
      for (const row of rows) {
        issues.push(await issueSummary(row));
      }
      res.json({ issues, canWrite: canWrite(await getEffectiveRole(account, repository)) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canWrite(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (repository.archived) {
        res.status(403).json({ error: 'Repository is archived' });
        return;
      }

      const title = text(req.body?.title).trim();
      const description = text(req.body?.description);
      const errors = {};
      const titleIssue = titleError(req.body?.title);
      if (titleIssue) errors.title = titleIssue;
      const descriptionIssue = descriptionError(description);
      if (descriptionIssue) errors.description = descriptionIssue;
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }

      const issueId = await withTransaction(async (tx) => {
        const nextRow = await tx.get(
          'SELECT COALESCE(MAX(number), 0) + 1 AS nextNumber FROM issues WHERE repository_id = ?',
          [repository.id],
        );
        const number = Number(nextRow?.nextNumber || 1);
        const result = await tx.run(
          `INSERT INTO issues
           (repository_id, number, title, description, status, author_account_id,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Open', ?, datetime('now'), datetime('now'))`,
          [repository.id, number, title, description, req.user.id],
        );
        await tx.run(
          `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'created', 'opened this issue', datetime('now'))`,
          [result.lastID, req.user.id],
        );
        return result.lastID;
      });

      const issue = await issueByNumber(repository.id, (await get(
        'SELECT number FROM issues WHERE id = ?',
        [issueId],
      )).number);
      res.status(201).json({ issue: await issueDetail(issue, req.user, repository) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/issues/:number',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const number = issueNumber(req.params.number);
      if (!number) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const issue = await issueByNumber(access.repository.id, number);
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      res.json({ issue: await issueDetail(issue, access.account, access.repository) });
    }),
  );

  app.patch(
    '/api/repository-details/:orgName/:repoName/issues/:number',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canWrite(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const hasTitle = Object.prototype.hasOwnProperty.call(req.body || {}, 'title');
      const hasDescription = Object.prototype.hasOwnProperty.call(req.body || {}, 'description');
      if (!hasTitle && !hasDescription) {
        res.status(400).json({ errors: { form: 'No issue fields were provided' } });
        return;
      }

      const errors = {};
      const nextTitle = hasTitle ? text(req.body.title).trim() : issue.title;
      const nextDescription = hasDescription ? text(req.body.description) : issue.description;
      if (hasTitle) {
        const error = titleError(req.body.title);
        if (error) errors.title = error;
      }
      if (hasDescription) {
        const error = descriptionError(req.body.description);
        if (error) errors.description = error;
      }
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }

      await withTransaction(async (tx) => {
        await tx.run(
          'UPDATE issues SET title = ?, description = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [nextTitle, nextDescription, issue.id],
        );
        if (hasTitle && nextTitle !== issue.title) {
          await tx.run(
            `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
             VALUES (?, ?, 'renamed', ?, datetime('now'))`,
            [issue.id, req.user.id, `changed the title from "${issue.title}" to "${nextTitle}"`],
          );
        }
        if (hasDescription && nextDescription !== issue.description) {
          await tx.run(
            `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
             VALUES (?, ?, 'description_changed', 'changed the description', datetime('now'))`,
            [issue.id, req.user.id],
          );
        }
      });

      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canWrite(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const body = text(req.body?.body ?? req.body?.comment).trim();
      const error = commentError(body);
      if (error) {
        res.status(400).json({ errors: { body: error } });
        return;
      }
      const commentId = await withTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO issue_comments (issue_id, author_account_id, body, created_at)
           VALUES (?, ?, ?, datetime('now'))`,
          [issue.id, req.user.id, body],
        );
        await tx.run(
          `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'commented', ?, datetime('now'))`,
          [issue.id, req.user.id, body],
        );
        return result.lastID;
      });
      const comment = await get(
        `SELECT c.id, c.body, c.created_at AS createdAt, a.username AS author
         FROM issue_comments c
         LEFT JOIN accounts a ON a.id = c.author_account_id
         WHERE c.id = ?`,
        [commentId],
      );
      res.status(201).json({ comment });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/issues/:number/assignees',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(access.repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      res.json({
        assignees: await issueCandidates(access.repository, req.query.q),
        selected: (await issueAssignees(issue.id)).map((row) => row.username),
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/assignees',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canManage(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const username = text(req.body?.username).trim();
      const candidates = await issueCandidates(repository, username);
      const candidate = candidates.find((row) => row.username === username);
      if (!candidate) {
        res.status(400).json({ errors: { username: 'Assignee is invalid' } });
        return;
      }
      const existing = await get(
        'SELECT 1 AS present FROM issue_assignees WHERE issue_id = ? AND account_id = ?',
        [issue.id, candidate.id],
      );
      const shouldAssign = req.body?.assigned === false
        ? false
        : req.body?.assigned === true
          ? true
          : !existing;
      if (shouldAssign && !existing) {
        await run(
          `INSERT INTO issue_assignees (issue_id, account_id, created_at)
           VALUES (?, ?, datetime('now'))`,
          [issue.id, candidate.id],
        );
        await recordIssueEvent(issue.id, req.user.id, 'assigned', `assigned ${candidate.username}`);
      } else if (!shouldAssign && existing) {
        await run('DELETE FROM issue_assignees WHERE issue_id = ? AND account_id = ?', [
          issue.id,
          candidate.id,
        ]);
        await recordIssueEvent(issue.id, req.user.id, 'unassigned', `unassigned ${candidate.username}`);
      }
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/labels',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const labels = await all(
        'SELECT id, name, color FROM repository_labels WHERE repository_id = ? ORDER BY name',
        [access.repository.id],
      );
      res.json({ labels });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/labels',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canManage(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const name = text(req.body?.name).trim();
      const label = await get(
        'SELECT id, name FROM repository_labels WHERE repository_id = ? AND name = ?',
        [repository.id, name],
      );
      if (!label) {
        res.status(400).json({ errors: { name: 'Label is invalid' } });
        return;
      }
      const existing = await get(
        'SELECT 1 AS present FROM issue_labels WHERE issue_id = ? AND label_id = ?',
        [issue.id, label.id],
      );
      if (!existing) {
        await run(
          `INSERT INTO issue_labels (issue_id, label_id, created_at)
           VALUES (?, ?, datetime('now'))`,
          [issue.id, label.id],
        );
        await recordIssueEvent(issue.id, req.user.id, 'labeled', `added the ${label.name} label`);
      }
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/milestones',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const milestones = await all(
        'SELECT id, name, description, due_date AS dueDate FROM milestones WHERE repository_id = ? ORDER BY name',
        [access.repository.id],
      );
      res.json({ milestones });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/milestone',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canManage(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const name = text(req.body?.name).trim();
      const milestone = await get(
        'SELECT id, name FROM milestones WHERE repository_id = ? AND name = ?',
        [repository.id, name],
      );
      if (!milestone) {
        res.status(400).json({ errors: { name: 'Milestone is invalid' } });
        return;
      }
      await run('UPDATE issues SET milestone_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        milestone.id,
        issue.id,
      ]);
      await recordIssueEvent(issue.id, req.user.id, 'milestoned', `added this issue to ${milestone.name}`);
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/close',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canManage(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      if (issue.status === 'Closed') {
        res.status(400).json({ error: 'Issue is already closed' });
        return;
      }
      await withTransaction(async (tx) => {
        await tx.run(
          `UPDATE issues SET status = 'Closed', closed_at = datetime('now'),
           updated_at = datetime('now') WHERE id = ?`,
          [issue.id],
        );
        await tx.run(
          `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'closed', 'closed this issue', datetime('now'))`,
          [issue.id, req.user.id],
        );
      });
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/reopen',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canManage(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      if (issue.status === 'Open') {
        res.status(400).json({ error: 'Issue is already open' });
        return;
      }
      await withTransaction(async (tx) => {
        await tx.run(
          `UPDATE issues SET status = 'Open', closed_at = NULL,
           updated_at = datetime('now') WHERE id = ?`,
          [issue.id],
        );
        await tx.run(
          `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'reopened', 'reopened this issue', datetime('now'))`,
          [issue.id, req.user.id],
        );
      });
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/issues/:number/reactions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      if (!(await canRead(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const number = issueNumber(req.params.number);
      const issue = number ? await issueByNumber(repository.id, number) : null;
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      const reaction = text(req.body?.type ?? req.body?.reaction).trim() || '+1';
      if (reaction !== '+1') {
        res.status(400).json({ errors: { reaction: 'Reaction is invalid' } });
        return;
      }
      const existing = await get(
        'SELECT id FROM issue_reactions WHERE issue_id = ? AND account_id = ? AND reaction = ?',
        [issue.id, req.user.id, reaction],
      );
      if (existing) {
        await run('DELETE FROM issue_reactions WHERE id = ?', [existing.id]);
      } else {
        await run(
          `INSERT INTO issue_reactions (issue_id, account_id, reaction, created_at)
           VALUES (?, ?, ?, datetime('now'))`,
          [issue.id, req.user.id, reaction],
        );
      }
      const updated = await issueByNumber(repository.id, number);
      res.json({ issue: await issueDetail(updated, req.user, repository) });
    }),
  );
}

module.exports = registerModule3Routes;
