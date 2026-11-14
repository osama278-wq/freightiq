'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const db = require('./db');
const config = require('./config');
const auth = require('./auth');
const fx = require('./fx');
const geo = require('./data/geo');
const compare = require('./engine/compare');
const shipment = require('./engine/shipment');
const registry = require('./integrations/registry');
const searchService = require('./services/searchService');
const assistant = require('./agent/assistant');
const reports = require('./reports/report');
const ai = require('./agent/anthropic');
const { Router, HttpError, send } = require('./http');

const r = new Router();
const A = auth.requireAuth;
const OP = auth.requireRole('admin', 'staff');
const ADMIN = auth.requireRole('admin');
const ORGADMIN = auth.requireRole('admin', 'staff', 'client_admin');
const STARTED = Date.now();

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const str = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max));

// ───────────── Health & auth ─────────────
r.get('/api/health', () => ({ ok: true, uptime_s: Math.round((Date.now() - STARTED) / 1000), version: '1.0.0' }));
r.post('/api/auth/login', (ctx) => auth.login(ctx));
r.post('/api/auth/logout', (ctx) => { auth.destroySession(ctx); return { ok: true }; });
r.get('/api/auth/me', A, (ctx) => ({ user: ctx.user, csrf: ctx.csrf, ai_enabled: ai.isConfigured(), test_mode: config.authDisabled }));
r.get('/api/mode', () => ({ test_mode: config.authDisabled }));
r.post('/api/auth/password', A, (ctx) => {
  const { current_password, new_password } = ctx.body;
  const u = db.get().prepare('SELECT password_hash FROM users WHERE id=?').get(ctx.user.id);
  if (!auth.verifyPassword(current_password || '', u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
  auth.validatePassword(new_password);
  db.get().prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(new_password), ctx.user.id);
  db.get().prepare('DELETE FROM sessions WHERE user_id=? AND token_hash != ?').run(ctx.user.id, auth.sha256(ctx.cookies[auth.COOKIE]));
  db.audit(ctx.user, 'password_changed', 'user', ctx.user.id);
  return { ok: true };
});

// ───────────── Reference data ─────────────
r.get('/api/reference', A, () => ({
  countries: geo.COUNTRIES, seaports: geo.SEAPORTS, airports: geo.AIRPORTS, containers: Object.keys(shipment.CONTAINERS),
  statuses: Object.entries(compare.STATUS).map(([k, v]) => ({ key: k, ...v })), categories: compare.CATEGORIES.map(([key, label]) => ({ key, label })),
  currencies: fx.list().map((x) => x.code), base_currency: db.getSetting('base_currency', config.baseCurrency),
  incoterms: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  fx_attribution: config.fxProviderUrl.includes('er-api.com') ? { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' } : null,
}));

// ───────────── Dashboard ─────────────
r.get('/api/dashboard', A, (ctx) => {
  const d = db.get(); const scope = auth.orgScope(ctx.user);
  const w = scope === null ? '' : 'WHERE org_id=' + Number(scope);
  const wAnd = scope === null ? 'WHERE' : w + ' AND';
  const totals = {
    searches: d.prepare(`SELECT COUNT(*) c FROM searches ${w}`).get().c,
    searches_30d: d.prepare(`SELECT COUNT(*) c FROM searches ${wAnd} created_at >= ?`).get(new Date(Date.now() - 30 * 86400000).toISOString()).c,
    saved_quotes: d.prepare(`SELECT COUNT(*) c FROM saved_quotes ${w}`).get().c,
    firm_quotes: d.prepare(`SELECT COUNT(*) c FROM results ${wAnd} status IN ('VERIFIED_LIVE','MANUAL_QUOTE')`).get().c,
    providers: d.prepare('SELECT COUNT(*) c FROM providers WHERE active=1').get().c,
  };
  const recent = searchService.listSearches(ctx.user, { limit: 8 });
  // Best available prices: lowest comparable priced result per recent lane+mode.
  const best = [];
  for (const s of recent.slice(0, 6)) {
    if (s.status !== 'completed') continue;
    const v = searchService.getSearch(ctx.user, s.id);
    const c = v.recommendations.cheapest;
    if (c) best.push({ search_id: s.id, ref: s.ref, lane: s.lane, provider: c.provider, mode: c.mode, total: c.total, status_label: c.status_label, transit: c.transit });
  }
  const statusMix = d.prepare(`SELECT status, COUNT(*) c FROM results ${w} GROUP BY status`).all();
  const lanes = d.prepare(`SELECT json_extract(request,'$.origin_country')||' → '||json_extract(request,'$.dest_country') lane, COUNT(*) c FROM searches ${w} GROUP BY lane ORDER BY c DESC LIMIT 6`).all();
  const activity = d.prepare(`SELECT a.at, a.action, a.entity, a.entity_id, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${scope === null ? '' : 'WHERE a.org_id=' + Number(scope)} ORDER BY a.id DESC LIMIT 12`).all();
  const integrations = registry.list();
  const insights = [];
  if (db.getSetting('hormuz_advisory_active', true)) insights.push({ level: 'warn', text: 'Strait of Hormuz advisory active — Oman-bound ocean cargo defaults to Sohar/Salalah; UAE inner-Gulf ports carry diversion surcharges.' });
  insights.push({ level: 'info', text: `${integrations.filter((i) => i.configured && i.enabled).length} of ${integrations.length} price sources active. ${integrations.filter((i) => !i.configured).length} need credentials (see Administration → Integrations).` });
  const fxm = db.getSetting('fx_last_refresh', null);
  insights.push({ level: fxm && fxm.ok ? 'info' : 'warn', text: fxm && fxm.ok ? `FX rates live as of ${fxm.asOf.slice(0, 16)} UTC.` : 'FX live refresh unavailable — using stored/fallback rates (GCC pegs exact; others approximate).' });
  return { totals, recent, best, status_mix: statusMix, lanes, activity, insights };
});

// ───────────── Searches ─────────────
r.get('/api/searches', A, (ctx) => searchService.listSearches(ctx.user, { limit: ctx.query.limit, q: ctx.query.q }));
r.post('/api/searches', A, (ctx) => searchService.createSearch(ctx.user, ctx.body.request || ctx.body, { orgId: ctx.body.org_id }));
r.post('/api/searches/analyse', A, (ctx) => shipment.analyse(ctx.body.request || ctx.body));
const viewOpts = (q) => ({ currency: q.currency, weights: q.wp !== undefined ? { price: q.wp, speed: q.ws, reliability: q.wr } : undefined });
r.get('/api/searches/:id', A, (ctx) => searchService.getSearch(ctx.user, ctx.params.id, viewOpts(ctx.query)));
r.patch('/api/searches/:id', A, (ctx) => searchService.updateRequest(ctx.user, ctx.params.id, ctx.body || {}));
r.post('/api/searches/:id/rerun', A, (ctx) => searchService.rerun(ctx.user, ctx.params.id));
r.post('/api/searches/:id/quotes', A, (ctx) => searchService.addManualQuote(ctx.user, ctx.params.id, ctx.body));
r.delete('/api/searches/:id/results/:rid', A, (ctx) => searchService.deleteResult(ctx.user, ctx.params.id, ctx.params.rid));
r.post('/api/searches/:id/landed-cost', A, (ctx) => {
  const v = searchService.getSearch(ctx.user, ctx.params.id, viewOpts(ctx.query));
  const res = v.results.find((x) => x.id === Number(ctx.body.result_id));
  if (!res || !res.evaluation.total) throw new HttpError(400, 'Result not found or not priced');
  const goods = Number(ctx.body.goods_value ?? v.search.request.cargo_value);
  if (!goods) throw new HttpError(400, 'Cargo value is required for landed cost');
  return compare.landedCost({ goodsValue: goods, goodsCurrency: ctx.body.goods_currency || v.search.request.cargo_value_currency, freightTotal: res.evaluation.total.mid, freightCurrency: v.currency,
    insurance: ctx.body.insurance ?? null, dutyRate: ctx.body.duty_rate ?? 0.05, vatRate: ctx.body.vat_rate ?? 0.05, fixedFees: ctx.body.fixed_fees ?? 0, baseCurrency: v.currency });
});
r.get('/api/searches/:id/export.xlsx', A, (ctx) => {
  const v = searchService.getSearch(ctx.user, ctx.params.id, viewOpts(ctx.query));
  db.audit(ctx.user, 'report_exported', 'search', v.search.id, { format: 'xlsx' });
  send(ctx.res, 200, reports.excel(v), { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${v.search.ref}.xlsx"` });
});
r.get('/api/searches/:id/report.html', A, (ctx) => {
  const v = searchService.getSearch(ctx.user, ctx.params.id, viewOpts(ctx.query));
  db.audit(ctx.user, 'report_exported', 'search', v.search.id, { format: 'html/pdf' });
  send(ctx.res, 200, reports.html(v), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
});
r.post('/api/searches/:id/share', A, (ctx) => {
  const s = searchService.loadSearchRow(ctx.user, ctx.params.id);
  const days = Math.min(Math.max(Number(ctx.body.days) || 7, 1), 90);
  const token = crypto.randomBytes(24).toString('base64url');
  db.get().prepare('INSERT INTO share_links(token_hash, org_id, search_id, created_by, expires_at) VALUES (?,?,?,?,?)').run(auth.sha256(token), s.org_id, s.id, ctx.user.id, new Date(Date.now() + days * 86400000).toISOString());
  db.audit(ctx.user, 'share_link_created', 'search', s.id, { days });
  return { url: `${config.publicBaseUrl || ''}/share/${token}`, expires_in_days: days };
});
r.get('/api/searches/:id/shares', A, (ctx) => {
  const s = searchService.loadSearchRow(ctx.user, ctx.params.id);
  return db.get().prepare('SELECT substr(token_hash,1,10) id, expires_at, revoked, created_at FROM share_links WHERE search_id=? ORDER BY created_at DESC').all(s.id);
});
r.delete('/api/searches/:id/shares/:sid', A, (ctx) => {
  const s = searchService.loadSearchRow(ctx.user, ctx.params.id);
  db.get().prepare('UPDATE share_links SET revoked=1 WHERE search_id=? AND substr(token_hash,1,10)=?').run(s.id, ctx.params.sid);
  return { ok: true };
});
r.get('/share/:token', (ctx) => {
  const row = db.get().prepare('SELECT * FROM share_links WHERE token_hash=?').get(auth.sha256(ctx.params.token));
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) throw new HttpError(404, 'This share link is invalid or has expired');
  const v = searchService.getSearch(null, row.search_id);
  send(ctx.res, 200, reports.html(v, { shared: true }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
});

// ───────────── Saved quotations ─────────────
r.get('/api/saved', A, (ctx) => {
  const scope = auth.orgScope(ctx.user);
  return db.get().prepare(`SELECT q.*, s.ref, o.name org_name FROM saved_quotes q JOIN searches s ON s.id=q.search_id JOIN organizations o ON o.id=q.org_id ${scope === null ? '' : 'WHERE q.org_id=?'} ORDER BY q.id DESC`)
    .all(...(scope === null ? [] : [scope])).map((q) => ({ ...q, snapshot: db.P(q.snapshot, {}) }));
});
r.post('/api/saved', A, (ctx) => {
  const v = searchService.getSearch(ctx.user, ctx.body.search_id);
  const res = v.results.find((x) => x.id === Number(ctx.body.result_id));
  if (!res) throw new HttpError(404, 'Result not found');
  const snap = { provider: res.provider_name, provider_type: res.provider_type, status: res.status, status_label: res.evaluation.status_label, mode: res.mode, service_type: res.service_type, scope: res.scope,
    total: res.evaluation.total, comparable: res.evaluation.comparable, missing: res.evaluation.missing_required, transit: [res.transit_min, res.transit_max], validity_to: res.validity_to,
    source_name: res.source_name, source_url: res.source_url, retrieved_at: res.retrieved_at, lane: `${v.search.request.origin_country} → ${v.search.request.dest_country}`, lines: res.evaluation.lines, saved_at: new Date().toISOString() };
  try {
    db.get().prepare('INSERT INTO saved_quotes(org_id, user_id, search_id, result_id, label, notes, snapshot) VALUES (?,?,?,?,?,?,?)').run(v.search.org_id, ctx.user.id, v.search.id, res.id, str(ctx.body.label, 120), str(ctx.body.notes, 2000), db.J(snap));
  } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Already saved'); throw e; }
  db.audit(ctx.user, 'quote_saved', 'result', res.id);
  return { ok: true };
});
r.delete('/api/saved/:id', A, (ctx) => {
  const q = db.get().prepare('SELECT * FROM saved_quotes WHERE id=?').get(Number(ctx.params.id));
  if (!q) throw new HttpError(404, 'Not found');
  auth.assertOrgAccess(ctx.user, q.org_id);
  db.get().prepare('DELETE FROM saved_quotes WHERE id=?').run(q.id);
  return { ok: true };
});
r.get('/api/saved/export.xlsx', A, (ctx) => {
  const scope = auth.orgScope(ctx.user);
  const rows = db.get().prepare(`SELECT q.*, s.ref FROM saved_quotes q JOIN searches s ON s.id=q.search_id ${scope === null ? '' : 'WHERE q.org_id=?'} ORDER BY q.id DESC`).all(...(scope === null ? [] : [scope]));
  const { workbook } = require('./reports/xlsx');
  const data = [['Saved', 'Search', 'Label', 'Lane', 'Provider', 'Status', 'Mode', 'Total min', 'Total max', 'Currency', 'Like-for-like', 'Transit (d)', 'Valid until', 'Source', 'Retrieved', 'Notes']];
  for (const q of rows) { const s = db.P(q.snapshot, {}); data.push([q.created_at, q.ref, q.label, s.lane, s.provider, s.status_label, s.mode, s.total && s.total.min, s.total && s.total.max, s.total && s.total.currency, s.comparable ? 'Yes' : 'No', `${s.transit[0] ?? '?'}–${s.transit[1] ?? '?'}`, s.validity_to, `${s.source_name || ''} ${s.source_url || ''}`, s.retrieved_at, q.notes]); }
  send(ctx.res, 200, workbook([{ name: 'Saved quotations', rows: data }]), { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="saved-quotations.xlsx"' });
});

// ───────────── Providers directory ─────────────
const PROVIDER_FIELDS = ['name', 'provider_type', 'parent_group', 'website', 'hq_country', 'regions_served', 'countries_served', 'modes', 'main_hubs', 'contact', 'online_quote', 'online_quote_url', 'api_availability', 'api_docs_url', 'booking_platform', 'service_notes', 'oman_presence', 'reliability_rating', 'reliability_basis', 'evidence', 'last_verified', 'active'];
const JSON_FIELDS = new Set(['regions_served', 'countries_served', 'modes', 'main_hubs', 'contact', 'evidence']);
const PROVIDER_TYPES = ['ocean_carrier', 'air_carrier', 'integrator', 'forwarder', 'nvocc', 'broker', 'platform'];
const hydrateProvider = (p) => { const o = { ...p }; for (const f of JSON_FIELDS) o[f] = db.P(p[f], f === 'contact' ? {} : []); return o; };
r.get('/api/providers', A, (ctx) => {
  let rows = db.get().prepare('SELECT * FROM providers ORDER BY name').all().map(hydrateProvider);
  const { q, type, mode, country, active } = ctx.query;
  if (active !== 'all') rows = rows.filter((p) => p.active);
  if (type) rows = rows.filter((p) => p.provider_type === type);
  if (mode) rows = rows.filter((p) => p.modes.includes(mode));
  if (country) rows = rows.filter((p) => p.countries_served.includes(country) || p.hq_country === country || (country === 'OM' && ['verified', 'reported'].includes(p.oman_presence)));
  if (q) { const t = q.toLowerCase(); rows = rows.filter((p) => `${p.name} ${p.parent_group || ''} ${p.service_notes || ''} ${p.main_hubs.join(' ')}`.toLowerCase().includes(t)); }
  return rows;
});
r.get('/api/providers/:id', A, (ctx) => {
  const p = db.get().prepare('SELECT * FROM providers WHERE id=?').get(Number(ctx.params.id));
  if (!p) throw new HttpError(404, 'Not found');
  return { ...hydrateProvider(p), routes: db.get().prepare('SELECT * FROM provider_routes WHERE provider_id=?').all(p.id), integrations: registry.list().filter((i) => i.provider_slug === p.slug) };
});
function providerValues(body) {
  const v = pick(body, PROVIDER_FIELDS);
  if (v.provider_type && !PROVIDER_TYPES.includes(v.provider_type)) throw new HttpError(400, `provider_type must be one of ${PROVIDER_TYPES.join(', ')}`);
  if (v.reliability_rating !== undefined && v.reliability_rating !== null && (v.reliability_rating < 0 || v.reliability_rating > 5)) throw new HttpError(400, 'reliability_rating must be 0–5');
  if (v.reliability_rating && !v.reliability_basis && !body._keep_basis) throw new HttpError(400, 'reliability_basis is required when setting a rating (e.g. "On-time 9/10 shipments in 2026, internal KPI")');
  for (const f of JSON_FIELDS) if (v[f] !== undefined) v[f] = db.J(v[f]);
  if (v.modes) { const m = db.P(v.modes, []); Object.assign(v, { fcl: +m.includes('sea_fcl'), lcl: +m.includes('sea_lcl'), air: +m.includes('air'), sea: +m.some((x) => x.startsWith('sea')), express: +m.includes('express'), road: +m.includes('road') }); }
  if (v.active !== undefined) v.active = v.active ? 1 : 0;
  return v;
}
r.post('/api/providers', OP, (ctx) => {
  const v = providerValues(ctx.body);
  if (!v.name || !v.provider_type) throw new HttpError(400, 'name and provider_type are required');
  v.slug = (ctx.body.slug || v.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (db.get().prepare('SELECT 1 FROM providers WHERE slug=?').get(v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) ? '-' + crypto.randomBytes(2).toString('hex') : '');
  const keys = Object.keys(v);
  const info = db.get().prepare(`INSERT INTO providers(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => v[k]));
  db.audit(ctx.user, 'provider_created', 'provider', info.lastInsertRowid, { name: v.name });
  return hydrateProvider(db.get().prepare('SELECT * FROM providers WHERE id=?').get(info.lastInsertRowid));
});
r.put('/api/providers/:id', OP, (ctx) => {
  const v = providerValues({ ...ctx.body, _keep_basis: true });
  const keys = Object.keys(v); if (!keys.length) throw new HttpError(400, 'Nothing to update');
  db.get().prepare(`UPDATE providers SET ${keys.map((k) => k + '=?').join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => v[k]), new Date().toISOString(), Number(ctx.params.id));
  db.audit(ctx.user, 'provider_updated', 'provider', ctx.params.id, { fields: keys });
  return hydrateProvider(db.get().prepare('SELECT * FROM providers WHERE id=?').get(Number(ctx.params.id)));
});
r.post('/api/providers/:id/routes', OP, (ctx) => {
  const { origin_country, dest_country, mode, evidence_url, notes } = ctx.body;
  if (!origin_country || !dest_country || !mode || !evidence_url) throw new HttpError(400, 'origin_country, dest_country, mode and evidence_url are required — route coverage must be evidenced');
  db.get().prepare('INSERT INTO provider_routes(provider_id, origin_country, dest_country, mode, evidence_url, notes, verified_at) VALUES (?,?,?,?,?,?,?)').run(Number(ctx.params.id), origin_country.toUpperCase(), dest_country.toUpperCase(), mode, evidence_url, str(notes), new Date().toISOString());
  db.audit(ctx.user, 'provider_route_added', 'provider', ctx.params.id);
  return { ok: true };
});
r.delete('/api/providers/:id/routes/:rid', OP, (ctx) => { db.get().prepare('DELETE FROM provider_routes WHERE id=? AND provider_id=?').run(Number(ctx.params.rid), Number(ctx.params.id)); return { ok: true }; });

// ───────────── Assistant ─────────────
r.post('/api/assistant/conversations', A, (ctx) => assistant.createConversation(ctx.user, ctx.body.search_id));
r.get('/api/assistant/conversations', A, (ctx) => db.get().prepare('SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) n FROM conversations c WHERE c.user_id=? ORDER BY c.id DESC LIMIT 30').all(ctx.user.id));
r.get('/api/assistant/conversations/:id', A, (ctx) => { const c = assistant.getConversation(ctx.user, ctx.params.id); return { ...c, messages: assistant.history(c.id) }; });
r.post('/api/assistant/conversations/:id/messages', A, (ctx) => assistant.chat(ctx.user, ctx.params.id, ctx.body.text));

// ───────────── Organisation users (client admins manage their own team) ─────────────
r.get('/api/org/users', ORGADMIN, (ctx) => db.get().prepare('SELECT id, email, name, role, active, last_login, created_at FROM users WHERE org_id=? ORDER BY name').all(ctx.user.org_id));
r.post('/api/org/users', ORGADMIN, (ctx) => createUser(ctx, ctx.user.org_id, ctx.body.role === 'client_admin' ? 'client_admin' : 'client_user'));

function createUser(ctx, orgId, role) {
  const { email, name, password } = ctx.body;
  if (!email || !name || !password) throw new HttpError(400, 'email, name and password are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Invalid email');
  auth.validatePassword(password);
  const org = db.get().prepare('SELECT * FROM organizations WHERE id=?').get(Number(orgId));
  if (!org) throw new HttpError(400, 'Organisation not found');
  if (org.type === 'client' && ['admin', 'staff'].includes(role)) throw new HttpError(400, 'Operator roles can only be assigned in the operator organisation');
  if (org.type === 'operator' && !['admin', 'staff'].includes(role)) throw new HttpError(400, 'Operator organisation users must be admin or staff');
  try {
    const info = db.get().prepare('INSERT INTO users(org_id, email, name, password_hash, role) VALUES (?,?,?,?,?)').run(org.id, email.trim(), str(name, 120), auth.hashPassword(password), role);
    db.audit(ctx.user, 'user_created', 'user', info.lastInsertRowid, { email, role, org: org.id });
    return { id: Number(info.lastInsertRowid), email, name, role, org_id: org.id };
  } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'A user with this email already exists'); throw e; }
}

// ───────────── Administration ─────────────
r.get('/api/admin/orgs', OP, () => db.get().prepare(`SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.org_id=o.id) users, (SELECT COUNT(*) FROM searches s WHERE s.org_id=o.id) searches FROM organizations o ORDER BY o.type DESC, o.name`).all());
r.post('/api/admin/orgs', ADMIN, (ctx) => {
  const { name, country, contact_email } = ctx.body;
  if (!name) throw new HttpError(400, 'name is required');
  const info = db.get().prepare("INSERT INTO organizations(name, type, country, contact_email) VALUES (?, 'client', ?, ?)").run(str(name, 160), str(country, 2), str(contact_email, 160));
  db.audit(ctx.user, 'org_created', 'organization', info.lastInsertRowid, { name });
  return db.get().prepare('SELECT * FROM organizations WHERE id=?').get(info.lastInsertRowid);
});
r.patch('/api/admin/orgs/:id', ADMIN, (ctx) => {
  const v = pick(ctx.body, ['name', 'country', 'contact_email', 'active']); if (v.active !== undefined) v.active = v.active ? 1 : 0;
  const keys = Object.keys(v); if (!keys.length) throw new HttpError(400, 'Nothing to update');
  db.get().prepare(`UPDATE organizations SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => v[k]), Number(ctx.params.id));
  db.audit(ctx.user, 'org_updated', 'organization', ctx.params.id, v);
  return { ok: true };
});
r.get('/api/admin/users', OP, () => db.get().prepare('SELECT u.id, u.org_id, o.name org_name, u.email, u.name, u.role, u.active, u.last_login, u.created_at FROM users u JOIN organizations o ON o.id=u.org_id ORDER BY o.name, u.name').all());
r.post('/api/admin/users', ADMIN, (ctx) => { if (!auth.ROLES.includes(ctx.body.role)) throw new HttpError(400, 'Invalid role'); return createUser(ctx, ctx.body.org_id, ctx.body.role); });
r.patch('/api/admin/users/:id', ADMIN, (ctx) => {
  const id = Number(ctx.params.id);
  const v = pick(ctx.body, ['name', 'role', 'active']);
  if (v.role && !auth.ROLES.includes(v.role)) throw new HttpError(400, 'Invalid role');
  if (id === ctx.user.id && (v.active === false || (v.role && v.role !== 'admin'))) throw new HttpError(400, 'You cannot deactivate or demote yourself');
  if (v.active !== undefined) v.active = v.active ? 1 : 0;
  if (ctx.body.password) { auth.validatePassword(ctx.body.password); v.password_hash = auth.hashPassword(ctx.body.password); }
  const keys = Object.keys(v); if (!keys.length) throw new HttpError(400, 'Nothing to update');
  db.get().prepare(`UPDATE users SET ${keys.map((k) => k + '=?').join(',')}, failed_logins=0, locked_until=NULL WHERE id=?`).run(...keys.map((k) => v[k]), id);
  if (v.active === 0 || v.password_hash) db.get().prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.audit(ctx.user, 'user_updated', 'user', id, { fields: keys.filter((k) => k !== 'password_hash') });
  return { ok: true };
});
r.get('/api/admin/integrations', OP, () => registry.list());
r.patch('/api/admin/integrations/:key', ADMIN, (ctx) => {
  if (!registry.byKey[ctx.params.key]) throw new HttpError(404, 'Unknown integration');
  db.get().prepare('UPDATE integrations SET enabled=? WHERE key=?').run(ctx.body.enabled ? 1 : 0, ctx.params.key);
  db.audit(ctx.user, 'integration_toggled', 'integration', ctx.params.key, { enabled: !!ctx.body.enabled });
  return { ok: true };
});
r.get('/api/admin/settings', OP, () => ({
  base_currency: db.getSetting('base_currency', config.baseCurrency), hormuz_advisory_active: db.getSetting('hormuz_advisory_active', true), operator_is_forwarder: db.getSetting('operator_is_forwarder', false),
  operator_name: db.getSetting('operator_name', ''), default_weights: db.getSetting('default_weights', { price: 0.5, speed: 0.3, reliability: 0.2 }),
  ai: { enabled: ai.isConfigured(), model: config.anthropicModel, web_research_max_searches: config.webResearchMaxSearches }, fx_provider: config.fxProviderUrl,
}));
r.patch('/api/admin/settings', ADMIN, (ctx) => {
  const allowed = ['base_currency', 'hormuz_advisory_active', 'operator_is_forwarder', 'operator_name', 'default_weights'];
  for (const k of allowed) if (ctx.body[k] !== undefined) {
    if (k === 'base_currency' && !fx.list().some((x) => x.code === String(ctx.body[k]).toUpperCase())) throw new HttpError(400, 'Unknown currency');
    db.setSetting(k, k === 'base_currency' ? String(ctx.body[k]).toUpperCase() : k === 'default_weights' ? shipment.normalizeWeights(ctx.body[k]) : ctx.body[k]);
  }
  db.audit(ctx.user, 'settings_updated', 'settings', null, ctx.body);
  return { ok: true };
});
r.get('/api/admin/fx', OP, () => ({ rates: fx.list(), last_refresh: db.getSetting('fx_last_refresh', null) }));
r.post('/api/admin/fx/refresh', ADMIN, async () => fx.refresh());
r.put('/api/admin/fx/:code', ADMIN, (ctx) => { const v = Number(ctx.body.per_usd); if (!(v > 0)) throw new HttpError(400, 'per_usd must be > 0'); fx.setManual(ctx.params.code, v); db.audit(ctx.user, 'fx_manual', 'fx', ctx.params.code, { per_usd: v }); return { ok: true }; });
r.get('/api/admin/benchmarks', OP, () => db.get().prepare('SELECT * FROM benchmarks ORDER BY origin_country, dest_country, mode').all().map((b) => ({ ...b, charges: db.P(b.charges, []) })));
r.post('/api/admin/benchmarks', OP, (ctx) => {
  const b = ctx.body;
  for (const k of ['origin_country', 'dest_country', 'mode', 'currency', 'charges', 'source_name', 'as_of']) if (!b[k]) throw new HttpError(400, `${k} is required`);
  if (!['MARKET_BENCHMARK', 'HISTORICAL'].includes(b.status || 'MARKET_BENCHMARK')) throw new HttpError(400, 'Benchmarks can only be MARKET_BENCHMARK or HISTORICAL');
  const info = db.get().prepare(`INSERT INTO benchmarks(origin_country,dest_country,origin_point,dest_point,mode,service_type,scope,applies_min_kg,applies_max_kg,applies_min_cbm,applies_max_cbm,currency,charges,transit_min,transit_max,source_name,source_url,as_of,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.origin_country.toUpperCase(), b.dest_country.toUpperCase(), b.origin_point || null, b.dest_point || null, b.mode, b.service_type || null, b.scope || null, b.applies_min_kg ?? null, b.applies_max_kg ?? null, b.applies_min_cbm ?? null, b.applies_max_cbm ?? null, b.currency.toUpperCase(), db.J(b.charges), b.transit_min ?? null, b.transit_max ?? null, b.source_name, b.source_url || null, b.as_of, b.status || 'MARKET_BENCHMARK', b.notes || null);
  db.audit(ctx.user, 'benchmark_added', 'benchmark', info.lastInsertRowid);
  return { id: Number(info.lastInsertRowid) };
});
r.delete('/api/admin/benchmarks/:id', OP, (ctx) => { db.get().prepare('DELETE FROM benchmarks WHERE id=?').run(Number(ctx.params.id)); db.audit(ctx.user, 'benchmark_deleted', 'benchmark', ctx.params.id); return { ok: true }; });
r.get('/api/admin/history', OP, (ctx) => searchService.listSearches(ctx.user, { limit: ctx.query.limit || 200, q: ctx.query.q }));
r.get('/api/admin/audit', OP, (ctx) => db.get().prepare('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?').all(Math.min(Number(ctx.query.limit) || 200, 1000)));
r.get('/api/admin/performance', OP, () => {
  const d = db.get();
  let dbSize = null; try { const f = config.dbFile || require('node:path').join(config.dataDir, 'freightiq.db'); dbSize = fs.statSync(f).size; } catch { /* in-memory */ }
  return {
    uptime_s: Math.round((Date.now() - STARTED) / 1000), memory_mb: Math.round(process.memoryUsage().rss / 1048576), node: process.version, db_bytes: dbSize,
    routes: d.prepare('SELECT route, SUM(count) count, SUM(errors) errors, ROUND(1.0*SUM(total_ms)/SUM(count),1) avg_ms FROM request_metrics WHERE day >= ? GROUP BY route ORDER BY count DESC LIMIT 40').all(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    searches: d.prepare("SELECT status, COUNT(*) c FROM searches GROUP BY status").all(),
    avg_search_s: d.prepare("SELECT ROUND(AVG((julianday(completed_at)-julianday(created_at))*86400),1) s FROM searches WHERE completed_at IS NOT NULL").get().s,
    integrations: registry.list().map((i) => ({ key: i.key, status: i.status, calls_total: i.calls_total, calls_failed: i.calls_failed, last_error: i.last_error })),
  };
});

module.exports = r;
