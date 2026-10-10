const request = require('supertest');
const { createTestDatabaseHarness } = require('../src/database/test_harness');

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
  harness = createTestDatabaseHarness({ label: 'req6-api', seedDefault: true });
  await harness.setup();
  app = require('../src/app');
  api = request(app);
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
});

describe('REQ-6 pull requests, reviews, protection and merge', () => {
  it('lists public pull requests, compares branches, and creates an Open PR that survives reload', async () => {
    let response = await api.get('/api/repository-details/acme-demo/acme-docs/pulls');
    expect(response.status).toBe(200);
    expect(response.body.pulls.map((pr) => pr.title)).toEqual(
      expect.arrayContaining(['Improve onboarding', 'Mergeable onboarding PR', 'Blocked onboarding PR']),
    );

    response = await api
      .get('/api/repository-details/acme-demo/acme-docs/pulls/compare')
      .query({ base: 'main', compare: 'feature-search' });
    expect(response.status).toBe(200);
    expect(response.body.identical).toBe(false);
    expect(response.body.changedFiles.some((file) => file.path === 'src/search.ts')).toBe(true);
    expect(response.body.commits.length).toBeGreaterThan(0);

    response = await api
      .get('/api/repository-details/acme-demo/acme-docs/pulls/compare')
      .query({ base: 'main', compare: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.identical).toBe(true);

    const contributor = await agentFor('pr-contributor');
    const title = `API pull request ${Date.now()}`;
    response = await contributor.post('/api/repository-details/acme-demo/acme-docs/pulls').send({
      base: 'main',
      compare: 'feature-search',
      title,
      description: 'Created by requirement test',
    });
    expect(response.status).toBe(201);
    expect(response.body.pullRequest).toMatchObject({ title, status: 'Open', baseBranch: 'main', compareBranch: 'feature-search' });

    response = await api.get(`/api/repository-details/acme-demo/acme-docs/pulls/${response.body.pullRequest.number}`);
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.title).toBe(title);
    expect(response.body.pullRequest.files.some((file) => file.path === 'src/search.ts')).toBe(true);
  });

  it('rejects blank PR titles, manages draft readiness, and scopes close/reopen permissions', async () => {
    const contributor = await agentFor('pr-contributor');
    let response = await contributor.post('/api/repository-details/acme-demo/acme-docs/pulls').send({
      base: 'main',
      compare: 'feature-search',
      title: '   ',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.title).toBeTruthy();

    const draftAuthor = await agentFor('draft-author');
    response = await draftAuthor.post('/api/repository-details/acme-demo/acme-docs/pulls/8/ready').send({});
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.status).toBe('Open');

    const author = await agentFor('pr-author');
    response = await author.post('/api/repository-details/acme-demo/acme-docs/pulls/11/close').send({});
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.status).toBe('Closed');
    response = await author.post('/api/repository-details/acme-demo/acme-docs/pulls/11/reopen').send({});
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.status).toBe('Open');

    const viewer = await agentFor('pr-viewer');
    response = await viewer.post('/api/repository-details/acme-demo/acme-docs/pulls/12/close').send({});
    expect(response.status).toBe(403);
  });

  it('publishes and starts review comments and stores approve/request-changes decisions', async () => {
    const reviewer = await agentFor('pr-reviewer');
    let response = await reviewer.post('/api/repository-details/acme-demo/acme-docs/pulls/4/review-comments').send({
      body: 'Please add a test.',
      path: 'src/search.ts',
      line: 1,
      pending: false,
    });
    expect(response.status).toBe(201);
    expect(response.body.comment.state).toBe('published');

    response = await reviewer.post('/api/repository-details/acme-demo/acme-docs/pulls/4/reviews').send({
      decision: 'approve',
      summary: 'Looks good',
    });
    expect(response.status).toBe(201);
    expect(response.body.pullRequest.reviews.some((review) => review.decision === 'Approve' && review.reviewer === 'pr-reviewer')).toBe(true);

    response = await reviewer.post('/api/repository-details/acme-demo/acme-docs/pulls/5/review-comments').send({
      body: 'Pending note',
      path: 'src/search.ts',
      line: 1,
      pending: true,
    });
    expect(response.status).toBe(201);
    expect(response.body.comment.state).toBe('pending');

    response = await reviewer.post('/api/repository-details/acme-demo/acme-docs/pulls/6/reviews').send({
      decision: 'request_changes',
      summary: 'Please fix this.',
    });
    expect(response.status).toBe(201);
    expect(response.body.pullRequest.reviews.some((review) => review.decision === 'Request changes' && review.summary === 'Please fix this.')).toBe(true);
  });

  it('requests and removes reviewers without affecting submitted reviews', async () => {
    const author = await agentFor('pr-author');
    let response = await author
      .get('/api/repository-details/acme-demo/acme-docs/pulls/7/reviewer-candidates')
      .query({ q: 'bob-reviewer' });
    expect(response.status).toBe(200);
    expect(response.body.accounts.some((account) => account.username === 'bob-reviewer')).toBe(true);

    response = await author.post('/api/repository-details/acme-demo/acme-docs/pulls/7/reviewers').send({
      username: 'bob-reviewer',
    });
    expect(response.status).toBe(201);
    expect(response.body.pullRequest.reviewers.some((reviewer) => reviewer.username === 'bob-reviewer')).toBe(true);

    response = await author.delete('/api/repository-details/acme-demo/acme-docs/pulls/7/reviewers/bob-reviewer');
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.reviewers.some((reviewer) => reviewer.username === 'bob-reviewer')).toBe(false);
  });

  it('updates branch protection checks and merges only the eligible PR with correct permissions', async () => {
    const admin = await agentFor('protection-admin');
    let response = await admin.post('/api/repository-details/protection-admin/branch-protection-demo/pulls/1/checks/test').send({
      status: 'success',
    });
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.checks.find((check) => check.name === 'test')).toMatchObject({
      status: 'success',
      setter: 'protection-admin',
    });

    response = await admin.get('/api/repository-details/protection-admin/branch-protection-demo/branch-protections');
    expect(response.status).toBe(200);
    expect(response.body.rules.some((rule) => rule.branchPattern === 'main' && rule.requireApproval && rule.requireStatusCheck)).toBe(true);

    const viewer = await agentFor('protection-viewer');
    response = await viewer.post('/api/repository-details/protection-admin/branch-protection-demo/branch-protections').send({
      branchPattern: 'main',
      requireApproval: false,
      requireStatusCheck: false,
    });
    expect(response.status).toBe(403);

    const maintainer = await agentFor('pr-maintainer');
    response = await maintainer.post('/api/repository-details/acme-demo/acme-docs/pulls/9/merge').send({});
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.status).toBe('Merged');
    expect(response.body.pullRequest.mergeCommitId).toBeTruthy();
    const mainHistory = await api.get('/api/repository-details/acme-demo/acme-docs/commits').query({ branch: 'main' });
    expect(mainHistory.body.commits.some((commit) => commit.message.includes('Merge pull request #9'))).toBe(true);

    response = await maintainer.post('/api/repository-details/acme-demo/acme-docs/pulls/9/close').send({});
    expect(response.status).toBe(400);
    response = await maintainer.post('/api/repository-details/acme-demo/acme-docs/pulls/10/merge').send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/Review required by branch protection/i);

    const contributor = await agentFor('pr-contributor');
    response = await contributor.post('/api/repository-details/acme-demo/acme-docs/pulls/10/merge').send({});
    expect(response.status).toBe(403);
  });

  it('hides merge/close operations from unauthorized viewers and opens public PR detail', async () => {
    let response = await api.get('/api/repository-details/acme-demo/acme-docs/pulls/12');
    expect(response.status).toBe(200);
    expect(response.body.pullRequest.title).toBe('Protected onboarding PR');
    expect(response.body.pullRequest.permissions.canClose).toBe(false);
    expect(response.body.pullRequest.permissions.canMerge).toBe(false);

    response = await api.get('/api/repository-details/acme-demo/acme-docs/pulls/12/commits');
    expect(response.status).toBe(200);
    expect(response.body.commits.length).toBeGreaterThan(0);

    response = await api.get('/api/repository-details/acme-demo/acme-docs/pulls/12/files');
    expect(response.status).toBe(200);
    expect(response.body.files.some((file) => file.path === 'src/search.ts')).toBe(true);
    expect(response.body.additions).toBeGreaterThanOrEqual(0);
    expect(response.body.deletions).toBeGreaterThanOrEqual(0);
  });
});
