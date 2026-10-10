const request = require('supertest');
const { createTestDatabaseHarness } = require('../src/database/test_harness');

let app;
let api;
let harness;

function cookieOf(response) {
  const header = response.headers['set-cookie'];
  return header ? header[0].split(';')[0] : '';
}

beforeAll(async () => {
  harness = createTestDatabaseHarness({ label: 'req12-api', seedDefault: true });
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

describe('REQ-1 identity and access', () => {
  it('registers a new account with valid underscore username and rejects invalid registration fields together', async () => {
    let response = await api.post('/api/auth/register').send({
      username: 'Bad_User_',
      email: 'not-an-email',
      password: 'short',
      confirmPassword: 'different',
      agreeToTerms: false,
    });
    expect(response.status).toBe(400);
    expect(response.body.errors).toMatchObject({
      username: 'Username format is invalid',
      email: 'Email format is invalid',
      password: 'Password requirements are not satisfied',
      terms: 'Agree to terms is required',
    });

    const suffix = Date.now();
    const username = `evo_user_${suffix}`;
    const email = `evo.user.${suffix}@evolution.test`;
    response = await api.post('/api/auth/register').send({
      username,
      email,
      password: 'Evo-Password-987!',
      confirmPassword: 'Evo-Password-987!',
      agreeToTerms: true,
    });
    expect(response.status).toBe(201);
    expect(response.body.account).toMatchObject({ username, email, verified: true });

    const agent = request.agent(app);
    response = await agent.post('/api/auth/signin').send({ identifier: email, password: 'Evo-Password-987!' });
    expect(response.status).toBe(200);
    expect(response.body.account.username).toBe(username);
  });

  it('supports exact username and case-insensitive email sign-in and generic invalid credentials', async () => {
    let response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'EVO.LOGIN.CASE@EVOLUTION.TEST', password: 'Evo-Password-987!' });
    expect(response.status).toBe(200);
    expect(response.body.account.username).toBe('evo-login-case');

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'EVO-LOGIN-CASE', password: 'Evo-Password-987!' });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid credentials');

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'evo-login-case', password: 'bad' });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid credentials');
  });

  it('renders fixed recovery code and resets only with the correct code and compliant password', async () => {
    let response = await api.post('/api/auth/forgot').send({ email: 'recovery-success@example.test' });
    expect(response.status).toBe(200);
    expect(response.body.code).toBe('123456');

    response = await api.post('/api/auth/reset').send({
      email: 'recovery-success@example.test',
      code: '000000',
      newPassword: 'Replacement-password-456!',
      confirmPassword: 'Replacement-password-456!',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.verificationCode).toBe('Verification code is invalid');

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'recovery-success@example.test', password: 'Valid-password-123!' });
    expect(response.status).toBe(200);

    response = await api.post('/api/auth/reset').send({
      email: 'recovery-success@example.test',
      code: '123456',
      newPassword: 'Replacement-password-456!',
      confirmPassword: 'Replacement-password-456!',
    });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Password updated');

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'recovery-success@example.test', password: 'Replacement-password-456!' });
    expect(response.status).toBe(200);
    expect(response.body.account.username).toBe('recovery-success');
  });

  it('requires the current password, rejects a mismatch, and switches the new password successfully', async () => {
    const agent = request.agent(app);
    let response = await agent
      .post('/api/auth/signin')
      .send({ identifier: 'password-change-success', password: 'Valid-password-123!' });
    expect(response.status).toBe(200);

    response = await agent.post('/api/auth/password').send({
      currentPassword: 'Valid-password-123!-wrong',
      newPassword: 'Another-valid-password-123!',
      confirmPassword: 'does-not-match',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.currentPassword).toBe('Current password is incorrect');
    expect(response.body.errors.confirmPassword).toBe('Password confirmation does not match');

    response = await agent.post('/api/auth/password').send({
      currentPassword: '',
      newPassword: 'Required-password-789!',
      confirmPassword: 'Required-password-789!',
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.currentPassword).toBe('Current password is required');

    response = await agent.post('/api/auth/password').send({
      currentPassword: 'Valid-password-123!',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!',
    });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Password updated');

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'password-change-success@example.test', password: 'New-password-456!' });
    expect(response.status).toBe(200);

    response = await api
      .post('/api/auth/signin')
      .send({ identifier: 'password-change-success@example.test', password: 'Valid-password-123!' });
    expect(response.status).toBe(401);
  });

  it('lists active sessions and lets only a non-current session be revoked', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/signin')
      .send({ identifier: 'evo-session-owner', password: 'Evo-Password-987!' });
    let response = await agent.get('/api/auth/sessions');
    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(1);
    const currentId = response.body.sessions[0].id;

    const second = request.agent(app);
    await second
      .post('/api/auth/signin')
      .send({ identifier: 'evo-session-owner', password: 'Evo-Password-987!' });
    response = await agent.get('/api/auth/sessions');
    expect(response.body.sessions).toHaveLength(2);
    const other = response.body.sessions.find((session) => !session.isCurrent);

    response = await agent.post(`/api/auth/sessions/${currentId}/revoke`);
    expect(response.status).toBe(400);

    response = await agent.post(`/api/auth/sessions/${other.id}/revoke`);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Session revoked');

    response = await second.get('/api/auth/me');
    expect(response.status).toBe(401);
  });
});

describe('REQ-2 organization and repository governance', () => {
  it('creates a normalized organization, rejects duplicates, and validates both fields', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/signin')
      .send({ identifier: 'evo-org-owner', password: 'Evo-Password-987!' });

    let response = await agent
      .post('/api/organizations')
      .send({ name: 'Evo-Test-Lab', displayName: '  Evo Test Lab  ' });
    expect(response.status).toBe(201);
    expect(response.body.organization).toMatchObject({ name: 'evo-test-lab', displayName: 'Evo Test Lab' });

    response = await agent
      .post('/api/organizations')
      .send({ name: 'EVO-TEST-LAB', displayName: 'Duplicate' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Organization name already exists');

    response = await agent
      .post('/api/organizations')
      .send({ name: '-bad-name', displayName: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual({
      name: 'Organization name format is invalid',
      displayName: 'Display name is required',
    });
  });

  it('hides private repositories from visitors and exposes public repository navigation', async () => {
    let response = await api.get('/api/organizations/acme-demo/repositories');
    expect(response.status).toBe(200);
    expect(response.body.repositories.map((repository) => repository.name)).toEqual(['acme-docs']);

    response = await api.get('/api/repositories/acme-demo/secret-research');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Access denied');

    response = await api.get('/api/repositories/acme-demo/acme-docs');
    expect(response.status).toBe(200);
    expect(response.body.repository.fullName).toBe('acme-demo/acme-docs');
  });

  it('rejects team hierarchy cycles and keeps the previous parent', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/signin')
      .send({ identifier: 'team-maintainer', password: 'Valid-password-123!' });

    let response = await agent
      .patch('/api/organizations/acme-demo/teams/frontend-team')
      .send({ parentTeamName: 'frontend-child' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Cyclic team hierarchy is not allowed');

    response = await agent.get('/api/organizations/acme-demo/teams/frontend-team');
    expect(response.body.team.parentTeam).toBe('platform-team');
  });

  it('adds and removes organization members directly, including atomic cleanup and repository denial', async () => {
    const owner = request.agent(app);
    await owner
      .post('/api/auth/signin')
      .send({ identifier: 'org-owner', password: 'Valid-password-123!' });

    let response = await owner
      .post('/api/organizations/acme-demo/people')
      .send({ identifier: 'new-member', role: 'Member' });
    expect(response.status).toBe(201);
    expect(response.body.member.role).toBe('Member');

    const member = request.agent(app);
    await member
      .post('/api/auth/signin')
      .send({ identifier: 'new-member', password: 'Valid-password-123!' });
    response = await member.get('/api/organizations');
    expect(response.body.organizations.some((organization) => organization.name === 'acme-demo')).toBe(true);
    response = await member.get('/api/repositories/acme-demo/secret-research');
    expect(response.status).toBe(403);

    response = await owner
      .post('/api/organizations/acme-demo/people')
      .send({ identifier: 'new-member', role: 'Member' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Account is already a member');

    response = await owner
      .post('/api/organizations/acme-demo/people')
      .send({ identifier: 'unknown-reviewer', role: 'Member' });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Account not found');

    response = await owner.delete('/api/organizations/acme-demo/people/new-member');
    expect(response.status).toBe(200);
    response = await owner.get('/api/organizations/acme-demo/people');
    expect(response.body.members.some((item) => item.username === 'new-member')).toBe(false);
  });

  it('adds a team grant with Write and updates it to Read without duplicating the row', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/signin')
      .send({ identifier: 'repo-admin', password: 'Valid-password-123!' });

    let response = await agent
      .post('/api/repositories/acme-demo/acme-docs/access')
      .send({ teamName: 'frontend-team', role: 'Write' });
    expect(response.status).toBe(201);
    const grantId = response.body.grant.id;

    response = await agent
      .patch(`/api/repositories/acme-demo/acme-docs/access/${grantId}`)
      .send({ role: 'Read' });
    expect(response.status).toBe(200);

    response = await agent.get('/api/repositories/acme-demo/acme-docs/access');
    const grants = response.body.grants.filter((grant) => grant.teamName === 'frontend-team');
    expect(grants).toHaveLength(1);
    expect(grants[0].role).toBe('Read');
  });

  it('shows audit events to Owners, filters them, and denies ordinary Members', async () => {
    const owner = request.agent(app);
    await owner
      .post('/api/auth/signin')
      .send({ identifier: 'evo-audit-owner', password: 'Evo-Password-987!' });
    let response = await owner.get('/api/organizations/evo-audit-org/audit');
    expect(response.status).toBe(200);
    expect(response.body.events.length).toBeGreaterThanOrEqual(2);

    response = await owner.get('/api/organizations/evo-audit-org/audit?action=Member%20added');
    expect(response.body.events.every((event) => event.action === 'Member added')).toBe(true);

    const viewer = request.agent(app);
    await viewer
      .post('/api/auth/signin')
      .send({ identifier: 'evo-audit-viewer', password: 'Evo-Password-987!' });
    response = await viewer.get('/api/organizations/evo-audit-org/audit');
    expect(response.status).toBe(403);
  });
});
