'use strict';
const db = require('../db');

const manual = {
  key: 'manual_entry', name: 'Manual quotation entry', kind: 'manual', modes: ['air', 'express', 'sea_lcl', 'sea_fcl', 'road'], docsUrl: null, requiredEnv: [], dataClass: 'MANUAL_QUOTE',
  limitations: 'Quotes received by email/phone/PDF and entered by staff or clients. Source document reference is required.', isConfigured: () => true, supports: () => false, async search() { return []; },
};

const ADAPTERS = [
  require('./benchmark'),
  ...require('./carrierApis'),
  ...require('./platformApis'),
  require('./webResearch'),
  require('./rfq'), // must run last: skips providers that already have a price
  manual,
];
const byKey = Object.fromEntries(ADAPTERS.map((a) => [a.key, a]));

function syncTable() {
  const d = db.get();
  const ins = d.prepare('INSERT OR IGNORE INTO integrations(key, name, kind, provider_slug, enabled) VALUES (?,?,?,?,1)');
  for (const a of ADAPTERS) ins.run(a.key, a.name, a.kind, a.providerSlug || null);
}

function status(a, row) {
  if (row && !row.enabled) return 'disabled';
  if (!a.isConfigured()) return 'credentials_missing';
  if (row && row.last_error_at && (!row.last_success || row.last_error_at > row.last_success)) return 'error';
  if (row && row.last_success) return 'active';
  return 'ready';
}

function list() {
  const rows = Object.fromEntries(db.get().prepare('SELECT * FROM integrations').all().map((r) => [r.key, r]));
  return ADAPTERS.map((a) => {
    const row = rows[a.key] || {};
    return { key: a.key, name: a.name, kind: a.kind, provider_slug: a.providerSlug || null, modes: a.modes, docs_url: a.docsUrl, required_env: a.requiredEnv,
      env_present: a.requiredEnv.map((k) => ({ name: k, present: !!process.env[k] })), data_class: a.dataClass, limitations: a.limitations,
      enabled: row.enabled !== 0, status: status(a, row), configured: a.isConfigured(), last_success: row.last_success || null, last_error: row.last_error || null, last_error_at: row.last_error_at || null,
      calls_total: row.calls_total || 0, calls_failed: row.calls_failed || 0 };
  });
}

function enabledMap() { return Object.fromEntries(db.get().prepare('SELECT key, enabled FROM integrations').all().map((r) => [r.key, !!r.enabled])); }

function recordCall(key, ok, err) {
  const now = new Date().toISOString();
  if (ok) db.get().prepare('UPDATE integrations SET calls_total=calls_total+1, last_success=? WHERE key=?').run(now, key);
  else db.get().prepare('UPDATE integrations SET calls_total=calls_total+1, calls_failed=calls_failed+1, last_error=?, last_error_at=? WHERE key=?').run(String(err).slice(0, 500), now, key);
}

module.exports = { ADAPTERS, byKey, syncTable, list, enabledMap, recordCall };
