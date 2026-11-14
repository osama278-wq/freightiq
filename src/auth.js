'use strict';
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const { HttpError } = require('./http');

const COOKIE = 'fiq_session';
const ROLES = ['admin', 'staff', 'client_admin', 'client_user'];
const OPERATOR_ROLES = new Set(['admin', 'staff']);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const key = Buffer.from(keyB64, 'base64');
    const test = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(key, test);
  } catch { return false; }
}
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers');
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(user, ctx) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const exp = new Date(now.getTime() + config.sessionTtlHours * 3600 * 1000);
  db.get().prepare('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at,ip,ua) VALUES (?,?,?,?,?,?,?)')
    .run(sha256(token), user.id, csrf, now.toISOString(), exp.toISOString(), ctx.ip || null, (ctx.req.headers['user-agent'] || '').slice(0, 200));
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.sessionTtlHours * 3600}`];
  if (config.cookieSecure) parts.push('Secure');
  ctx.res.setHeader('Set-Cookie', parts.join('; '));
  return { csrf };
}

function destroySession(ctx) {
  const t = ctx.cookies[COOKIE];
  if (t) db.get().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(t));
  ctx.res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// Middleware: attach user if a valid session cookie exists; enforce CSRF on mutations.
// Test mode: ensure a built-in administrator exists and give every visitor a session for it.
function testModeUser() {
  const d = db.get();
  let u = d.prepare("SELECT * FROM users WHERE email='test-mode@freightiq.local'").get();
  if (!u) {
    let org = d.prepare("SELECT id FROM organizations WHERE type='operator' ORDER BY id LIMIT 1").get();
    if (!org) { d.prepare("INSERT INTO organizations(name, type, country) VALUES ('FreightIQ Operator','operator','OM')").run(); org = d.prepare("SELECT id FROM organizations WHERE type='operator' ORDER BY id LIMIT 1").get(); }
    d.prepare("INSERT INTO users(org_id, email, name, password_hash, role) VALUES (?,?,?,?,'admin')").run(org.id, 'test-mode@freightiq.local', 'Test user', hashPassword(require('node:crypto').randomBytes(24).toString('hex')));
    u = d.prepare("SELECT * FROM users WHERE email='test-mode@freightiq.local'").get();
  }
  return u;
}

async function attachUser(ctx) {
  const t = ctx.cookies[COOKIE];
  if (!t && config.authDisabled) {
    const u = testModeUser();
    const { csrf } = createSession(u, ctx);
    const o = db.get().prepare('SELECT name, type FROM organizations WHERE id=?').get(u.org_id);
    ctx.user = { id: u.id, org_id: u.org_id, email: u.email, name: u.name, role: u.role, org_name: o.name, org_type: o.type };
    ctx.csrf = csrf;
    return; // fresh session: the browser receives its CSRF token from /api/auth/me
  }
  if (!t) return;
  const row = db.get().prepare(`SELECT s.csrf, s.expires_at, u.id, u.org_id, u.email, u.name, u.role, u.active, o.name AS org_name, o.type AS org_type, o.active AS org_active
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN organizations o ON o.id=u.org_id WHERE s.token_hash=?`).get(sha256(t));
  if (!row) { if (config.authDisabled) { ctx.cookies = { ...ctx.cookies }; delete ctx.cookies[COOKIE]; return attachUser(ctx); } return; }
  if (new Date(row.expires_at) < new Date() || !row.active || !row.org_active) {
    db.get().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(t));
    return;
  }
  ctx.user = { id: row.id, org_id: row.org_id, email: row.email, name: row.name, role: row.role, org_name: row.org_name, org_type: row.org_type };
  ctx.csrf = row.csrf;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.req.method) && !ctx.url.pathname.startsWith('/api/auth/login')) {
    const h = ctx.req.headers['x-csrf-token'];
    if (!h || h !== row.csrf) throw new HttpError(403, 'Invalid or missing CSRF token');
  }
}

const requireAuth = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Authentication required'); };
const requireRole = (...roles) => (ctx) => {
  requireAuth(ctx);
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'Insufficient permissions');
};
const isOperator = (user) => user && OPERATOR_ROLES.has(user.role);

// Tenancy: operator staff see every client; client users see only their organisation.
function orgScope(user) { return isOperator(user) ? null : user.org_id; }
function assertOrgAccess(user, orgId) {
  if (isOperator(user)) return;
  if (Number(orgId) !== Number(user.org_id)) throw new HttpError(404, 'Not found'); // 404 avoids leaking existence
}

function login(ctx) {
  const { email, password } = ctx.body || {};
  if (!email || !password) throw new HttpError(400, 'Email and password are required');
  const d = db.get();
  const u = d.prepare('SELECT u.*, o.active AS org_active FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.email=?').get(String(email).trim());
  const fail = () => { throw new HttpError(401, 'Invalid email or password'); };
  if (!u) { verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA'); fail(); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(429, 'Account temporarily locked after repeated failed logins. Try again later.');
  if (!u.active || !u.org_active || !verifyPassword(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    d.prepare('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?').run(n, n >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, u.id);
    db.audit({ id: u.id, org_id: u.org_id }, 'login_failed', 'user', u.id);
    fail();
  }
  d.prepare('UPDATE users SET failed_logins=0, locked_until=NULL, last_login=? WHERE id=?').run(new Date().toISOString(), u.id);
  const { csrf } = createSession(u, ctx);
  db.audit(u, 'login', 'user', u.id);
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, org_id: u.org_id }, csrf };
}

module.exports = { hashPassword, verifyPassword, validatePassword, sha256, attachUser, requireAuth, requireRole, isOperator, orgScope, assertOrgAccess, login, destroySession, ROLES, COOKIE };
