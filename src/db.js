'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('operator','client')),
  country TEXT,
  contact_email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','client_admin','client_user')),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT, ua TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  parent_group TEXT,
  website TEXT,
  hq_country TEXT,
  regions_served TEXT NOT NULL DEFAULT '[]',
  countries_served TEXT NOT NULL DEFAULT '[]',
  modes TEXT NOT NULL DEFAULT '[]',
  fcl INTEGER, lcl INTEGER, air INTEGER, sea INTEGER, express INTEGER, road INTEGER,
  main_hubs TEXT NOT NULL DEFAULT '[]',
  contact TEXT NOT NULL DEFAULT '{}',
  online_quote TEXT NOT NULL DEFAULT 'unknown',
  online_quote_url TEXT,
  api_availability TEXT NOT NULL DEFAULT 'unknown',
  api_docs_url TEXT,
  booking_platform TEXT,
  service_notes TEXT,
  oman_presence TEXT NOT NULL DEFAULT 'unverified',
  reliability_rating REAL,
  reliability_basis TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  last_verified TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS provider_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  origin_country TEXT NOT NULL,
  dest_country TEXT NOT NULL,
  mode TEXT NOT NULL,
  evidence_url TEXT,
  notes TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider_slug TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success TEXT,
  last_error TEXT,
  last_error_at TEXT,
  calls_total INTEGER NOT NULL DEFAULT 0,
  calls_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued',
  request TEXT NOT NULL,
  derived TEXT NOT NULL DEFAULT '{}',
  missing TEXT NOT NULL DEFAULT '[]',
  advisories TEXT NOT NULL DEFAULT '[]',
  sources_log TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_searches_org ON searches(org_id, created_at);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  provider_id INTEGER REFERENCES providers(id),
  provider_name TEXT NOT NULL,
  provider_type TEXT,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  service_type TEXT,
  scope TEXT,
  route TEXT NOT NULL DEFAULT '{}',
  transit_min REAL, transit_max REAL,
  currency TEXT,
  charges TEXT NOT NULL DEFAULT '[]',
  validity_from TEXT, validity_to TEXT,
  source_name TEXT, source_url TEXT,
  retrieved_at TEXT NOT NULL,
  limitations TEXT,
  notes TEXT,
  rfq TEXT,
  raw TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_results_search ON results(search_id);

CREATE TABLE IF NOT EXISTS saved_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  result_id INTEGER REFERENCES results(id) ON DELETE SET NULL,
  label TEXT, notes TEXT,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(org_id, result_id)
);

CREATE TABLE IF NOT EXISTS benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_country TEXT NOT NULL,
  dest_country TEXT NOT NULL,
  origin_point TEXT, dest_point TEXT,
  mode TEXT NOT NULL,
  service_type TEXT,
  scope TEXT,
  applies_min_kg REAL, applies_max_kg REAL,
  applies_min_cbm REAL, applies_max_cbm REAL,
  currency TEXT NOT NULL,
  charges TEXT NOT NULL,
  transit_min REAL, transit_max REAL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'MARKET_BENCHMARK',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS fx_rates (
  code TEXT PRIMARY KEY,
  per_usd REAL NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  search_id INTEGER REFERENCES searches(id) ON DELETE SET NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS share_links (
  token_hash TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER, org_id INTEGER,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_metrics (
  day TEXT NOT NULL, route TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, route)
);
`;

function open(file) {
  const dbFile = file || config.dbFile || path.join(config.dataDir, 'freightiq.db');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  return db;
}

function get() {
  if (!db) open();
  return db;
}

// JSON helpers
const J = (v) => JSON.stringify(v === undefined ? null : v);
const P = (s, d) => { if (s === null || s === undefined) return d; try { return JSON.parse(s); } catch { return d; } };

function tx(fn) {
  const d = get();
  d.exec('BEGIN');
  try { const r = fn(d); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

function audit(user, action, entity, entityId, detail) {
  try {
    get().prepare('INSERT INTO audit_log (user_id, org_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
      .run(user ? user.id : null, user ? user.org_id : null, action, entity || null, entityId != null ? String(entityId) : null, detail ? J(detail) : null);
  } catch (e) { console.error('[audit] failed', e.message); }
}

function getSetting(key, def) {
  const r = get().prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? P(r.value, def) : def;
}
function setSetting(key, value) {
  get().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, J(value));
}

module.exports = { open, get, J, P, tx, audit, getSetting, setSetting };
