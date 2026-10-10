const { hashPassword } = require('../password');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

async function ensureAccount(database, account) {
  const email = normalizeEmail(account.email);
  let row = await get(database, 'SELECT id FROM accounts WHERE username = ? OR lower(email) = ?', [
    account.username,
    email,
  ]);
  if (row) {
    return row.id;
  }

  const result = await run(
    database,
    `INSERT INTO accounts (username, email, password_hash, verified, created_at)
     VALUES (?, ?, ?, 1, datetime('now'))`,
    [account.username, email, hashPassword(account.password)],
  );
  return result.lastID;
}

async function ensureOrganization(database, organization, ownerId) {
  let row = await get(database, 'SELECT id FROM organizations WHERE name = ?', [organization.name]);
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO organizations (name, display_name, created_at)
       VALUES (?, ?, datetime('now'))`,
      [organization.name, organization.displayName],
    );
    row = { id: result.lastID };
  }

  await run(
    database,
    `INSERT OR IGNORE INTO org_members (org_id, account_id, role, created_at)
     VALUES (?, ?, 'Owner', datetime('now'))`,
    [row.id, ownerId],
  );
  return row.id;
}

async function ensureOrgMember(database, orgId, accountId, role = 'Member') {
  await run(
    database,
    `INSERT OR IGNORE INTO org_members (org_id, account_id, role, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [orgId, accountId, role],
  );
}

async function ensureRepository(database, repository, orgId) {
  let row = await get(database, 'SELECT id FROM repositories WHERE org_id = ? AND name = ?', [
    orgId,
    repository.name,
  ]);
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO repositories
       (org_id, name, description, visibility, default_branch, creator_account_id,
        source_repository_id, archived, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        orgId,
        repository.name,
        repository.description,
        repository.visibility,
        repository.defaultBranch || 'main',
        repository.creatorAccountId || null,
        repository.sourceRepositoryId || null,
        repository.archived ? 1 : 0,
      ],
    );
    row = { id: result.lastID };
  }
  return row.id;
}

async function ensureTeam(database, orgId, team, parentId = null) {
  let row = await get(database, 'SELECT id FROM teams WHERE org_id = ? AND name = ?', [
    orgId,
    team.name,
  ]);
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO teams (org_id, name, parent_team_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [orgId, team.name, parentId],
    );
    row = { id: result.lastID };
  }
  return row.id;
}

async function ensureTeamMember(database, teamId, accountId) {
  await run(
    database,
    `INSERT OR IGNORE INTO team_members (team_id, account_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [teamId, accountId],
  );
}

async function ensureGrant(database, repositoryId, { accountId = null, teamId = null, role }) {
  if (teamId) {
    const existing = await get(
      database,
      'SELECT id FROM repo_grants WHERE repository_id = ? AND team_id = ?',
      [repositoryId, teamId],
    );
    if (!existing) {
      await run(
        database,
        `INSERT INTO repo_grants (repository_id, account_id, team_id, role, created_at)
         VALUES (?, NULL, ?, ?, datetime('now'))`,
        [repositoryId, teamId, role],
      );
    }
    return;
  }

  if (accountId) {
    const existing = await get(
      database,
      'SELECT id FROM repo_grants WHERE repository_id = ? AND account_id = ?',
      [repositoryId, accountId],
    );
    if (!existing) {
      await run(
        database,
        `INSERT INTO repo_grants (repository_id, account_id, team_id, role, created_at)
         VALUES (?, ?, NULL, ?, datetime('now'))`,
        [repositoryId, accountId, role],
      );
    }
  }
}

async function ensureAuditEvent(database, orgId, actorId, action, target) {
  const existing = await get(
    database,
    'SELECT id FROM audit_events WHERE org_id = ? AND action = ? AND target = ? LIMIT 1',
    [orgId, action, target],
  );
  if (!existing) {
    await run(
      database,
      `INSERT INTO audit_events (org_id, actor_account_id, action, target, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [orgId, actorId, action, target],
    );
  }
}

async function ensurePersonalNamespace(database, accountId, username) {
  let row = await get(database, 'SELECT id FROM organizations WHERE name = ?', [username]);
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO organizations (name, display_name, owner_account_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [username, username, accountId],
    );
    row = { id: result.lastID };
  } else {
    await run(database, 'UPDATE organizations SET owner_account_id = COALESCE(owner_account_id, ?) WHERE id = ?', [
      accountId,
      row.id,
    ]);
  }
  await run(
    database,
    `INSERT OR IGNORE INTO org_members (org_id, account_id, role, created_at)
     VALUES (?, ?, 'Owner', datetime('now'))`,
    [row.id, accountId],
  );
  return row.id;
}

async function ensureBranch(database, repositoryId, name, headCommitId = null) {
  let row = await get(database, 'SELECT * FROM branches WHERE repository_id = ? AND name = ?', [
    repositoryId,
    name,
  ]);
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO branches (repository_id, name, head_commit_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [repositoryId, name, headCommitId],
    );
    row = { id: result.lastID, head_commit_id: headCommitId };
  } else if (headCommitId) {
    await run(database, 'UPDATE branches SET head_commit_id = ? WHERE id = ?', [headCommitId, row.id]);
    row.head_commit_id = headCommitId;
  }
  return row.id;
}

async function ensureRepositoryFile(database, repositoryId, branchId, filePath, content) {
  const existing = await get(
    database,
    'SELECT id FROM repository_files WHERE repository_id = ? AND branch_id = ? AND path = ?',
    [repositoryId, branchId, filePath],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO repository_files (repository_id, branch_id, path, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [repositoryId, branchId, filePath, content],
  );
  return result.lastID;
}

async function ensureCommit(database, repositoryId, branchId, commit, changedFiles = []) {
  let row = await get(
    database,
    'SELECT id FROM commits WHERE repository_id = ? AND branch_id = ? AND message = ? LIMIT 1',
    [repositoryId, branchId, commit.message],
  );
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO commits
       (repository_id, branch_id, parent_commit_id, message, author_account_id, author_name,
        additions, deletions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      [
        repositoryId,
        branchId,
        commit.parentId || null,
        commit.message,
        commit.authorId || null,
        commit.authorName,
        commit.additions || 0,
        commit.deletions || 0,
        commit.createdAt || null,
      ],
    );
    row = { id: result.lastID };
    for (const file of changedFiles) {
      await run(
        database,
        `INSERT INTO commit_files (commit_id, path, additions, deletions, change_type)
         VALUES (?, ?, ?, ?, ?)`,
        [row.id, file.path, file.additions || 0, file.deletions || 0, file.change_type || 'modified'],
      );
    }
  }
  await run(database, 'UPDATE branches SET head_commit_id = ? WHERE id = ?', [row.id, branchId]);
  return row.id;
}

async function ensureRelease(database, repositoryId, release) {
  const existing = await get(
    database,
    'SELECT id FROM releases WHERE repository_id = ? AND tag = ?',
    [repositoryId, release.tag],
  );
  if (!existing) {
    const result = await run(
      database,
      `INSERT INTO releases (repository_id, tag, title, description, branch_name, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [repositoryId, release.tag, release.title, release.description, release.branchName],
    );
    return result.lastID;
  }
  return existing.id;
}

async function ensureRepositoryLabel(database, repositoryId, label) {
  let row = await get(
    database,
    'SELECT id FROM repository_labels WHERE repository_id = ? AND name = ?',
    [repositoryId, label.name],
  );
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO repository_labels (repository_id, name, color, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [repositoryId, label.name, label.color || 'd1d5db'],
    );
    row = { id: result.lastID };
  }
  return row.id;
}

async function ensureMilestone(database, repositoryId, milestone) {
  let row = await get(
    database,
    'SELECT id FROM milestones WHERE repository_id = ? AND name = ?',
    [repositoryId, milestone.name],
  );
  if (!row) {
    const result = await run(
      database,
      `INSERT INTO milestones (repository_id, name, description, due_date, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [repositoryId, milestone.name, milestone.description || '', milestone.dueDate || null],
    );
    row = { id: result.lastID };
  }
  return row.id;
}

async function ensureIssue(database, repositoryId, issue) {
  const row = await get(database, 'SELECT id FROM issues WHERE repository_id = ? AND number = ?', [
    repositoryId,
    issue.number,
  ]);
  if (row) {
    return { id: row.id, created: false };
  }
  const result = await run(
    database,
    `INSERT INTO issues
     (repository_id, number, title, description, status, author_account_id, milestone_id,
      created_at, updated_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?)`,
    [
      repositoryId,
      issue.number,
      issue.title,
      issue.description || '',
      issue.status || 'Open',
      issue.authorAccountId || null,
      issue.milestoneId || null,
      issue.createdAt || null,
      issue.updatedAt || issue.createdAt || null,
      issue.closedAt || null,
    ],
  );
  return { id: result.lastID, created: true };
}

async function ensureIssueComment(database, issueId, comment) {
  const existing = await get(
    database,
    `SELECT id FROM issue_comments
     WHERE issue_id = ? AND author_account_id = ? AND body = ?
     LIMIT 1`,
    [issueId, comment.authorAccountId || null, comment.body],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO issue_comments (issue_id, author_account_id, body, created_at)
     VALUES (?, ?, ?, COALESCE(?, datetime('now')))`,
    [issueId, comment.authorAccountId || null, comment.body, comment.createdAt || null],
  );
  return result.lastID;
}

async function ensureIssueEvent(database, issueId, event) {
  const existing = await get(
    database,
    `SELECT id FROM issue_events
     WHERE issue_id = ? AND event_type = ? AND detail = ?
     LIMIT 1`,
    [issueId, event.eventType, event.detail || ''],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO issue_events (issue_id, actor_account_id, event_type, detail, created_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    [issueId, event.actorAccountId || null, event.eventType, event.detail || '', event.createdAt || null],
  );
  return result.lastID;
}

async function ensureIssueAssignee(database, issueId, accountId) {
  await run(
    database,
    `INSERT OR IGNORE INTO issue_assignees (issue_id, account_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [issueId, accountId],
  );
}

async function ensureIssueLabel(database, issueId, labelId) {
  await run(
    database,
    `INSERT OR IGNORE INTO issue_labels (issue_id, label_id, created_at)
     VALUES (?, ?, datetime('now'))`,
    [issueId, labelId],
  );
}

async function ensureIssueReaction(database, issueId, accountId, reaction) {
  await run(
    database,
    `INSERT OR IGNORE INTO issue_reactions (issue_id, account_id, reaction, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [issueId, accountId, reaction],
  );
}

async function ensureBranchProtection(database, repositoryId, rule) {
  const existing = await get(
    database,
    'SELECT id FROM branch_protection_rules WHERE repository_id = ? AND branch_pattern = ?',
    [repositoryId, rule.branchPattern],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO branch_protection_rules
     (repository_id, branch_pattern, require_approval, require_status_check, status_check_name, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      repositoryId,
      rule.branchPattern,
      rule.requireApproval ? 1 : 0,
      rule.requireStatusCheck ? 1 : 0,
      rule.statusCheckName || 'test',
    ],
  );
  return result.lastID;
}

async function ensurePullRequest(database, repositoryId, pr) {
  let row = await get(
    database,
    'SELECT id FROM pull_requests WHERE repository_id = ? AND number = ?',
    [repositoryId, pr.number],
  );
  if (row) {
    return { id: row.id, created: false };
  }
  const result = await run(
    database,
    `INSERT INTO pull_requests
     (repository_id, number, title, description, author_account_id, base_branch, compare_branch,
      base_commit_id, compare_commit_id, status, merge_conflict, merged_by_account_id, merged_at,
      merge_commit_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
    [
      repositoryId,
      pr.number,
      pr.title,
      pr.description || '',
      pr.authorAccountId || null,
      pr.baseBranch,
      pr.compareBranch,
      pr.baseCommitId || null,
      pr.compareCommitId || null,
      pr.status || 'Open',
      pr.mergeConflict ? 1 : 0,
      pr.mergedByAccountId || null,
      pr.mergedAt || null,
      pr.mergeCommitId || null,
      pr.createdAt || null,
      pr.updatedAt || pr.createdAt || null,
    ],
  );
  return { id: result.lastID, created: true };
}

async function ensurePrReviewer(database, pullRequestId, accountId, requestedById = null) {
  await run(
    database,
    `INSERT OR IGNORE INTO pr_reviewers
     (pull_request_id, account_id, requested_by_account_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [pullRequestId, accountId, requestedById],
  );
}

async function ensurePrReview(database, pullRequestId, review) {
  const existing = await get(
    database,
    `SELECT id FROM pr_reviews
     WHERE pull_request_id = ? AND reviewer_account_id = ? AND decision = ?
       AND COALESCE(summary, '') = ? AND COALESCE(compare_commit_id, 0) = COALESCE(?, 0)
     LIMIT 1`,
    [
      pullRequestId,
      review.reviewerAccountId,
      review.decision,
      review.summary || '',
      review.compareCommitId || null,
    ],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO pr_reviews
     (pull_request_id, reviewer_account_id, decision, summary, compare_commit_id, status, created_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
    [
      pullRequestId,
      review.reviewerAccountId,
      review.decision,
      review.summary || '',
      review.compareCommitId || null,
      review.status || 'submitted',
      review.createdAt || null,
      review.submittedAt || review.createdAt || null,
    ],
  );
  return result.lastID;
}

async function ensurePrReviewComment(database, pullRequestId, comment) {
  const existing = await get(
    database,
    `SELECT id FROM pr_review_comments
     WHERE pull_request_id = ? AND COALESCE(author_account_id, 0) = COALESCE(?, 0)
       AND body = ? AND path = ? AND line = ?
     LIMIT 1`,
    [pullRequestId, comment.authorAccountId || null, comment.body, comment.path, comment.line],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO pr_review_comments
     (pull_request_id, review_id, author_account_id, body, path, line, side, state, commit_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    [
      pullRequestId,
      comment.reviewId || null,
      comment.authorAccountId || null,
      comment.body,
      comment.path,
      comment.line || 1,
      comment.side || 'RIGHT',
      comment.state || 'published',
      comment.commitId || null,
      comment.createdAt || null,
    ],
  );
  return result.lastID;
}

async function ensurePrCheck(database, pullRequestId, check) {
  await run(
    database,
    `INSERT OR IGNORE INTO pr_checks
     (pull_request_id, name, status, setter_account_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [pullRequestId, check.name, check.status || 'pending', check.setterAccountId || null],
  );
}

async function ensurePrActivity(database, pullRequestId, activity) {
  const existing = await get(
    database,
    `SELECT id FROM pr_activities
     WHERE pull_request_id = ? AND event_type = ? AND detail = ?
     LIMIT 1`,
    [pullRequestId, activity.eventType, activity.detail || ''],
  );
  if (existing) {
    return existing.id;
  }
  const result = await run(
    database,
    `INSERT INTO pr_activities
     (pull_request_id, actor_account_id, event_type, detail, created_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    [
      pullRequestId,
      activity.actorAccountId || null,
      activity.eventType,
      activity.detail || '',
      activity.createdAt || null,
    ],
  );
  return result.lastID;
}

async function seedIssue(database, repositoryId, issue, authorAccounts) {
  const seeded = await ensureIssue(database, repositoryId, {
    ...issue,
    authorAccountId: issue.author ? authorAccounts[issue.author] : null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
  });
  const issueId = seeded.id;
  await ensureIssueEvent(database, issueId, {
    actorAccountId: issue.author ? authorAccounts[issue.author] : null,
    eventType: 'created',
    detail: issue.creationDetail || 'opened this issue',
    createdAt: issue.createdAt,
  });
  for (const comment of issue.comments || []) {
    await ensureIssueComment(database, issueId, {
      authorAccountId: authorAccounts[comment.author] || null,
      body: comment.body,
      createdAt: comment.createdAt,
    });
    await ensureIssueEvent(database, issueId, {
      actorAccountId: authorAccounts[comment.author] || null,
      eventType: 'commented',
      detail: comment.body,
      createdAt: comment.createdAt,
    });
  }
  for (const event of issue.events || []) {
    await ensureIssueEvent(database, issueId, {
      actorAccountId: event.actor ? authorAccounts[event.actor] : null,
      eventType: event.eventType,
      detail: event.detail,
      createdAt: event.createdAt,
    });
  }
  return { id: issueId, created: seeded.created };
}

async function seedRepositoryBasics(database, repositoryId, branchName, files, commit) {
  const branchId = await ensureBranch(database, repositoryId, branchName);
  for (const file of files) {
    await ensureRepositoryFile(database, repositoryId, branchId, file.path, file.content);
  }
  if (commit) {
    await ensureCommit(database, repositoryId, branchId, commit, commit.changedFiles || []);
  }
  return { branchId };
}

async function seedData(database) {
  await run(database, 'PRAGMA foreign_keys = ON;');

  const accounts = {};
  const accountSeeds = [
    ['evo-register-existing', 'evo.register.existing@evolution.test', 'Evo-Password-987!'],
    ['evo-login-case', 'evo.login.case@evolution.test', 'Evo-Password-987!'],
    ['recovery-visibility', 'recovery-visibility@example.test', 'Valid-password-123!'],
    ['recovery-invalid-code', 'recovery-invalid-code@example.test', 'Valid-password-123!'],
    ['recovery-success', 'recovery-success@example.test', 'Valid-password-123!'],
    ['alice-dev', 'alice.dev@example.test', 'Valid-password-123!'],
    ['password-change-success', 'password-change-success@example.test', 'Valid-password-123!'],
    ['password-change-invalid', 'password-change-invalid@example.test', 'Valid-password-123!'],
    ['password-change-required', 'password-change-required@example.test', 'Valid-password-123!'],
    ['evo-session-owner', 'evo.session.owner@evolution.test', 'Evo-Password-987!'],
    ['evo-session-owner-s2', 'evo.session.owner.s2@evolution.test', 'Evo-Password-987!'],
    ['evo-session-owner-s3', 'evo.session.owner.s3@evolution.test', 'Evo-Password-987!'],
    ['evo-org-owner', 'evo.org.owner@evolution.test', 'Evo-Password-987!'],
    ['org-owner', 'org-owner@example.test', 'Valid-password-123!'],
    ['team-maintainer', 'team-maintainer@example.test', 'Valid-password-123!'],
    ['bob-reviewer', 'bob-reviewer@example.test', 'Valid-password-123!'],
    ['new-member', 'new-member@example.test', 'Valid-password-123!'],
    ['existing-member', 'existing-member@example.test', 'Valid-password-123!'],
    ['org-member', 'org-member@example.test', 'Valid-password-123!'],
    ['protected-member', 'protected-member@example.test', 'Valid-password-123!'],
    ['repo-admin', 'repo-admin@example.test', 'Valid-password-123!'],
    ['evo-audit-owner', 'evo.audit.owner@evolution.test', 'Evo-Password-987!'],
    ['evo-audit-viewer', 'evo.audit.viewer@evolution.test', 'Evo-Password-987!'],
    ['repo-owner', 'repo-owner@example.test', 'Valid-password-123!'],
    ['fork-user', 'fork-user@example.test', 'Valid-password-123!'],
    ['visibility-admin', 'visibility-admin@example.test', 'Valid-password-123!'],
    ['collaborator', 'collaborator@example.test', 'Valid-password-123!'],
    ['branch-contributor', 'branch-contributor@example.test', 'Valid-password-123!'],
    ['default-branch-admin', 'default-branch-admin@example.test', 'Valid-password-123!'],
    ['default-branch-viewer', 'default-branch-viewer@example.test', 'Valid-password-123!'],
    ['file-contributor', 'file-contributor@example.test', 'Valid-password-123!'],
    ['evo-archive-admin', 'evo.archive.admin@evolution.test', 'Evo-Password-987!'],
    ['evo-archive-viewer', 'evo.archive.viewer@evolution.test', 'Evo-Password-987!'],
    ['evo-release-owner', 'evo.release.owner@evolution.test', 'Evo-Password-987!'],
    ['issue-author', 'issue-author@example.test', 'Valid-password-123!'],
    ['issue-editor', 'issue-editor@example.test', 'Valid-password-123!'],
    ['issue-commenter', 'issue-commenter@example.test', 'Valid-password-123!'],
    ['issue-viewer', 'issue-viewer@example.test', 'Valid-password-123!'],
    ['evo-reaction-author', 'evo.reaction.author@evolution.test', 'Evo-Password-987!'],
    ['evo-reaction-user', 'evo.reaction.user@evolution.test', 'Evo-Password-987!'],
    ['protection-admin', 'protection-admin@example.test', 'Valid-password-123!'],
    ['protection-viewer', 'protection-viewer@example.test', 'Valid-password-123!'],
    ['pr-contributor', 'pr-contributor@example.test', 'Valid-password-123!'],
    ['draft-author', 'draft-author@example.test', 'Valid-password-123!'],
    ['pr-reviewer', 'pr-reviewer@example.test', 'Valid-password-123!'],
    ['pr-author', 'pr-author@example.test', 'Valid-password-123!'],
    ['pr-maintainer', 'pr-maintainer@example.test', 'Valid-password-123!'],
    ['pr-viewer', 'pr-viewer@example.test', 'Valid-password-123!'],
  ];

  for (const [username, email, password] of accountSeeds) {
    accounts[username] = await ensureAccount(database, { username, email, password });
  }

  const acmeId = await ensureOrganization(
    database,
    { name: 'acme-demo', displayName: 'Acme Demo' },
    accounts['org-owner'],
  );
  await ensureOrgMember(database, acmeId, accounts['team-maintainer'], 'Owner');
  await ensureOrgMember(database, acmeId, accounts['existing-member'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['org-member'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['protected-member'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['bob-reviewer'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['issue-author'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['issue-editor'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['issue-commenter'], 'Member');
  await ensureOrgMember(database, acmeId, accounts['issue-viewer'], 'Member');

  const acmeDocsId = await ensureRepository(
    database,
    {
      name: 'acme-docs',
      description: 'Public documentation for Acme Demo',
      visibility: 'public',
    },
    acmeId,
  );
  const secretResearchId = await ensureRepository(
    database,
    {
      name: 'secret-research',
      description: 'Private research repository',
      visibility: 'private',
    },
    acmeId,
  );

  const platformTeamId = await ensureTeam(database, acmeId, { name: 'platform-team' });
  await ensureTeam(database, acmeId, { name: 'frontend-team' }, platformTeamId);
  const frontendTeamId = (await get(database, 'SELECT id FROM teams WHERE org_id = ? AND name = ?', [
    acmeId,
    'frontend-team',
  ])).id;
  await ensureTeam(database, acmeId, { name: 'frontend-child' }, frontendTeamId);
  const accessRoleTeamId = await ensureTeam(database, acmeId, { name: 'access-role-team' });

  await ensureGrant(database, acmeDocsId, { accountId: accounts['repo-admin'], role: 'Admin' });
  await ensureGrant(database, acmeDocsId, { teamId: accessRoleTeamId, role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['issue-author'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['issue-editor'], role: 'Maintain' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['issue-commenter'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['issue-viewer'], role: 'Read' });

  const evoLabId = await ensureOrganization(
    database,
    { name: 'evo-lab-02', displayName: 'Evo Lab Two' },
    accounts['evo-org-owner'],
  );
  await ensureRepository(
    database,
    { name: 'lab-notes', description: 'Notes for Evo Lab Two', visibility: 'public' },
    evoLabId,
  );

  const auditOrgId = await ensureOrganization(
    database,
    { name: 'evo-audit-org', displayName: 'Evo Audit Org' },
    accounts['evo-audit-owner'],
  );
  await ensureOrgMember(database, auditOrgId, accounts['evo-audit-viewer'], 'Member');
  const auditRepoId = await ensureRepository(
    database,
    { name: 'audit-repo', description: 'Repository used for audit events', visibility: 'public' },
    auditOrgId,
  );
  void auditRepoId;
  await ensureAuditEvent(
    database,
    auditOrgId,
    accounts['evo-audit-owner'],
    'Member added',
    'evo-audit-viewer',
  );
  await ensureAuditEvent(
    database,
    auditOrgId,
    accounts['evo-audit-owner'],
    'Repository created',
    'audit-repo',
  );

  // -------------------------------------------------------------------------
  // Module 2 seed data (idempotent)
  // -------------------------------------------------------------------------
  const personalNamespaces = {};
  for (const username of [
    'repo-owner',
    'fork-user',
    'visibility-admin',
    'branch-contributor',
    'default-branch-admin',
    'default-branch-viewer',
    'file-contributor',
    'evo-archive-admin',
    'evo-archive-viewer',
    'evo-release-owner',
  ]) {
    personalNamespaces[username] = await ensurePersonalNamespace(database, accounts[username], username);
  }

  const repoOwnerAcmeDocsId = await ensureRepository(
    database,
    {
      name: 'acme-docs',
      description: 'Personal Acme docs repository used for duplicate validation',
      visibility: 'private',
    },
    personalNamespaces['repo-owner'],
  );
  await seedRepositoryBasics(database, repoOwnerAcmeDocsId, 'main', [
    { path: 'README.md', content: 'Personal acme-docs\n' },
  ]);

  const searchLabId = await ensureOrganization(
    database,
    { name: 'evolution-search-lab', displayName: 'Evolution Search Lab' },
    accounts['alice-dev'],
  );
  const searchCatalogId = await ensureRepository(
    database,
    {
      name: 'evo-search-catalog-s1',
      description: 'Catalog repository for evolution search checks',
      visibility: 'public',
    },
    searchLabId,
  );
  const searchNotebookId = await ensureRepository(
    database,
    {
      name: 'evo-search-notebook-s2',
      description: 'A public evolution-notebook for search scenario two',
      visibility: 'public',
    },
    searchLabId,
  );
  void searchNotebookId;

  const acmeDocsFiles = [
    { path: 'src/README.md', content: 'Document search flow\n' },
    { path: 'src/search.ts', content: 'export const searchFlow = true;\n' },
  ];
  await seedRepositoryBasics(database, acmeDocsId, 'main', acmeDocsFiles, {
    message: 'Document search flow',
    authorId: accounts['alice-dev'],
    authorName: 'alice-dev',
    additions: 3,
    deletions: 1,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    changedFiles: [{ path: 'src/search.ts', additions: 3, deletions: 1, change_type: 'modified' }],
  });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['repo-admin'], role: 'Admin' });

  const module2DemoOrgId = await ensureOrganization(
    database,
    { name: 'evolution-module2-lab', displayName: 'Evolution Module 2 Lab' },
    accounts['repo-owner'],
  );

  const branchSwitchId = await ensureRepository(
    database,
    { name: 'branch-switch-demo', description: 'Branch switching demo', visibility: 'public' },
    module2DemoOrgId,
  );
  await seedRepositoryBasics(database, branchSwitchId, 'main', [
    { path: 'README.md', content: 'Main branch\n' },
  ]);
  const branchSwitchMainId = await get(database, 'SELECT id FROM branches WHERE repository_id = ? AND name = ?', [
    branchSwitchId,
    'main',
  ]);
  const branchSwitchFeatureId = await ensureBranch(database, branchSwitchId, 'feature-search', branchSwitchMainId?.head_commit_id || null);
  await ensureRepositoryFile(database, branchSwitchId, branchSwitchFeatureId, 'main-only.md', 'File only on feature-search\n');
  await ensureGrant(database, branchSwitchId, { accountId: accounts['branch-contributor'], role: 'Write' });

  const evoBranchOrgId = await ensureOrganization(
    database,
    { name: 'evo-branch-lab', displayName: 'Evolution Branch Lab' },
    accounts['alice-dev'],
  );
  const evoBranchRepos = [
    {
      name: 'evo-branch-switch-s1',
      main: 'evo-main-s1',
      feature: 'evo-feature-s1',
      targetFile: 'evo-target-s1.md',
    },
    {
      name: 'evo-branch-switch-s2',
      main: 'evo-main-s2',
      feature: 'evo-feature-s2',
      targetFile: null,
    },
    {
      name: 'evo-branch-switch-s3',
      main: 'evo-main-s3',
      feature: 'evo-feature-s3',
      targetFile: 'evo-target-s3.md',
    },
  ];
  for (const branchRepo of evoBranchRepos) {
    const repoId = await ensureRepository(
      database,
      { name: branchRepo.name, description: `${branchRepo.name} demo`, visibility: 'public', defaultBranch: branchRepo.main },
      evoBranchOrgId,
    );
    const main = await seedRepositoryBasics(database, repoId, branchRepo.main, [
      { path: 'README.md', content: `${branchRepo.main} branch\n` },
    ]);
    const featureBranchId = await ensureBranch(database, repoId, branchRepo.feature, main.headCommitId || null);
    if (branchRepo.targetFile) {
      await ensureRepositoryFile(
        database,
        repoId,
        featureBranchId,
        branchRepo.targetFile,
        `${branchRepo.targetFile} content\n`,
      );
    }
  }

  const visibilityRepoId = await ensureRepository(
    database,
    {
      name: 'visibility-demo',
      description: 'Repository used for visibility permission checks',
      visibility: 'private',
    },
    personalNamespaces['visibility-admin'],
  );
  await seedRepositoryBasics(database, visibilityRepoId, 'main', [
    { path: 'README.md', content: 'Visibility demo\n' },
  ]);
  await ensureGrant(database, visibilityRepoId, { accountId: accounts['collaborator'], role: 'Read' });

  const archiveRepos = [
    {
      name: 'evo-archive-repository-s1',
      archived: 0,
      admin: 'evo-archive-admin',
      viewer: null,
    },
    {
      name: 'evo-archive-repository-s2',
      archived: 1,
      admin: 'evo-archive-admin',
      viewer: 'evo-archive-viewer',
    },
    {
      name: 'evo-archive-repository-s3',
      archived: 1,
      admin: 'evo-archive-admin',
      viewer: null,
    },
  ];
  for (const archiveRepo of archiveRepos) {
    const repoId = await ensureRepository(
      database,
      {
        name: archiveRepo.name,
        description: 'Repository used for archive checks',
        visibility: 'public',
        archived: Boolean(archiveRepo.archived),
      },
      personalNamespaces[archiveRepo.admin],
    );
    await seedRepositoryBasics(database, repoId, 'main', [
      { path: 'README.md', content: 'Archive demo content\n' },
    ]);
    if (archiveRepo.viewer) {
      await ensureGrant(database, repoId, { accountId: accounts[archiveRepo.viewer], role: 'Read' });
    }
  }

  const fileManagementRepoId = await ensureRepository(
    database,
    {
      name: 'file-management-demo',
      description: 'Repository used for file management checks',
      visibility: 'public',
    },
    module2DemoOrgId,
  );
  await seedRepositoryBasics(database, fileManagementRepoId, 'main', [
    { path: 'README.md', content: 'File management demo\n' },
  ]);
  await ensureGrant(database, fileManagementRepoId, {
    accountId: accounts['file-contributor'],
    role: 'Write',
  });

  const releaseOrgId = await ensureOrganization(
    database,
    { name: 'evo-release-org', displayName: 'Evolution Release Org' },
    accounts['evo-release-owner'],
  );
  const releaseOneId = await ensureRepository(
    database,
    {
      name: 'evo-release-repository-s1',
      description: 'Release creation scenario one',
      visibility: 'public',
      defaultBranch: 'evo-main-s1',
    },
    releaseOrgId,
  );
  await seedRepositoryBasics(database, releaseOneId, 'evo-main-s1', [
    { path: 'README.md', content: 'Release one\n' },
  ]);
  await ensureGrant(database, releaseOneId, { accountId: accounts['evo-release-owner'], role: 'Write' });

  const releaseTwoId = await ensureRepository(
    database,
    {
      name: 'evo-release-repository-s2',
      description: 'Published release scenario two',
      visibility: 'public',
      defaultBranch: 'evo-main-s2',
    },
    releaseOrgId,
  );
  await seedRepositoryBasics(database, releaseTwoId, 'evo-main-s2', [
    { path: 'README.md', content: 'Release two\n' },
  ]);
  await ensureRelease(database, releaseTwoId, {
    tag: 'evo-v0-1-s2',
    title: 'Existing Evolution Release',
    description: 'Published release description',
    branchName: 'evo-main-s2',
  });

  const releaseThreeId = await ensureRepository(
    database,
    {
      name: 'evo-release-repository-s3',
      description: 'Release duplicate scenario three',
      visibility: 'public',
      defaultBranch: 'evo-main-s3',
    },
    releaseOrgId,
  );
  await seedRepositoryBasics(database, releaseThreeId, 'evo-main-s3', [
    { path: 'README.md', content: 'Release three\n' },
  ]);
  await ensureRelease(database, releaseThreeId, {
    tag: 'evo-v0-1-s3',
    title: 'Existing tag release',
    description: 'Existing tag description',
    branchName: 'evo-main-s3',
  });
  await ensureGrant(database, releaseThreeId, { accountId: accounts['evo-release-owner'], role: 'Write' });

  const defaultBranchRepoId = await ensureRepository(
    database,
    {
      name: 'default-branch-demo',
      description: 'Default branch settings demo',
      visibility: 'public',
    },
    module2DemoOrgId,
  );
  await seedRepositoryBasics(database, defaultBranchRepoId, 'main', [
    { path: 'README.md', content: 'Default branch main\n' },
  ]);
  const defaultMain = await get(database, 'SELECT id, head_commit_id FROM branches WHERE repository_id = ? AND name = ?', [
    defaultBranchRepoId,
    'main',
  ]);
  const releaseBranchId = await ensureBranch(database, defaultBranchRepoId, 'release', defaultMain?.head_commit_id || null);
  await ensureRepositoryFile(database, defaultBranchRepoId, releaseBranchId, 'release.txt', 'release branch\n');
  await ensureGrant(database, defaultBranchRepoId, {
    accountId: accounts['default-branch-admin'],
    role: 'Admin',
  });
  await ensureGrant(database, defaultBranchRepoId, {
    accountId: accounts['default-branch-viewer'],
    role: 'Read',
  });

  const forkRepoId = await ensureRepository(
    database,
    {
      name: 'acme-docs-fork',
      description: 'Fork of acme-docs',
      visibility: 'public',
      sourceRepositoryId: acmeDocsId,
    },
    personalNamespaces['fork-user'],
  );
  await seedRepositoryBasics(database, forkRepoId, 'main', acmeDocsFiles, {
    message: 'Document search flow',
    authorId: accounts['alice-dev'],
    authorName: 'alice-dev',
    additions: 3,
    deletions: 1,
    changedFiles: [{ path: 'src/search.ts', additions: 3, deletions: 1, change_type: 'modified' }],
  });

  // -------------------------------------------------------------------------
  // Module 3 seed data (REQ-5, idempotent; existing issue edits are preserved)
  // -------------------------------------------------------------------------
  const bugLabelId = await ensureRepositoryLabel(database, acmeDocsId, { name: 'bug', color: 'd73a4a' });
  await ensureRepositoryLabel(database, acmeDocsId, { name: 'documentation', color: '0075ca' });
  const v1MilestoneId = await ensureMilestone(database, acmeDocsId, {
    name: 'v1.0',
    description: 'First release milestone',
  });

  const acmeIssueSeeds = [
    {
      number: 1,
      title: 'Improve onboarding',
      description: 'Describe the onboarding improvement.',
      status: 'Open',
      author: 'alice-dev',
      comments: [
        {
          author: 'alice-dev',
          body: 'Onboarding should explain the first steps.',
        },
      ],
    },
    {
      number: 2,
      title: 'Legacy welcome text',
      description: 'The old welcome text is no longer accurate.',
      status: 'Closed',
      author: 'alice-dev',
      closedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    },
    {
      number: 3,
      title: 'Editable onboarding issue',
      description: 'Initial editable description.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 4,
      title: 'Original issue title',
      description: 'Description that must survive an invalid title edit.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 5,
      title: 'Commentable onboarding issue',
      description: 'Discussion target for comment creation.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 6,
      title: 'Comment validation issue',
      description: 'Discussion target for empty comment validation.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 7,
      title: 'Assignable onboarding issue',
      description: 'Discussion target for assignment metadata.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 8,
      title: 'Labelable onboarding issue',
      description: 'Discussion target for label metadata.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 9,
      title: 'Milestone onboarding issue',
      description: 'Discussion target for milestone metadata.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 10,
      title: 'Closable onboarding issue',
      description: 'Discussion target for close and reopen transitions.',
      status: 'Open',
      author: 'issue-author',
    },
    {
      number: 11,
      title: 'Protected onboarding issue',
      description: 'Read-only issue used to verify protected transitions.',
      status: 'Open',
      author: 'issue-author',
    },
  ];

  const acmeIssueIds = {};
  const acmeIssueCreated = {};
  for (const issue of acmeIssueSeeds) {
    const seeded = await seedIssue(database, acmeDocsId, issue, accounts);
    acmeIssueIds[issue.number] = seeded.id;
    acmeIssueCreated[issue.number] = seeded.created;
  }
  if (acmeIssueCreated[1]) {
    await ensureIssueAssignee(database, acmeIssueIds[1], accounts['bob-reviewer']);
    await ensureIssueLabel(database, acmeIssueIds[1], bugLabelId);
    await run(
      database,
      'UPDATE issues SET milestone_id = COALESCE(milestone_id, ?) WHERE id = ?',
      [v1MilestoneId, acmeIssueIds[1]],
    );
  }

  const reactionAuthorNamespaceId = await ensurePersonalNamespace(
    database,
    accounts['evo-reaction-author'],
    'evo-reaction-author',
  );
  const reactionUserNamespaceId = await ensurePersonalNamespace(
    database,
    accounts['evo-reaction-user'],
    'evo-reaction-user',
  );
  const reactionRepoOneId = await ensureRepository(
    database,
    {
      name: 'evo-reaction-repository-s1',
      description: 'Reaction scenario one repository',
      visibility: 'public',
    },
    reactionAuthorNamespaceId,
  );
  await seedRepositoryBasics(database, reactionRepoOneId, 'main', [
    { path: 'README.md', content: 'Reaction scenario one\n' },
  ]);
  await ensureGrant(database, reactionRepoOneId, {
    accountId: accounts['evo-reaction-author'],
    role: 'Admin',
  });
  await seedIssue(database, reactionRepoOneId, {
    number: 1,
    title: 'Evo reaction issue s1',
    description: 'Reaction scenario one issue.',
    status: 'Open',
    author: 'evo-reaction-author',
  }, accounts);

  const reactionRepoTwoId = await ensureRepository(
    database,
    {
      name: 'evo-reaction-repository-s2',
      description: 'Reaction scenario two repository',
      visibility: 'public',
    },
    reactionUserNamespaceId,
  );
  await seedRepositoryBasics(database, reactionRepoTwoId, 'main', [
    { path: 'README.md', content: 'Reaction scenario two\n' },
  ]);
  await ensureGrant(database, reactionRepoTwoId, {
    accountId: accounts['evo-reaction-user'],
    role: 'Admin',
  });
  await seedIssue(database, reactionRepoTwoId, {
    number: 1,
    title: 'Evo reaction issue s2',
    description: 'Reaction scenario two issue.',
    status: 'Open',
    author: 'evo-reaction-user',
  }, accounts);

  const reactionRepoThreeId = await ensureRepository(
    database,
    {
      name: 'evo-reaction-repository-s3',
      description: 'Reaction scenario three repository',
      visibility: 'public',
    },
    reactionAuthorNamespaceId,
  );
  await seedRepositoryBasics(database, reactionRepoThreeId, 'main', [
    { path: 'README.md', content: 'Reaction scenario three\n' },
  ]);
  const reactionIssueThree = await seedIssue(database, reactionRepoThreeId, {
    number: 1,
    title: 'Evo reaction issue s3',
    description: 'Reaction scenario three issue with an existing reaction.',
    status: 'Open',
    author: 'evo-reaction-author',
  }, accounts);
  if (reactionIssueThree.created) {
    await ensureIssueReaction(database, reactionIssueThree.id, accounts['alice-dev'], '+1');
  }

  // -------------------------------------------------------------------------
  // Module 4 seed data (REQ-6, idempotent; existing PR/review edits preserved)
  // -------------------------------------------------------------------------
  const protectionNamespaceId = await ensurePersonalNamespace(
    database,
    accounts['protection-admin'],
    'protection-admin',
  );
  const protectionRepoId = await ensureRepository(
    database,
    {
      name: 'branch-protection-demo',
      description: 'Branch protection and PR check demo',
      visibility: 'public',
      defaultBranch: 'main',
    },
    protectionNamespaceId,
  );
  const protectionMain = await seedRepositoryBasics(database, protectionRepoId, 'main', [
    { path: 'README.md', content: 'Branch protection demo\n' },
  ], {
    message: 'Initial branch protection demo',
    authorId: accounts['protection-admin'],
    authorName: 'protection-admin',
    additions: 1,
    deletions: 0,
    changedFiles: [{ path: 'README.md', additions: 1, deletions: 0, change_type: 'added' }],
  });
  const protectionFeatureId = await ensureBranch(
    database,
    protectionRepoId,
    'feature-search',
    protectionMain.headCommitId || null,
  );
  await ensureRepositoryFile(database, protectionRepoId, protectionFeatureId, 'src/search.ts', 'export const protectedSearch = true;\n');
  await ensureGrant(database, protectionRepoId, { accountId: accounts['protection-admin'], role: 'Admin' });
  await ensureGrant(database, protectionRepoId, { accountId: accounts['protection-viewer'], role: 'Read' });
  await ensureBranchProtection(database, protectionRepoId, {
    branchPattern: 'main',
    requireApproval: true,
    requireStatusCheck: true,
    statusCheckName: 'test',
  });
  const protectionFeatureRow = await get(
    database,
    'SELECT id, head_commit_id FROM branches WHERE repository_id = ? AND name = ?',
    [protectionRepoId, 'feature-search'],
  );
  const protectionPr = await ensurePullRequest(database, protectionRepoId, {
    number: 1,
    title: 'Protection status onboarding PR',
    description: 'PR used to exercise branch-protection check status.',
    authorAccountId: accounts['protection-admin'],
    baseBranch: 'main',
    compareBranch: 'feature-search',
    baseCommitId: protectionMain.headCommitId || null,
    compareCommitId: protectionFeatureRow?.head_commit_id || null,
    status: 'Open',
  });
  await ensurePrCheck(database, protectionPr.id, {
    name: 'test',
    status: 'pending',
  });

  // Advertised branches and grants for acme-docs PR scenarios.
  const acmeMainBranch = await get(
    database,
    'SELECT id, head_commit_id FROM branches WHERE repository_id = ? AND name = ?',
    [acmeDocsId, 'main'],
  );
  const acmeFeatureBranchId = await ensureBranch(
    database,
    acmeDocsId,
    'feature-search',
    acmeMainBranch?.head_commit_id || null,
  );
  await ensureRepositoryFile(
    database,
    acmeDocsId,
    acmeFeatureBranchId,
    'src/search.ts',
    'export const searchFlow = true;\nexport const improvedSearch = true;\n',
  );
  await ensureRepositoryFile(
    database,
    acmeDocsId,
    acmeFeatureBranchId,
    'src/feature-search.ts',
    'export const featureSearch = true;\n',
  );
  const featureCommitId = await ensureCommit(database, acmeDocsId, acmeFeatureBranchId, {
    message: 'Improve search flow',
    parentId: acmeMainBranch?.head_commit_id || null,
    authorId: accounts['pr-contributor'],
    authorName: 'pr-contributor',
    additions: 2,
    deletions: 1,
    changedFiles: [
      { path: 'src/search.ts', additions: 2, deletions: 1, change_type: 'modified' },
      { path: 'src/feature-search.ts', additions: 1, deletions: 0, change_type: 'added' },
    ],
  });
  const acmeDraftBranchId = await ensureBranch(
    database,
    acmeDocsId,
    'draft-feature',
    acmeMainBranch?.head_commit_id || null,
  );
  await ensureRepositoryFile(
    database,
    acmeDocsId,
    acmeDraftBranchId,
    'src/search.ts',
    'export const searchFlow = true;\nexport const draftSearch = true;\n',
  );
  const draftCommitId = await ensureCommit(database, acmeDocsId, acmeDraftBranchId, {
    message: 'Draft search update',
    parentId: acmeMainBranch?.head_commit_id || null,
    authorId: accounts['draft-author'],
    authorName: 'draft-author',
    additions: 2,
    deletions: 1,
    changedFiles: [{ path: 'src/search.ts', additions: 2, deletions: 1, change_type: 'modified' }],
  });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['pr-contributor'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['pr-reviewer'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['pr-author'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['pr-maintainer'], role: 'Maintain' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['draft-author'], role: 'Write' });
  await ensureGrant(database, acmeDocsId, { accountId: accounts['bob-reviewer'], role: 'Write' });
  await ensureBranchProtection(database, acmeDocsId, {
    branchPattern: 'main',
    requireApproval: true,
    requireStatusCheck: true,
    statusCheckName: 'test',
  });

  const acmePrSeeds = [
    {
      number: 1,
      title: 'Improve onboarding',
      description: 'Public PR used for list filtering.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
    {
      number: 2,
      title: 'Overview onboarding PR',
      description: 'PR overview and commit browsing scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
    {
      number: 3,
      title: 'Public onboarding PR',
      description: 'Public aggregate diff scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
    {
      number: 4,
      title: 'Reviewable onboarding PR',
      description: 'Review comment and approval scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
      reviewer: 'pr-reviewer',
    },
    {
      number: 5,
      title: 'Pending review onboarding PR',
      description: 'Pending review comment scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
      reviewer: 'pr-reviewer',
    },
    {
      number: 6,
      title: 'Change request onboarding PR',
      description: 'Request changes review scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
      reviewer: 'pr-reviewer',
    },
    {
      number: 7,
      title: 'Reviewer request onboarding PR',
      description: 'Reviewer request management scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
    {
      number: 8,
      title: 'Draft onboarding update',
      description: 'Draft ready-for-review scenario.',
      author: 'draft-author',
      baseBranch: 'main',
      compareBranch: 'draft-feature',
      status: 'Draft',
    },
    {
      number: 9,
      title: 'Mergeable onboarding PR',
      description: 'Eligible merge scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
      approvalBy: 'bob-reviewer',
      checkStatus: 'success',
    },
    {
      number: 10,
      title: 'Blocked onboarding PR',
      description: 'Blocked merge scenario without valid approval.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
      checkStatus: 'success',
    },
    {
      number: 11,
      title: 'Closable onboarding PR',
      description: 'Close and reopen scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
    {
      number: 12,
      title: 'Protected onboarding PR',
      description: 'Read viewer permission scenario.',
      author: 'pr-author',
      baseBranch: 'main',
      compareBranch: 'feature-search',
      status: 'Open',
    },
  ];

  for (const seed of acmePrSeeds) {
    const existing = await get(
      database,
      'SELECT id FROM pull_requests WHERE repository_id = ? AND number = ?',
      [acmeDocsId, seed.number],
    );
    const pr = await ensurePullRequest(database, acmeDocsId, {
      number: seed.number,
      title: seed.title,
      description: seed.description,
      authorAccountId: accounts[seed.author],
      baseBranch: seed.baseBranch,
      compareBranch: seed.compareBranch,
      baseCommitId: acmeMainBranch?.head_commit_id || null,
      compareCommitId: seed.compareBranch === 'draft-feature' ? draftCommitId : featureCommitId,
      status: seed.status,
    });
    if (pr.created) {
      await ensurePrActivity(database, pr.id, {
        actorAccountId: accounts[seed.author],
        eventType: 'created',
        detail: 'opened this pull request',
      });
    }
    if (seed.reviewer) {
      await ensurePrReviewer(database, pr.id, accounts[seed.reviewer], accounts[seed.author]);
    }
    if (seed.approvalBy) {
      await ensurePrReview(database, pr.id, {
        reviewerAccountId: accounts[seed.approvalBy],
        decision: 'Approve',
        summary: 'Looks good to merge.',
        compareCommitId: featureCommitId,
        status: 'submitted',
      });
    }
    if (seed.checkStatus) {
      await ensurePrCheck(database, pr.id, {
        name: 'test',
        status: seed.checkStatus,
        setterAccountId: accounts['protection-admin'],
      });
    }
    void existing;
  }

  void platformTeamId;
  void secretResearchId;
  void searchCatalogId;
}

module.exports = {
  seedData,
};
