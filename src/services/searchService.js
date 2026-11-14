'use strict';
// Search orchestration: create → analyse → queue → run adapters (with timeouts and a
// transparent per-source log) → persist results → evaluate & recommend on read.
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const shipment = require('../engine/shipment');
const compare = require('../engine/compare');
const registry = require('../integrations/registry');
const { HttpError } = require('../http');
const { orgScope, assertOrgAccess } = require('../auth');

const ADAPTER_TIMEOUT_MS = 150000;
const queue = []; let running = 0; const CONCURRENCY = 2;

function newRef() { return 'FQ-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }

function createSearch(user, input, { orgId } = {}) {
  const a = shipment.analyse(input || {});
  if (!a.request.origin_country || !a.request.dest_country) throw new HttpError(400, 'Origin and destination country are required', a.missing);
  // Operators may run a search on behalf of a client organisation.
  let org = user.org_id;
  if (orgId && orgScope(user) === null) org = Number(orgId);
  const ref = newRef();
  const info = db.get().prepare('INSERT INTO searches(ref, org_id, user_id, status, request, derived, missing, advisories) VALUES (?,?,?,?,?,?,?,?)')
    .run(ref, org, user.id, 'queued', db.J(a.request), db.J(a.derived), db.J(a.missing), db.J(a.advisories));
  db.audit(user, 'search_created', 'search', info.lastInsertRowid, { ref });
  enqueue(Number(info.lastInsertRowid));
  return getSearch(user, Number(info.lastInsertRowid));
}

function enqueue(id) { queue.push(id); pump(); }
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift(); running++;
    runSearch(id).catch((e) => console.error('[search] run failed', id, e)).finally(() => { running--; pump(); });
  }
}

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms).unref())]);
}

async function runSearch(id) {
  const d = db.get();
  const s = d.prepare('SELECT * FROM searches WHERE id=?').get(id);
  if (!s) return;
  d.prepare("UPDATE searches SET status='running', error=NULL WHERE id=?").run(id);
  const request = db.P(s.request, {}), derived = db.P(s.derived, {});
  const modes = derived.modes || [];
  const enabled = registry.enabledMap();
  const sourcesLog = [];
  const collected = [];
  const providerIdBySlug = Object.fromEntries(d.prepare('SELECT id, slug FROM providers').all().map((p) => [p.slug, p.id]));
  // Remove previous automated results on re-run (manual quotes are kept).
  d.prepare("DELETE FROM results WHERE search_id=? AND source_key != 'manual_entry'").run(id);

  for (const a of registry.ADAPTERS) {
    if (a.kind === 'manual') continue;
    const entry = { key: a.key, name: a.name, kind: a.kind, data_class: a.dataClass, at: new Date().toISOString() };
    if (enabled[a.key] === false) { sourcesLog.push({ ...entry, outcome: 'disabled', message: 'Disabled by administrator — not searched.' }); continue; }
    if (!a.modes.some((m) => modes.includes(m))) { sourcesLog.push({ ...entry, outcome: 'not_applicable', message: 'Does not cover the requested modes.' }); continue; }
    if (!a.isConfigured()) { sourcesLog.push({ ...entry, outcome: 'not_searched_credentials_missing', message: `Not searched — requires ${a.requiredEnv.join(', ')}.` }); continue; }
    const sup = a.supports(request, derived);
    if (sup !== true) { sourcesLog.push({ ...entry, outcome: 'not_applicable', message: `Skipped: ${sup}` }); continue; }
    const extra = {};
    try {
      const pricedProviderSlugs = new Set(collected.filter((r) => r.status !== 'UNAVAILABLE_RFQ' && r.provider_slug).map((r) => `${r.provider_slug}:${r.mode}`));
      const res = await withTimeout(a.search({ request, derived, modes, pricedProviderSlugs, log: (o) => Object.assign(extra, o) }), ADAPTER_TIMEOUT_MS, a.name);
      for (const r of res) collected.push({ ...r, source_key: a.key });
      registry.recordCall(a.key, true);
      sourcesLog.push({ ...entry, outcome: res.length ? 'ok' : 'ok_no_offers', count: res.length, message: res.length ? `${res.length} result(s)` : 'Searched — no offer returned for this request.', ...extra });
    } catch (e) {
      registry.recordCall(a.key, false, e.message);
      sourcesLog.push({ ...entry, outcome: 'error', message: e.message, ...extra });
    }
  }

  const ins = d.prepare(`INSERT INTO results(search_id, org_id, provider_id, provider_name, provider_type, source_key, status, mode, service_type, scope, route, transit_min, transit_max, currency, charges, validity_from, validity_to, source_name, source_url, retrieved_at, limitations, notes, rfq, raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.tx(() => {
    for (const r of collected) ins.run(id, s.org_id, r.provider_slug ? providerIdBySlug[r.provider_slug] || null : null, r.provider_name, r.provider_type, r.source_key, r.status, r.mode, r.service_type, r.scope, db.J(r.route), r.transit_min, r.transit_max, r.currency, db.J(r.charges), r.validity_from, r.validity_to, r.source_name, r.source_url, r.retrieved_at, r.limitations, r.notes, r.rfq ? db.J(r.rfq) : null, r.raw ? db.J(r.raw) : null);
    d.prepare("UPDATE searches SET status='completed', completed_at=?, sources_log=? WHERE id=?").run(new Date().toISOString(), db.J(sourcesLog), id);
  });
}

function loadSearchRow(user, id) {
  const s = db.get().prepare('SELECT s.*, o.name AS org_name, u.name AS user_name FROM searches s JOIN organizations o ON o.id=s.org_id JOIN users u ON u.id=s.user_id WHERE s.id=?').get(Number(id));
  if (!s) throw new HttpError(404, 'Not found');
  if (user) assertOrgAccess(user, s.org_id);
  return s;
}

function hydrateResult(r, providers) {
  return { ...r, route: db.P(r.route, {}), charges: db.P(r.charges, []), rfq: db.P(r.rfq, null), raw: db.P(r.raw, null), provider: r.provider_id ? providers[r.provider_id] || null : null };
}

// Full view: search + evaluated results + recommendations, in the requested currency.
function getSearch(user, id, { currency, weights } = {}) {
  const s = loadSearchRow(user, id);
  const search = { ...s, request: db.P(s.request, {}), derived: db.P(s.derived, {}), missing: db.P(s.missing, []), advisories: db.P(s.advisories, []), sources_log: db.P(s.sources_log, []) };
  if (weights) search.request.weights = shipment.normalizeWeights(weights);
  const base = (currency || db.getSetting('base_currency', config.baseCurrency)).toUpperCase();
  const providers = Object.fromEntries(db.get().prepare('SELECT id, slug, name, provider_type, website, reliability_rating, reliability_basis FROM providers').all().map((p) => [p.id, p]));
  const rows = db.get().prepare('SELECT * FROM results WHERE search_id=? ORDER BY id').all(s.id).map((r) => hydrateResult(r, providers));
  const evaluated = rows.map((r) => ({ r, ev: compare.evaluateResult(r, search, base) }));
  const rec = compare.recommend(evaluated, search);
  const saved = new Set(db.get().prepare('SELECT result_id FROM saved_quotes WHERE search_id=?').all(s.id).map((x) => x.result_id));
  return {
    search: { id: s.id, ref: s.ref, status: s.status, org_id: s.org_id, org_name: s.org_name, user_name: s.user_name, created_at: s.created_at, completed_at: s.completed_at, error: s.error,
      request: search.request, derived: search.derived, missing: search.missing, advisories: search.advisories, sources_log: search.sources_log },
    currency: base,
    results: evaluated.map(({ r, ev }) => ({ ...r, raw: undefined, evaluation: ev, saved: saved.has(r.id) })),
    ...rec,
    summary: {
      total: rows.length, priced: evaluated.filter((x) => x.ev.priced).length, firm: evaluated.filter((x) => x.ev.firm && x.ev.priced).length,
      by_status: rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
    },
  };
}

function listSearches(user, { limit = 50, q } = {}) {
  const scope = orgScope(user);
  const where = [], args = [];
  if (scope !== null) { where.push('s.org_id=?'); args.push(scope); }
  if (q) { where.push('(s.ref LIKE ? OR s.request LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.get().prepare(`SELECT s.id, s.ref, s.status, s.org_id, o.name org_name, s.request, s.derived, s.created_at, s.completed_at,
      (SELECT COUNT(*) FROM results r WHERE r.search_id=s.id) result_count,
      (SELECT COUNT(*) FROM results r WHERE r.search_id=s.id AND r.status!='UNAVAILABLE_RFQ') priced_count
    FROM searches s JOIN organizations o ON o.id=s.org_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT ?`).all(...args, Math.min(Number(limit) || 50, 500));
  return rows.map((r) => { const req = db.P(r.request, {}), der = db.P(r.derived, {}); return { ...r, request: undefined, derived: undefined, lane: `${req.origin_country} → ${req.dest_country}`, origin_city: req.origin_city, dest_city: req.dest_city, weight_kg: der.gross_weight_kg, volume_cbm: der.volume_cbm, modes: der.modes }; });
}

function rerun(user, id) {
  const s = loadSearchRow(user, id);
  db.get().prepare("UPDATE searches SET status='queued' WHERE id=?").run(s.id);
  db.audit(user, 'search_rerun', 'search', s.id);
  enqueue(s.id);
  return { ok: true, id: s.id };
}

// Update request fields (e.g. answers to the agent's missing-info questions) and re-run.
function updateRequest(user, id, patch) {
  const s = loadSearchRow(user, id);
  const merged = { ...db.P(s.request, {}), ...patch };
  const a = shipment.analyse(merged);
  db.get().prepare("UPDATE searches SET request=?, derived=?, missing=?, advisories=?, status='queued' WHERE id=?").run(db.J(a.request), db.J(a.derived), db.J(a.missing), db.J(a.advisories), s.id);
  enqueue(s.id);
  return getSearch(user, s.id);
}

const VALID_STATUS = Object.keys(compare.STATUS);
const VALID_CATS = compare.CATEGORIES.map((c) => c[0]);

function addManualQuote(user, searchId, q) {
  const s = loadSearchRow(user, searchId);
  if (!q || !q.provider_name || !q.mode || !q.currency) throw new HttpError(400, 'provider_name, mode and currency are required');
  if (!q.source_reference) throw new HttpError(400, 'source_reference is required (e.g. "Email from FLG, 14 Nov 2026, ref Q-123")');
  const status = q.status && ['MANUAL_QUOTE', 'HISTORICAL'].includes(q.status) ? q.status : 'MANUAL_QUOTE';
  const charges = (q.charges || []).map((c) => {
    if (!VALID_CATS.includes(c.category)) throw new HttpError(400, `Invalid charge category ${c.category}`);
    const inclusion = ['amount', 'included', 'excluded', 'unknown'].includes(c.inclusion) ? c.inclusion : 'amount';
    const amount = c.amount === '' || c.amount == null ? null : Number(c.amount);
    if (inclusion === 'amount' && (amount === null || Number.isNaN(amount) || amount < 0)) throw new HttpError(400, `Charge "${c.label || c.category}" needs a valid amount`);
    return { category: c.category, label: c.label || compare.CATEGORY_LABEL[c.category], basis: c.basis || 'fixed', quantity: c.quantity ? Number(c.quantity) : undefined, amount_min: amount, amount_max: amount, currency: (c.currency || q.currency).toUpperCase(), inclusion };
  });
  if (!charges.some((c) => c.inclusion === 'amount')) throw new HttpError(400, 'At least one priced charge line is required');
  const prov = q.provider_id ? db.get().prepare('SELECT id, slug, provider_type FROM providers WHERE id=?').get(Number(q.provider_id)) : null;
  const info = db.get().prepare(`INSERT INTO results(search_id, org_id, provider_id, provider_name, provider_type, source_key, status, mode, service_type, scope, route, transit_min, transit_max, currency, charges, validity_from, validity_to, source_name, source_url, retrieved_at, limitations, notes, created_by)
    VALUES (?,?,?,?,?,'manual_entry',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.org_id, prov ? prov.id : null, q.provider_name, prov ? prov.provider_type : q.provider_type || 'forwarder', status, q.mode, q.service_type || null, q.scope || null,
    db.J({ origin: q.origin || null, destination: q.destination || null, via: q.via || null }), q.transit_min ?? null, q.transit_max ?? q.transit_min ?? null, q.currency.toUpperCase(), db.J(charges),
    q.validity_from || null, q.validity_to || null, `Manual entry — ${q.source_reference}`, q.source_url || null, q.received_at ? new Date(q.received_at).toISOString() : new Date().toISOString(), q.limitations || null, q.notes || null, user.id);
  db.audit(user, 'manual_quote_added', 'result', info.lastInsertRowid, { search: s.id });
  return getSearch(user, s.id);
}

function deleteResult(user, searchId, resultId) {
  const s = loadSearchRow(user, searchId);
  const r = db.get().prepare('SELECT * FROM results WHERE id=? AND search_id=?').get(Number(resultId), s.id);
  if (!r) throw new HttpError(404, 'Not found');
  if (r.source_key !== 'manual_entry') throw new HttpError(400, 'Only manually entered quotations can be deleted');
  db.get().prepare('DELETE FROM results WHERE id=?').run(r.id);
  db.audit(user, 'manual_quote_deleted', 'result', r.id);
  return { ok: true };
}

function resumePending() {
  for (const r of db.get().prepare("SELECT id FROM searches WHERE status IN ('queued','running')").all()) enqueue(r.id);
}

module.exports = { createSearch, getSearch, listSearches, rerun, updateRequest, addManualQuote, deleteResult, runSearch, resumePending, loadSearchRow, idle: () => running === 0 && queue.length === 0 };
