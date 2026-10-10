const request = require('supertest');
const { createTestDatabaseHarness } = require('../src/database/test_harness');
const seedDatabase = require('../src/database/seed_db');

let app;
let api;
let harness;

async function agentFor(identifier, password = 'Valid-password-123!') {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/signin').send({ identifier, password });
  expect(response.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  harness = createTestDatabaseHarness({ label: 'req5-api', seedDefault: true });
  await harness.setup();
  app = require('../src/app');
  api = request(app);
});

afterAll(async () => {
  await harness.cleanup();
});

describe('REQ-5 issue discovery and details', () => {
  it('lists/filters seeded public issues for an anonymous visitor and serves stable detail reads', async () => {
    let response = await api.get('/api/repository-details/acme-demo/acme-docs/issues');
    expect(response.status).toBe(200);
    expect(response.body.issues.map((issue) => issue.title)).toEqual(
      expect.arrayContaining(['Improve onboarding', 'Legacy welcome text']),
    );

    response = await api
      .get('/api/repository-details/acme-demo/acme-docs/issues')
      .query({ status: 'open', q: 'Improve onboarding' });
    expect(response.body.issues.map((issue) => issue.title)).toEqual(['Improve onboarding']);

    response = await api
      .get('/api/repository-details/acme-demo/acme-docs/issues')
      .query({ status: 'closed', q: 'Legacy welcome text' });
    expect(response.body.issues.map((issue) => issue.title)).toEqual(['Legacy welcome text']);

    response = await api.get('/api/repository-details/acme-demo/acme-docs/issues/1');
    expect(response.status).toBe(200);
    expect(response.body.issue).toMatchObject({
      number: 1,
      title: 'Improve onboarding',
      description: 'Describe the onboarding improvement.',
      status: 'Open',
      author: 'alice-dev',
    });
    expect(response.body.issue.comments.length).toBeGreaterThan(0);
    expect(response.body.issue.activity.length).toBeGreaterThan(0);
    expect(response.body.issue.permissions.canReact).toBe(false);
  });
});

describe('REQ-5-2 issue creation, editing and discussion', () => {
  it('creates issues with unique numbers, validates boundaries, and enforces create permission', async () => {
    const author = await agentFor('issue-author');
    const title = `Created issue ${Date.now()}`;
    let response = await author.post('/api/repository-details/acme-demo/acme-docs/issues').send({
      title,
      description: 'Created description',
    });
    expect(response.status).toBe(201);
    const created = response.body.issue;
    expect(created.title).toBe(title);
    expect(created.description).toBe('Created description');
    expect(created.status).toBe('Open');
    expect(created.number).toBeGreaterThan(11);

    const detail = await api.get(
      `/api/repository-details/acme-demo/acme-docs/issues/${created.number}`,
    );
    expect(detail.body.issue.title).toBe(title);

    response = await author
      .post('/api/repository-details/acme-demo/acme-docs/issues')
      .send({ title: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.errors.title).toMatch(/required/i);

    response = await author
      .post('/api/repository-details/acme-demo/acme-docs/issues')
      .send({ title: 'x'.repeat(257) });
    expect(response.status).toBe(400);
    expect(response.body.errors.title).toMatch(/256/);

    response = await author
      .post('/api/repository-details/acme-demo/acme-docs/issues')
      .send({ title: 'y'.repeat(256), description: 'd'.repeat(65536) });
    expect(response.status).toBe(201);
    expect(response.body.issue.title).toBe('y'.repeat(256));
    expect(response.body.issue.description).toBe('d'.repeat(65536));

    response = await author
      .post('/api/repository-details/acme-demo/acme-docs/issues')
      .send({ title: 'too long description', description: 'd'.repeat(65537) });
    expect(response.status).toBe(400);
    expect(response.body.errors.description).toMatch(/65536/);

    const viewer = await agentFor('issue-viewer');
    response = await viewer
      .post('/api/repository-details/acme-demo/acme-docs/issues')
      .send({ title: 'viewer issue' });
    expect(response.status).toBe(403);
  });

  it('edits only the selected issue field and retains the original on invalid title', async () => {
    const editor = await agentFor('issue-editor');
    const before = await api.get('/api/repository-details/acme-demo/acme-docs/issues/3');
    expect(before.status).toBe(200);

    const newTitle = `Edited title ${Date.now()}`;
    let response = await editor.patch('/api/repository-details/acme-demo/acme-docs/issues/3').send({
      title: newTitle,
    });
    expect(response.status).toBe(200);
    expect(response.body.issue.title).toBe(newTitle);
    expect(response.body.issue.description).toBe(before.body.issue.description);

    response = await editor.patch('/api/repository-details/acme-demo/acme-docs/issues/3').send({
      description: 'Edited description',
    });
    expect(response.status).toBe(200);
    expect(response.body.issue.title).toBe(newTitle);
    expect(response.body.issue.description).toBe('Edited description');

    response = await editor.patch('/api/repository-details/acme-demo/acme-docs/issues/4').send({
      title: '   ',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.title).toMatch(/required/i);
    const after = await api.get('/api/repository-details/acme-demo/acme-docs/issues/4');
    expect(after.body.issue.title).toBe('Original issue title');

    const viewer = await agentFor('issue-viewer');
    response = await viewer.patch('/api/repository-details/acme-demo/acme-docs/issues/4').send({
      title: 'viewer edit',
    });
    expect(response.status).toBe(403);
  });

  it('appends comments, preserves them, and rejects whitespace-only comments', async () => {
    const commenter = await agentFor('issue-commenter');
    const body = `A useful comment ${Date.now()}`;
    let response = await commenter
      .post('/api/repository-details/acme-demo/acme-docs/issues/5/comments')
      .send({ body });
    expect(response.status).toBe(201);
    expect(response.body.comment).toMatchObject({ body, author: 'issue-commenter' });

    response = await api.get('/api/repository-details/acme-demo/acme-docs/issues/5');
    const matching = response.body.issue.comments.filter((comment) => comment.body === body);
    expect(matching).toHaveLength(1);
    expect(response.body.issue.activity.some((event) => event.detail === body)).toBe(true);

    const before = await api.get('/api/repository-details/acme-demo/acme-docs/issues/6');
    const beforeCount = before.body.issue.comments.length;
    response = await commenter
      .post('/api/repository-details/acme-demo/acme-docs/issues/6/comments')
      .send({ body: '   \n ' });
    expect(response.status).toBe(400);
    expect(response.body.errors.body).toMatch(/required/i);
    const after = await api.get('/api/repository-details/acme-demo/acme-docs/issues/6');
    expect(after.body.issue.comments).toHaveLength(beforeCount);

    response = await commenter
      .post('/api/repository-details/acme-demo/acme-docs/issues/6/comments')
      .send({ body: 'c'.repeat(65537) });
    expect(response.status).toBe(400);
    expect(response.body.errors.body).toMatch(/65536/);
  });
});

describe('REQ-5-3 issue metadata', () => {
  it('assigns and unassigns a participant through the server while preserving member data', async () => {
    const editor = await agentFor('issue-editor');
    let response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/7/assignees')
      .send({ username: 'bob-reviewer' });
    expect(response.status).toBe(200);
    expect(response.body.issue.assignees.map((assignee) => assignee.username)).toContain('bob-reviewer');

    response = await api.get('/api/repository-details/acme-demo/acme-docs/issues/7');
    expect(response.body.issue.assignees.map((assignee) => assignee.username)).toContain('bob-reviewer');

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/7/assignees')
      .send({ username: 'bob-reviewer' });
    expect(response.status).toBe(200);
    expect(response.body.issue.assignees.map((assignee) => assignee.username)).not.toContain('bob-reviewer');

    const candidate = await api
      .get('/api/repository-details/acme-demo/acme-docs/issues/7/assignees')
      .query({ q: 'bob' });
    expect(candidate.body.assignees.map((entry) => entry.username)).toContain('bob-reviewer');
  });

  it('applies existing repository labels and milestones and rejects invalid/cross-repository choices', async () => {
    const editor = await agentFor('issue-editor');
    let response = await editor
      .get('/api/repository-details/acme-demo/acme-docs/labels');
    expect(response.body.labels.map((label) => label.name)).toContain('bug');

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/8/labels')
      .send({ name: 'bug' });
    expect(response.status).toBe(200);
    expect(response.body.issue.labels.map((label) => label.name)).toContain('bug');

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/8/labels')
      .send({ name: 'not-a-label' });
    expect(response.status).toBe(400);

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/9/milestone')
      .send({ name: 'v1.0' });
    expect(response.status).toBe(200);
    expect(response.body.issue.milestone.name).toBe('v1.0');

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/9/milestone')
      .send({ name: 'missing-milestone' });
    expect(response.status).toBe(400);

    const viewer = await agentFor('issue-viewer');
    response = await viewer
      .post('/api/repository-details/acme-demo/acme-docs/issues/8/labels')
      .send({ name: 'bug' });
    expect(response.status).toBe(403);
  });
});

describe('REQ-5-4 issue close/reopen and REQ-5-5 reactions', () => {
  it('closes and reopens an issue while preserving content and hiding controls from Read users', async () => {
    const editor = await agentFor('issue-editor');
    const before = await api.get('/api/repository-details/acme-demo/acme-docs/issues/10');
    let response = await editor.post('/api/repository-details/acme-demo/acme-docs/issues/10/close');
    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe('Closed');
    expect(response.body.issue.activity.some((event) => /closed this issue/i.test(event.detail))).toBe(true);
    expect(response.body.issue.title).toBe(before.body.issue.title);
    expect(response.body.issue.description).toBe(before.body.issue.description);

    response = await editor.post('/api/repository-details/acme-demo/acme-docs/issues/10/reopen');
    expect(response.status).toBe(200);
    expect(response.body.issue.status).toBe('Open');
    expect(response.body.issue.activity.some((event) => /reopened this issue/i.test(event.detail))).toBe(true);

    const viewer = await agentFor('issue-viewer');
    response = await viewer.post('/api/repository-details/acme-demo/acme-docs/issues/10/close');
    expect(response.status).toBe(403);
  });

  it('adds, persists, removes a +1 reaction and exposes read-only counts to visitors', async () => {
    const user = await agentFor('evo-reaction-user', 'Evo-Password-987!');
    let response = await user.post(
      '/api/repository-details/evo-reaction-user/evo-reaction-repository-s2/issues/1/reactions',
    ).send({ type: '+1' });
    expect(response.status).toBe(200);
    const mine = response.body.issue.reactions.find((reaction) => reaction.type === '+1');
    expect(mine).toMatchObject({ count: 1, reacted: true });

    response = await api.get('/api/repository-details/evo-reaction-user/evo-reaction-repository-s2/issues/1');
    expect(response.body.issue.reactions.find((reaction) => reaction.type === '+1')).toMatchObject({
      count: 1,
      reacted: false,
    });

    response = await user.post(
      '/api/repository-details/evo-reaction-user/evo-reaction-repository-s2/issues/1/reactions',
    ).send({ type: '+1' });
    expect(response.status).toBe(200);
    const afterRemove = response.body.issue.reactions.find((reaction) => reaction.type === '+1');
    expect(afterRemove ? afterRemove.count : 0).toBe(0);

    response = await api.get('/api/repository-details/evo-reaction-author/evo-reaction-repository-s3/issues/1');
    expect(response.status).toBe(200);
    expect(response.body.issue.reactions.find((reaction) => reaction.type === '+1')).toMatchObject({
      count: 1,
      reacted: false,
    });
    expect(response.body.issue.permissions.canReact).toBe(false);
  });
});

describe('REQ-5 seed initialization', () => {
  it('is idempotent and preserves user edits and removed seed relationships', async () => {
    const editor = await agentFor('issue-editor');
    const newTitle = `Preserved title ${Date.now()}`;
    let response = await editor.patch('/api/repository-details/acme-demo/acme-docs/issues/4').send({
      title: newTitle,
    });
    expect(response.status).toBe(200);

    response = await editor
      .post('/api/repository-details/acme-demo/acme-docs/issues/1/assignees')
      .send({ username: 'bob-reviewer', assigned: false });
    expect(response.status).toBe(200);
    expect(response.body.issue.assignees.map((assignee) => assignee.username)).not.toContain('bob-reviewer');

    await seedDatabase();

    response = await api.get('/api/repository-details/acme-demo/acme-docs/issues/4');
    expect(response.body.issue.title).toBe(newTitle);

    response = await api.get('/api/repository-details/acme-demo/acme-docs/issues/1');
    expect(response.body.issue.assignees.map((assignee) => assignee.username)).not.toContain('bob-reviewer');
  });
});
