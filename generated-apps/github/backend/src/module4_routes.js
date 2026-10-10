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

function bool(value) {
  return value === true || value === 'true' || value === 'on';
}

function prNumber(value) {
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

function canMaintain(role) {
  return ['Maintain', 'Admin'].includes(role);
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

async function getBranch(repositoryId, branchName) {
  return get('SELECT * FROM branches WHERE repository_id = ? AND name = ?', [
    repositoryId,
    text(branchName).trim(),
  ]);
}

async function getPullRequest(repositoryId, number) {
  return get(
    `SELECT pr.*, a.username AS author
     FROM pull_requests pr
     LEFT JOIN accounts a ON a.id = pr.author_account_id
     WHERE pr.repository_id = ? AND pr.number = ?`,
    [repositoryId, number],
  );
}

async function prCommits(repository, pr) {
  if (!pr) return [];
  const branch = await getBranch(repository.id, pr.compare_branch);
  if (!branch) return [];
  const rows = await all(
    `SELECT c.id, c.message, c.author_name AS authorName, c.created_at AS createdAt,
            c.additions, c.deletions, c.parent_commit_id AS parentCommitId
     FROM commits c
     WHERE c.repository_id = ? AND c.branch_id = ?
     ORDER BY c.created_at DESC, c.id DESC`,
    [repository.id, branch.id],
  );
  if (rows.length === 0) {
    return [
      {
        id: pr.compare_commit_id || 0,
        message: `Compare branch ${pr.compare_branch}`,
        authorName: pr.author || 'unknown',
        createdAt: pr.created_at,
        additions: 0,
        deletions: 0,
        parentCommitId: pr.base_commit_id || null,
      },
    ];
  }
  return rows;
}

function countLines(value) {
  return text(value).split('\n').filter((line, index, array) => index < array.length - 1 || line !== '').length;
}

async function changedFilesForPr(repository, pr) {
  if (!pr) return [];
  const base = await getBranch(repository.id, pr.base_branch);
  const compare = await getBranch(repository.id, pr.compare_branch);
  if (!compare) return [];
  const baseFiles = base
    ? await all('SELECT path, content FROM repository_files WHERE repository_id = ? AND branch_id = ?', [
        repository.id,
        base.id,
      ])
    : [];
  const compareFiles = await all(
    'SELECT path, content FROM repository_files WHERE repository_id = ? AND branch_id = ?',
    [repository.id, compare.id],
  );
  const baseMap = new Map(baseFiles.map((row) => [row.path, row.content]));
  const compareMap = new Map(compareFiles.map((row) => [row.path, row.content]));
  const paths = Array.from(new Set([...baseMap.keys(), ...compareMap.keys()])).sort();
  const files = [];
  for (const path of paths) {
    const oldContent = baseMap.has(path) ? baseMap.get(path) : null;
    const newContent = compareMap.has(path) ? compareMap.get(path) : null;
    if (oldContent === newContent) continue;
    let additions = 0;
    let deletions = 0;
    if (oldContent === null) {
      additions = Math.max(1, countLines(newContent));
    } else if (newContent === null) {
      deletions = Math.max(1, countLines(oldContent));
    } else {
      const oldLines = countLines(oldContent);
      const newLines = countLines(newContent);
      additions = Math.max(1, Math.abs(newLines - oldLines));
      deletions = Math.max(1, Math.abs(oldLines - Math.max(0, oldLines - additions)));
    }
    files.push({
      path,
      additions,
      deletions,
      changeType: oldContent === null ? 'added' : newContent === null ? 'deleted' : 'modified',
      oldContent: oldContent || '',
      newContent: newContent || '',
    });
  }
  return files;
}

async function prChecks(prId) {
  const rows = await all(
    `SELECT c.name, c.status, c.updated_at AS updatedAt, a.username AS setter
     FROM pr_checks c
     LEFT JOIN accounts a ON a.id = c.setter_account_id
     WHERE c.pull_request_id = ?
     ORDER BY c.name`,
    [prId],
  );
  return rows.map((row) => ({
    name: row.name,
    status: row.status,
    setter: row.setter || null,
    updatedAt: row.updatedAt,
  }));
}

async function prReviewers(prId) {
  const rows = await all(
    `SELECT a.id, a.username, r.created_at AS requestedAt
     FROM pr_reviewers r
     JOIN accounts a ON a.id = r.account_id
     WHERE r.pull_request_id = ?
     ORDER BY a.username`,
    [prId],
  );
  return rows.map((row) => ({ id: row.id, username: row.username, requestedAt: row.requestedAt }));
}

async function prReviews(prId) {
  const rows = await all(
    `SELECT r.id, r.decision, r.summary, r.status, r.compare_commit_id AS compareCommitId,
            r.created_at AS createdAt, r.submitted_at AS submittedAt, a.username AS reviewer
     FROM pr_reviews r
     LEFT JOIN accounts a ON a.id = r.reviewer_account_id
     WHERE r.pull_request_id = ?
     ORDER BY r.id DESC`,
    [prId],
  );
  return rows.map((row) => ({
    id: row.id,
    reviewer: row.reviewer,
    decision: row.decision,
    summary: row.summary,
    status: row.status,
    compareCommitId: row.compareCommitId,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
  }));
}

async function latestReviewsByReviewer(prId) {
  const rows = await all(
    `SELECT r.*, a.username AS reviewer
     FROM pr_reviews r
     LEFT JOIN accounts a ON a.id = r.reviewer_account_id
     WHERE r.pull_request_id = ? AND r.status = 'submitted' AND r.decision IS NOT NULL
     ORDER BY r.id DESC`,
    [prId],
  );
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.reviewer_account_id)) latest.set(row.reviewer_account_id, row);
  }
  return Array.from(latest.values());
}

async function prActivities(prId) {
  const rows = await all(
    `SELECT e.id, e.event_type AS eventType, e.detail, e.created_at AS createdAt, a.username AS actor
     FROM pr_activities e
     LEFT JOIN accounts a ON a.id = e.actor_account_id
     WHERE e.pull_request_id = ?
     ORDER BY e.id`,
    [prId],
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    detail: row.detail,
    actor: row.actor,
    createdAt: row.createdAt,
  }));
}

async function prReviewComments(prId) {
  const rows = await all(
    `SELECT c.id, c.body, c.path, c.line, c.side, c.state, c.created_at AS createdAt,
            a.username AS author
     FROM pr_review_comments c
     LEFT JOIN accounts a ON a.id = c.author_account_id
     WHERE c.pull_request_id = ?
     ORDER BY c.id`,
    [prId],
  );
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    path: row.path,
    line: row.line,
    side: row.side,
    state: row.state,
    author: row.author,
    createdAt: row.createdAt,
  }));
}

async function getProtectionRule(repositoryId, branchName) {
  const rows = await all(
    `SELECT * FROM branch_protection_rules
     WHERE repository_id = ? AND (branch_pattern = ? OR branch_pattern = '*')
     ORDER BY CASE WHEN branch_pattern = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [repositoryId, branchName, branchName],
  );
  return rows[0] || null;
}

async function evaluateMerge(repository, pr, account) {
  const conditions = [];
  const base = await getBranch(repository.id, pr.base_branch);
  conditions.push({
    key: 'target',
    label: 'Target branch exists',
    satisfied: Boolean(base),
    detail: base ? '' : 'Target branch is missing',
  });
  conditions.push({
    key: 'conflict',
    label: 'No merge conflicts',
    satisfied: !pr.merge_conflict,
    detail: pr.merge_conflict ? 'Merge conflict detected' : '',
  });

  const reviews = await latestReviewsByReviewer(pr.id);
  const requestChanges = reviews.some(
    (review) =>
      review.decision === 'Request changes' &&
      (!review.compare_commit_id || review.compare_commit_id === pr.compare_commit_id),
  );
  conditions.push({
    key: 'request_changes',
    label: 'No valid request changes',
    satisfied: !requestChanges,
    detail: requestChanges ? 'Request changes prohibits merge' : '',
  });

  if (base) {
    const rule = await getProtectionRule(repository.id, base.name);
    if (rule) {
      const currentApprovals = reviews.filter(
        (review) =>
          review.decision === 'Approve' &&
          review.reviewer_account_id !== pr.author_account_id &&
          (!review.compare_commit_id || review.compare_commit_id === pr.compare_commit_id),
      ).length;
      if (rule.require_approval) {
        const satisfied = currentApprovals >= 1;
        conditions.push({
          key: 'approval',
          label: 'Review required by branch protection',
          satisfied,
          detail: satisfied ? '' : 'Review required by branch protection',
        });
      }
      if (rule.require_status_check) {
        const check = await get(
          'SELECT * FROM pr_checks WHERE pull_request_id = ? AND name = ?',
          [pr.id, rule.status_check_name || 'test'],
        );
        const satisfied = Boolean(check && check.status === 'success');
        conditions.push({
          key: 'status_check',
          label: `${rule.status_check_name || 'test'} status check`,
          satisfied,
          detail: satisfied ? '' : `${rule.status_check_name || 'test'} status check is required`,
        });
      }
    }
  }

  const mergeable =
    pr.status === 'Open' &&
    !repository.archived &&
    conditions.every((condition) => condition.satisfied);
  const reasons = conditions.filter((condition) => !condition.satisfied).map((condition) => condition.detail || condition.label);
  return { mergeable, conditions, reasons };
}

async function prSummary(repository, pr, account) {
  if (!pr) return null;
  const role = await getEffectiveRole(account, repository);
  const evaluation = await evaluateMerge(repository, pr, account);
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    description: pr.description || '',
    status: pr.status,
    author: pr.author || null,
    baseBranch: pr.base_branch,
    compareBranch: pr.compare_branch,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    mergedBy: pr.merged_by_account_id,
    mergedAt: pr.merged_at,
    mergeCommitId: pr.merge_commit_id,
    mergeable: evaluation.mergeable,
    mergeConditions: evaluation.conditions,
    mergeReasons: evaluation.reasons,
    permissions: {
      canWrite: canWrite(role),
      canReview: canWrite(role) && account && account.id !== pr.author_account_id && pr.status === 'Open',
      canMerge: Boolean(account),
      canClose: Boolean(account) && (account.id === pr.author_account_id || canMaintain(role)) && ['Open', 'Draft'].includes(pr.status),
      canReopen: Boolean(account) && (account.id === pr.author_account_id || canMaintain(role)) && pr.status === 'Closed',
      canReady: Boolean(account) && (account.id === pr.author_account_id || canMaintain(role)) && pr.status === 'Draft',
      canManageReviewers: Boolean(account) && (account.id === pr.author_account_id || canMaintain(role)),
      canManageChecks: role === 'Admin',
    },
  };
}

async function prDetail(repository, pr, account) {
  if (!pr) return null;
  const base = await getBranch(repository.id, pr.base_branch);
  const compare = await getBranch(repository.id, pr.compare_branch);
  const files = await changedFilesForPr(repository, pr);
  const additions = files.reduce((sum, file) => sum + Number(file.additions || 0), 0);
  const deletions = files.reduce((sum, file) => sum + Number(file.deletions || 0), 0);
  const detail = await prSummary(repository, pr, account);
  return {
    ...detail,
    baseCommitId: pr.base_commit_id,
    compareCommitId: pr.compare_commit_id,
    baseBranchExists: Boolean(base),
    compareBranchExists: Boolean(compare),
    checks: await prChecks(pr.id),
    reviewers: await prReviewers(pr.id),
    reviews: await prReviews(pr.id),
    comments: await prReviewComments(pr.id),
    activities: await prActivities(pr.id),
    files,
    additions,
    deletions,
  };
}

async function recordPrActivity(prId, actorId, eventType, detail) {
  await run(
    `INSERT INTO pr_activities (pull_request_id, actor_account_id, event_type, detail, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [prId, actorId, eventType, detail || ''],
  );
}

function registerModule4Routes(app) {
  app.get(
    '/api/repository-details/:orgName/:repoName/pulls',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository, account } = access;
      const statusFilter = text(req.query.status).trim().toLowerCase();
      const params = [repository.id];
      let where = 'WHERE pr.repository_id = ?';
      if (statusFilter === 'open' || statusFilter === 'closed' || statusFilter === 'draft' || statusFilter === 'merged') {
        where += ' AND lower(pr.status) = ?';
        params.push(statusFilter);
      }
      const rows = await all(
        `SELECT pr.*, a.username AS author
         FROM pull_requests pr
         LEFT JOIN accounts a ON a.id = pr.author_account_id
         ${where}
         ORDER BY pr.number DESC`,
        params,
      );
      const pulls = [];
      for (const row of rows) {
        pulls.push(await prSummary(repository, row, account));
      }
      res.json({
        pulls,
        canWrite: canWrite(await getEffectiveRole(account, repository)),
        repository: {
          fullName: `${repository.org_name}/${repository.name}`,
          name: repository.name,
          owner: repository.org_name,
          archived: Boolean(repository.archived),
        },
      });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/pulls/compare',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository } = access;
      const baseName = text(req.query.base) || repository.default_branch || 'main';
      const compareName = text(req.query.compare);
      const base = await getBranch(repository.id, baseName);
      const compare = await getBranch(repository.id, compareName);
      if (!base || !compare) {
        res.status(400).json({ error: 'Base and compare branches must exist' });
        return;
      }
      if (base.name === compare.name) {
        res.json({
          identical: true,
          baseBranch: base.name,
          compareBranch: compare.name,
          changedFiles: [],
          additions: 0,
          deletions: 0,
          commits: [],
          message: 'There are no differences between these branches.',
        });
        return;
      }
      const pseudoPr = {
        base_branch: base.name,
        compare_branch: compare.name,
      };
      const files = await changedFilesForPr(repository, pseudoPr);
      const commits = await all(
        `SELECT c.id, c.message, c.author_name AS authorName, c.created_at AS createdAt
         FROM commits c
         WHERE c.repository_id = ? AND c.branch_id = ?
         ORDER BY c.created_at DESC, c.id DESC`,
        [repository.id, compare.id],
      );
      res.json({
        identical: files.length === 0 && commits.length === 0,
        baseBranch: base.name,
        compareBranch: compare.name,
        changedFiles: files,
        additions: files.reduce((sum, file) => sum + Number(file.additions || 0), 0),
        deletions: files.reduce((sum, file) => sum + Number(file.deletions || 0), 0),
        commits,
        message: files.length === 0 && commits.length === 0 ? 'There are no differences between these branches.' : '',
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls',
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
      const baseName = text(req.body?.base ?? req.body?.baseBranch).trim() || repository.default_branch || 'main';
      const compareName = text(req.body?.compare ?? req.body?.compareBranch).trim();
      const draft = bool(req.body?.draft);
      const base = await getBranch(repository.id, baseName);
      const compare = await getBranch(repository.id, compareName);
      const errors = {};
      if (!title) errors.title = 'Title is required';
      if (!base) errors.base = 'Base branch is invalid';
      if (!compare) errors.compare = 'Compare branch is invalid';
      if (base && compare && base.name === compare.name) errors.compare = 'Compare branch must differ from base branch';
      if (Object.keys(errors).length > 0) {
        res.status(400).json({ errors });
        return;
      }
      const prId = await withTransaction(async (tx) => {
        const nextRow = await tx.get(
          'SELECT COALESCE(MAX(number), 0) + 1 AS nextNumber FROM pull_requests WHERE repository_id = ?',
          [repository.id],
        );
        const number = Number(nextRow?.nextNumber || 1);
        const result = await tx.run(
          `INSERT INTO pull_requests
           (repository_id, number, title, description, author_account_id, base_branch, compare_branch,
            base_commit_id, compare_commit_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            repository.id,
            number,
            title,
            description,
            req.user.id,
            base.name,
            compare.name,
            base.head_commit_id || null,
            compare.head_commit_id || null,
            draft ? 'Draft' : 'Open',
          ],
        );
        await tx.run(
          `INSERT INTO pr_activities (pull_request_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'created', 'opened this pull request', datetime('now'))`,
          [result.lastID, req.user.id],
        );
        return result.lastID;
      });
      const pr = await getPullRequest(repository.id, (await get(
        'SELECT number FROM pull_requests WHERE id = ?',
        [prId],
      )).number);
      res.status(201).json({ pullRequest: await prDetail(repository, pr, req.user) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/pulls/:number',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository, account } = access;
      const number = prNumber(req.params.number);
      if (!number) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const pr = await getPullRequest(repository.id, number);
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      res.json({ pullRequest: await prDetail(repository, pr, account) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/pulls/:number/commits',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository } = access;
      const number = prNumber(req.params.number);
      const pr = number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      res.json({ commits: await prCommits(repository, pr) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/pulls/:number/files',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository, account } = access;
      const number = prNumber(req.params.number);
      const pr = number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const files = await changedFilesForPr(repository, pr);
      res.json({
        pullRequest: await prSummary(repository, pr, account),
        files,
        additions: files.reduce((sum, file) => sum + Number(file.additions || 0), 0),
        deletions: files.reduce((sum, file) => sum + Number(file.deletions || 0), 0),
        comments: await prReviewComments(pr.id),
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/reviews',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const number = prNumber(req.params.number);
      const pr = number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canWrite(role) || req.user.id === pr.author_account_id || pr.status !== 'Open') {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const rawDecision = text(req.body?.decision).trim().toLowerCase();
      const decision = rawDecision === 'approve' ? 'Approve' : rawDecision === 'request_changes' ? 'Request changes' : null;
      if (!decision) {
        res.status(400).json({ errors: { decision: 'Review decision is invalid' } });
        return;
      }
      const summary = text(req.body?.summary);
      await withTransaction(async (tx) => {
        const result = await tx.run(
          `INSERT INTO pr_reviews
           (pull_request_id, reviewer_account_id, decision, summary, compare_commit_id, status, created_at, submitted_at)
           VALUES (?, ?, ?, ?, ?, 'submitted', datetime('now'), datetime('now'))`,
          [pr.id, req.user.id, decision, summary, pr.compare_commit_id || null],
        );
        await tx.run(
          `INSERT INTO pr_activities (pull_request_id, actor_account_id, event_type, detail, created_at)
           VALUES (?, ?, 'reviewed', ?, datetime('now'))`,
          [pr.id, req.user.id, decision === 'Approve' ? 'approved these changes' : 'requested changes'],
        );
        await tx.run(
          `UPDATE pr_review_comments
           SET state = 'published', review_id = ?
           WHERE pull_request_id = ? AND state = 'pending' AND author_account_id = ?`,
          [result.lastID, pr.id, req.user.id],
        );
      });
      const updated = await getPullRequest(repository.id, number);
      res.status(201).json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/review-comments',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const number = prNumber(req.params.number);
      const pr = number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canWrite(role) || req.user.id === pr.author_account_id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const body = text(req.body?.body).trim();
      const path = text(req.body?.path).trim();
      const line = Number.parseInt(String(req.body?.line ?? '1'), 10) || 1;
      if (!body) {
        res.status(400).json({ errors: { body: 'Comment is required' } });
        return;
      }
      if (!path) {
        res.status(400).json({ errors: { path: 'Changed file is required' } });
        return;
      }
      const pending = bool(req.body?.pending);
      const result = await run(
        `INSERT INTO pr_review_comments
         (pull_request_id, author_account_id, body, path, line, side, state, commit_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'RIGHT', ?, ?, datetime('now'))`,
        [pr.id, req.user.id, body, path, line, pending ? 'pending' : 'published', pr.compare_commit_id || null],
      );
      await recordPrActivity(
        pr.id,
        req.user.id,
        pending ? 'pending_review_comment' : 'commented',
        pending ? 'started a review' : 'commented on a changed line',
      );
      const updated = await getPullRequest(repository.id, number);
      res.status(201).json({
        comment: { id: result.lastID, body, path, line, state: pending ? 'pending' : 'published' },
        pullRequest: await prDetail(repository, updated, req.user),
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/ready',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (pr.status !== 'Draft') {
        res.status(400).json({ error: 'Pull request is not a draft' });
        return;
      }
      await run("UPDATE pull_requests SET status = 'Open', updated_at = datetime('now') WHERE id = ?", [pr.id]);
      await recordPrActivity(pr.id, req.user.id, 'ready_for_review', 'marked this pull request ready for review');
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/close',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (!['Open', 'Draft'].includes(pr.status)) {
        res.status(400).json({ error: 'Pull request cannot be closed' });
        return;
      }
      await run("UPDATE pull_requests SET status = 'Closed', updated_at = datetime('now') WHERE id = ?", [pr.id]);
      await recordPrActivity(pr.id, req.user.id, 'closed', 'closed this pull request');
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/reopen',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (pr.status !== 'Closed') {
        res.status(400).json({ error: 'Pull request cannot be reopened' });
        return;
      }
      await run("UPDATE pull_requests SET status = 'Open', updated_at = datetime('now') WHERE id = ?", [pr.id]);
      await recordPrActivity(pr.id, req.user.id, 'reopened', 'reopened this pull request');
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/merge',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      if (!repository) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const number = prNumber(req.params.number);
      const pr = number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!canMaintain(role)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (repository.archived) {
        res.status(400).json({ error: 'Repository is archived' });
        return;
      }
      let blocked = null;
      try {
        await withTransaction(async (tx) => {
          const latest = await tx.get(
            `SELECT pr.*, a.username AS author
             FROM pull_requests pr
             LEFT JOIN accounts a ON a.id = pr.author_account_id
             WHERE pr.id = ?`,
            [pr.id],
          );
          if (!latest || latest.status !== 'Open') {
            blocked = { status: 400, error: 'Pull request cannot be merged' };
            throw new Error('blocked');
          }
          const evaluation = await evaluateMerge(repository, latest, req.user);
          if (!evaluation.mergeable) {
            blocked = { status: 409, error: evaluation.reasons[0] || 'Pull request cannot be merged', conditions: evaluation.conditions };
            throw new Error('blocked');
          }
          const base = await tx.get('SELECT * FROM branches WHERE repository_id = ? AND name = ?', [
            repository.id,
            latest.base_branch,
          ]);
          const compare = await tx.get('SELECT * FROM branches WHERE repository_id = ? AND name = ?', [
            repository.id,
            latest.compare_branch,
          ]);
          const compareFiles = await tx.all(
            'SELECT * FROM repository_files WHERE repository_id = ? AND branch_id = ?',
            [repository.id, compare.id],
          );
          for (const file of compareFiles) {
            const existing = await tx.get(
              'SELECT id FROM repository_files WHERE repository_id = ? AND branch_id = ? AND path = ?',
              [repository.id, base.id, file.path],
            );
            if (existing) {
              await tx.run(
                "UPDATE repository_files SET content = ?, updated_at = datetime('now') WHERE id = ?",
                [file.content, existing.id],
              );
            } else {
              await tx.run(
                `INSERT INTO repository_files (repository_id, branch_id, path, content, created_at, updated_at)
                 VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
                [repository.id, base.id, file.path, file.content],
              );
            }
          }
          const mergeCommit = await tx.run(
            `INSERT INTO commits
             (repository_id, branch_id, parent_commit_id, message, author_account_id, author_name,
              additions, deletions, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'))`,
            [
              repository.id,
              base.id,
              base.head_commit_id || null,
              `Merge pull request #${latest.number} from ${latest.compare_branch}`,
              req.user.id,
              req.user.username,
            ],
          );
          const files = await changedFilesForPr(repository, latest);
          for (const file of files) {
            await tx.run(
              `INSERT INTO commit_files (commit_id, path, additions, deletions, change_type)
               VALUES (?, ?, ?, ?, ?)`,
              [mergeCommit.lastID, file.path, file.additions, file.deletions, file.changeType],
            );
          }
          await tx.run('UPDATE branches SET head_commit_id = ? WHERE id = ?', [mergeCommit.lastID, base.id]);
          await tx.run(
            `UPDATE pull_requests
             SET status = 'Merged', merged_by_account_id = ?, merged_at = datetime('now'),
                 merge_commit_id = ?, updated_at = datetime('now')
             WHERE id = ?`,
            [req.user.id, mergeCommit.lastID, latest.id],
          );
          await tx.run(
            `INSERT INTO pr_activities (pull_request_id, actor_account_id, event_type, detail, created_at)
             VALUES (?, ?, 'merged', ?, datetime('now'))`,
            [latest.id, req.user.id, `merged commit ${mergeCommit.lastID} into ${latest.base_branch}`],
          );
        });
      } catch (error) {
        if (blocked) {
          res.status(blocked.status).json({ error: blocked.error, conditions: blocked.conditions || [] });
          return;
        }
        throw error;
      }
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/pulls/:number/reviewer-candidates',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const q = text(req.query.q).trim().toLowerCase();
      const rows = await all(
        `SELECT id, username
         FROM accounts
         WHERE id <> ?
           AND (? = '' OR lower(username) LIKE ?)
         ORDER BY username
         LIMIT 20`,
        [pr.author_account_id || 0, q, `%${q}%`],
      );
      res.json({ accounts: rows });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/reviewers',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const username = text(req.body?.username).trim();
      const account = await get('SELECT id FROM accounts WHERE username = ?', [username]);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      if (account.id === pr.author_account_id) {
        res.status(400).json({ error: 'Cannot request the author as a reviewer' });
        return;
      }
      await run(
        `INSERT OR IGNORE INTO pr_reviewers (pull_request_id, account_id, requested_by_account_id, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [pr.id, account.id, req.user.id],
      );
      const updated = await getPullRequest(repository.id, number);
      res.status(201).json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.delete(
    '/api/repository-details/:orgName/:repoName/pulls/:number/reviewers/:username',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      const role = await getEffectiveRole(req.user, repository);
      if (!(req.user.id === pr.author_account_id || canMaintain(role))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      await run(
        `DELETE FROM pr_reviewers
         WHERE pull_request_id = ?
           AND account_id = (SELECT id FROM accounts WHERE username = ?)`,
        [pr.id, text(req.params.username).trim()],
      );
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/pulls/:number/checks/:checkName',
    requireAuth,
    asyncHandler(async (req, res) => {
      const repository = await findRepository(req.params.orgName, req.params.repoName);
      const number = prNumber(req.params.number);
      const pr = repository && number ? await getPullRequest(repository.id, number) : null;
      if (!pr) {
        res.status(404).json({ error: 'Pull request not found' });
        return;
      }
      if (!(await canAdmin(req.user, repository))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const status = text(req.body?.status).trim().toLowerCase();
      if (!['pending', 'success', 'failure'].includes(status)) {
        res.status(400).json({ error: 'Check status is invalid' });
        return;
      }
      const checkName = text(req.params.checkName).trim() || 'test';
      const existing = await get(
        'SELECT id FROM pr_checks WHERE pull_request_id = ? AND name = ?',
        [pr.id, checkName],
      );
      if (existing) {
        await run(
          `UPDATE pr_checks
           SET status = ?, setter_account_id = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [status, req.user.id, existing.id],
        );
      } else {
        await run(
          `INSERT INTO pr_checks (pull_request_id, name, status, setter_account_id, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [pr.id, checkName, status, req.user.id],
        );
      }
      await recordPrActivity(pr.id, req.user.id, 'check_updated', `${checkName} check set to ${status}`);
      const updated = await getPullRequest(repository.id, number);
      res.json({ pullRequest: await prDetail(repository, updated, req.user) });
    }),
  );

  app.get(
    '/api/repository-details/:orgName/:repoName/branch-protections',
    asyncHandler(async (req, res) => {
      const access = await requireRepositoryAccess(req, res);
      if (!access) return;
      const { repository } = access;
      const rows = await all(
        `SELECT id, branch_pattern AS branchPattern, require_approval AS requireApproval,
                require_status_check AS requireStatusCheck, status_check_name AS statusCheckName
         FROM branch_protection_rules
         WHERE repository_id = ?
         ORDER BY branch_pattern`,
        [repository.id],
      );
      res.json({
        rules: rows.map((row) => ({
          ...row,
          requireApproval: Boolean(row.requireApproval),
          requireStatusCheck: Boolean(row.requireStatusCheck),
        })),
      });
    }),
  );

  app.post(
    '/api/repository-details/:orgName/:repoName/branch-protections',
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
      const branchPattern = text(req.body?.branchPattern ?? req.body?.pattern ?? req.body?.branchName).trim();
      if (!branchPattern) {
        res.status(400).json({ errors: { branchPattern: 'Branch name pattern is required' } });
        return;
      }
      const requireApproval = bool(req.body?.requireApproval ?? req.body?.require1Approval);
      const requireStatusCheck = bool(req.body?.requireStatusCheck ?? req.body?.requireStatusCheckTest);
      const statusCheckName = text(req.body?.statusCheckName).trim() || 'test';
      const existing = await get(
        'SELECT id FROM branch_protection_rules WHERE repository_id = ? AND branch_pattern = ?',
        [repository.id, branchPattern],
      );
      if (existing) {
        await run(
          `UPDATE branch_protection_rules
           SET require_approval = ?, require_status_check = ?, status_check_name = ?
           WHERE id = ?`,
          [requireApproval ? 1 : 0, requireStatusCheck ? 1 : 0, statusCheckName, existing.id],
        );
      } else {
        await run(
          `INSERT INTO branch_protection_rules
           (repository_id, branch_pattern, require_approval, require_status_check, status_check_name, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [repository.id, branchPattern, requireApproval ? 1 : 0, requireStatusCheck ? 1 : 0, statusCheckName],
        );
      }
      await recordAuditSafely(repository, req.user.id, 'Branch protection rule saved', branchPattern);
      res.status(201).json({ ok: true });
    }),
  );
}

async function canAdmin(account, repository) {
  return (await getEffectiveRole(account, repository)) === 'Admin';
}

async function recordAuditSafely(repository, actorId, action, target) {
  await run(
    `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [repository.org_id, actorId, action, target],
  );
}

module.exports = registerModule4Routes;
