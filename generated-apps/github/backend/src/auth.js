const crypto = require('crypto');
const { get, run } = require('./database/db_runtime');

const SESSION_COOKIE = 'gh_session';

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }
    const key = decodeURIComponent(trimmed.slice(0, equalsIndex).trim());
    const value = decodeURIComponent(trimmed.slice(equalsIndex + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function sessionCookie(value, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAgeSeconds !== null) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  return parts.join('; ');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', sessionCookie(token));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

async function createSession(accountId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const deviceLabel = String(req.headers?.['user-agent'] || 'Browser session').slice(0, 120);
  const result = await run(
    `INSERT INTO sessions (token, account_id, active, device_label, last_active, created_at)
     VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))`,
    [token, accountId, deviceLabel || 'Browser session'],
  );
  return { token, sessionId: result.lastID, deviceLabel };
}

async function getCurrentSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const row = await get(
    `SELECT s.id AS session_id, s.active, s.device_label, s.last_active,
            a.id AS account_id, a.username, a.email, a.verified
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.token = ? AND s.active = 1`,
    [token],
  );
  if (!row) {
    return null;
  }

  await run(`UPDATE sessions SET last_active = datetime('now') WHERE id = ?`, [row.session_id]);
  return {
    sessionId: row.session_id,
    token,
    account: {
      id: row.account_id,
      username: row.username,
      email: row.email,
      verified: Boolean(row.verified),
    },
  };
}

async function requireAuth(req, res, next) {
  try {
    const session = await getCurrentSession(req);
    if (!session) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.session = session;
    req.user = session.account;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  getCurrentSession,
  requireAuth,
};
