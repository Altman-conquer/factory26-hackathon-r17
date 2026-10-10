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
  harness = createTestDatabaseHarness({ label: 'req34-api', seedDefault: true });
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

describe('REQ-3 repository asset management', () => {
  it('search is case-insensitive across name and description and hides private repositories from visitors', async () => {
    let response = await api.get('/api/search').query({ q: 'EVO-SEARCH-CATALOG-S1' });
    expect(response.status).toBe(200);
    expect(response.body.repositories.map((repo) => repo.name)).toContain('evo-search-catalog-s1');

    response = await api.get('/api/search').query({ q: 'evolution-notebook' });
    expect(response.status).toBe(200);
    expect(response.body.repositories.map((repo) => repo.name)).toContain('evo-search-notebook-s2');

    response = await api.get('/api/search').query({ q: 'secret-research' });
    expect(response.status).toBe(200);
    expect(response.body.repositories.map((repo) => repo.name)).not.toContain('secret-research');
  });

  it('creates an initialized private repository, enforces duplicate/empty names, and persists README/history', async () => {
    const owner = await agentFor('repo-owner');
    const name = `pw-repo-${Date.now()}`;
    let response = await owner.post('/api/repositories').send({
      owner: 'repo-owner',
      name,
      description: 'Repository created by Playwright',
      visibility: 'private',
      addReadme: true,
    });
    expect(response.status).toBe(201);
    expect(response.body.repository).toMatchObject({ name, visibility: 'private', defaultBranch: 'main' });

    response = await owner.get(`/api/repository-details/repo-owner/${name}/tree`).query({ branch: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.entries.some((entry) => entry.name === 'README.md' && entry.type === 'file')).toBe(true);

    response = await owner.get(`/api/repository-details/repo-owner/${name}/commits`).query({ branch: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.commits.some((commit) => commit.message === 'Initial commit')).toBe(true);

    response = await owner.post('/api/repositories').send({ owner: 'repo-owner', name, visibility: 'public' });
    expect(response.status).toBe(400);
    expect(response.body.errors.name).toMatch(/already exists/i);

    response = await owner.post('/api/repositories').send({ owner: 'repo-owner', name: '' });
    expect(response.status).toBe(400);
    expect(response.body.errors.name).toMatch(/required/i);
  });

  it('browses acme-docs directories, files, history, diff, and code search as a visitor', async () => {
    let response = await api.get('/api/repository-details/acme-demo/acme-docs/tree').query({ branch: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'src', type: 'directory' })]));

    response = await api.get('/api/repository-details/acme-demo/acme-docs/tree').query({ branch: 'main', path: 'src' });
    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'README.md', type: 'file' })]));

    response = await api.get('/api/repository-details/acme-demo/acme-docs/file').query({ branch: 'main', path: 'src/README.md' });
    expect(response.status).toBe(200);
    expect(response.body.file.content).toContain('Document search flow');

    response = await api.get('/api/repository-details/acme-demo/acme-docs/commits').query({ branch: 'main' });
    expect(response.status).toBe(200);
    const commit = response.body.commits.find((entry) => entry.message === 'Document search flow');
    expect(commit).toMatchObject({ author: 'alice-dev' });
    expect(commit.relativeTime).toMatch(/ago/);

    response = await api.get(`/api/repository-details/acme-demo/acme-docs/commits/${commit.id}`);
    expect(response.status).toBe(200);
    expect(response.body.commit.changedFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/search.ts', additions: 3, deletions: 1 }),
    ]));

    response = await api.get('/api/repository-details/acme-demo/acme-docs/code-search').query({ q: 'search flow', branch: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'README.md' })]));

    response = await api.get('/api/repository-details/acme-demo/acme-docs/code-search').query({ q: 'no-such-token', branch: 'main' });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
  });

  it('lists and switches branches and protects branch creation by permission and validation', async () => {
    let response = await api.get('/api/repository-details/evolution-module2-lab/branch-switch-demo/branches');
    expect(response.status).toBe(200);
    expect(response.body.branches).toEqual(expect.arrayContaining(['main', 'feature-search']));

    response = await api.get('/api/repository-details/evolution-module2-lab/branch-switch-demo/tree').query({ branch: 'feature-search' });
    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'main-only.md' })]));

    const contributor = await agentFor('branch-contributor');
    const branchName = `pw-branch-${Date.now()}`;
    response = await contributor.post('/api/repository-details/evolution-module2-lab/branch-switch-demo/branches').send({ name: branchName, baseBranch: 'main' });
    expect(response.status).toBe(201);
    expect(response.body.branch.name).toBe(branchName);

    response = await contributor.post('/api/repository-details/evolution-module2-lab/branch-switch-demo/branches').send({ name: 'invalid..branch' });
    expect(response.status).toBe(400);
    expect(response.body.errors.name).toBe('Invalid branch');

    const viewer = await agentFor('default-branch-viewer');
    response = await viewer.post('/api/repository-details/evolution-module2-lab/branch-switch-demo/branches').send({ name: `pw-forbidden-${Date.now()}` });
    expect(response.status).toBe(403);
  });

  it('changes visibility with admin permission and rejects non-admin', async () => {
    const admin = await agentFor('visibility-admin');
    let response = await admin.post('/api/repository-details/visibility-admin/visibility-demo/visibility').send({ visibility: 'public' });
    expect(response.status).toBe(200);
    expect(response.body.repository.visibility).toBe('public');

    response = await api.get('/api/repository-details/visibility-admin/visibility-demo');
    expect(response.status).toBe(200);

    const collaborator = await agentFor('collaborator');
    response = await collaborator.post('/api/repository-details/visibility-admin/visibility-demo/visibility').send({ visibility: 'private' });
    expect(response.status).toBe(403);
  });

  it('archives and restores repositories with admin permission and preserves content', async () => {
    const admin = await agentFor('evo-archive-admin', 'Evo-Password-987!');
    let response = await admin.post('/api/repository-details/evo-archive-admin/evo-archive-repository-s1/archive');
    expect(response.status).toBe(200);
    expect(response.body.repository.archived).toBe(true);
    response = await admin.get('/api/repository-details/evo-archive-admin/evo-archive-repository-s1');
    expect(response.body.repository.archived).toBe(true);

    response = await admin.post('/api/repository-details/evo-archive-admin/evo-archive-repository-s3/restore');
    expect(response.status).toBe(200);
    expect(response.body.repository.archived).toBe(false);
    response = await admin.get('/api/repository-details/evo-archive-admin/evo-archive-repository-s3/file').query({ branch: 'main', path: 'README.md' });
    expect(response.status).toBe(200);
    expect(response.body.file.content).toContain('Archive demo content');
  });

  it('forks a readable repository, preserves source link, and rejects the seeded conflict name', async () => {
    const forkUser = await agentFor('fork-user');
    const forkName = `pw-fork-${Date.now()}`;
    let response = await forkUser.post('/api/repository-details/acme-demo/acme-docs/fork').send({
      owner: 'fork-user',
      name: forkName,
      visibility: 'public',
    });
    expect(response.status).toBe(201);
    expect(response.body.repository).toMatchObject({ name: forkName, sourceFullName: 'acme-demo/acme-docs' });

    response = await forkUser.get(`/api/repository-details/fork-user/${forkName}/file`).query({ branch: 'main', path: 'src/README.md' });
    expect(response.status).toBe(200);
    expect(response.body.file.content).toContain('Document search flow');

    response = await forkUser.post('/api/repository-details/acme-demo/acme-docs/fork').send({
      owner: 'fork-user',
      name: 'acme-docs-fork',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.name).toMatch(/already exists/i);
  });
});

describe('REQ-4 code and version control', () => {
  it('creates a file through the write API with one commit and rejects invalid path/message without writes', async () => {
    const contributor = await agentFor('file-contributor');
    const filePath = `pw-file-${Date.now()}.md`;
    let response = await contributor.post('/api/repository-details/evolution-module2-lab/file-management-demo/files').send({
      path: filePath,
      content: 'created through the web file editor\n',
      message: `Add ${filePath}`,
      branch: 'main',
    });
    expect(response.status).toBe(201);

    response = await contributor.get('/api/repository-details/evolution-module2-lab/file-management-demo/file').query({ branch: 'main', path: filePath });
    expect(response.status).toBe(200);
    expect(response.body.file.content).toBe('created through the web file editor\n');

    response = await contributor.get('/api/repository-details/evolution-module2-lab/file-management-demo/commits').query({ branch: 'main' });
    expect(response.body.commits.some((commit) => commit.message === `Add ${filePath}`)).toBe(true);

    response = await contributor.post('/api/repository-details/evolution-module2-lab/file-management-demo/files').send({
      path: '../invalid.md',
      content: 'must not be saved',
      message: '',
      branch: 'main',
    });
    expect(response.status).toBe(400);
    const before = await contributor.get('/api/repository-details/evolution-module2-lab/file-management-demo/commits').query({ branch: 'main' });
    expect(before.body.commits.some((commit) => commit.message === '')).toBe(false);
  });

  it('changes the default branch for admins and hides it from non-admins', async () => {
    const admin = await agentFor('default-branch-admin');
    let response = await admin.post('/api/repository-details/evolution-module2-lab/default-branch-demo/default-branch').send({ branch: 'release' });
    expect(response.status).toBe(200);
    expect(response.body.defaultBranch).toBe('release');

    response = await admin.get('/api/repository-details/evolution-module2-lab/default-branch-demo');
    expect(response.body.repository.defaultBranch).toBe('release');

    const viewer = await agentFor('default-branch-viewer');
    response = await viewer.post('/api/repository-details/evolution-module2-lab/default-branch-demo/default-branch').send({ branch: 'main' });
    expect(response.status).toBe(403);
  });

  it('creates and reads releases and rejects a duplicate tag', async () => {
    const visitorRead = await api.get('/api/repository-details/evo-release-org/evo-release-repository-s2/releases/evo-v0-1-s2');
    expect(visitorRead.status).toBe(200);
    expect(visitorRead.body.release).toMatchObject({
      tag: 'evo-v0-1-s2',
      title: 'Existing Evolution Release',
      branchName: 'evo-main-s2',
    });

    const owner = await agentFor('evo-release-owner', 'Evo-Password-987!');
    let response = await owner.post('/api/repository-details/evo-release-org/evo-release-repository-s1/releases').send({
      tag: 'evo-v0-1-s1',
      title: 'Evolution Preview',
      description: 'Evolution release description',
      branch: 'evo-main-s1',
    });
    expect(response.status).toBe(201);
    expect(response.body.release).toMatchObject({ tag: 'evo-v0-1-s1', title: 'Evolution Preview' });

    response = await owner.post('/api/repository-details/evo-release-org/evo-release-repository-s3/releases').send({
      tag: 'evo-v0-1-s3',
      title: 'Duplicate',
      description: 'Duplicate tag',
      branch: 'evo-main-s3',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.tag).toBe('Tag already exists');
  });
});
