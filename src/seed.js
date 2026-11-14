'use strict';
const db = require('./db');
const config = require('./config');
const auth = require('./auth');
const fx = require('./fx');
const registry = require('./integrations/registry');
const providers = require('./data/providers.seed');
const benchmarks = require('./data/benchmarks.seed');

function seedProviders() {
  const d = db.get();
  const exists = d.prepare('SELECT id FROM providers WHERE slug=?');
  const ins = d.prepare(`INSERT INTO providers(slug,name,provider_type,parent_group,website,hq_country,regions_served,countries_served,modes,fcl,lcl,air,sea,express,road,main_hubs,contact,online_quote,online_quote_url,api_availability,api_docs_url,booking_platform,service_notes,oman_presence,evidence,last_verified,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  db.tx(() => {
    for (const p of providers) {
      if (exists.get(p.slug)) continue; // never overwrite administrator edits
      const m = p.modes || [];
      ins.run(p.slug, p.name, p.provider_type, p.parent_group || null, p.website || null, p.hq_country || null, db.J(p.regions_served), db.J(p.countries_served), db.J(m),
        m.includes('sea_fcl') ? 1 : 0, m.includes('sea_lcl') ? 1 : 0, m.includes('air') ? 1 : 0, m.some((x) => x.startsWith('sea')) ? 1 : 0, m.includes('express') ? 1 : 0, m.includes('road') ? 1 : 0,
        db.J(p.main_hubs), db.J(p.contact), p.online_quote, p.online_quote_url || null, p.api_availability, p.api_docs_url || null, p.booking_platform || null, p.service_notes || null, p.oman_presence, db.J(p.evidence), p.last_verified, p.active === 0 ? 0 : 1);
      n++;
    }
  });
  return n;
}

function seedBenchmarks() {
  const d = db.get();
  if (d.prepare('SELECT COUNT(*) c FROM benchmarks').get().c) return 0;
  const ins = d.prepare(`INSERT INTO benchmarks(origin_country,dest_country,origin_point,dest_point,mode,service_type,scope,applies_min_kg,applies_max_kg,applies_min_cbm,applies_max_cbm,currency,charges,transit_min,transit_max,source_name,source_url,as_of,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.tx(() => { for (const b of benchmarks) ins.run(b.origin_country, b.dest_country, b.origin_point, b.dest_point, b.mode, b.service_type, b.scope, b.applies_min_kg ?? null, b.applies_max_kg ?? null, b.applies_min_cbm ?? null, b.applies_max_cbm ?? null, b.currency, db.J(b.charges), b.transit_min, b.transit_max, b.source_name, b.source_url || null, b.as_of, b.notes || null); });
  return benchmarks.length;
}

function ensureOperator() {
  const d = db.get();
  let org = d.prepare("SELECT * FROM organizations WHERE type='operator' ORDER BY id LIMIT 1").get();
  if (!org) { d.prepare("INSERT INTO organizations(name, type, country) VALUES (?, 'operator', 'OM')").run(db.getSetting('operator_name', 'FreightIQ Operator')); org = d.prepare("SELECT * FROM organizations WHERE type='operator' ORDER BY id LIMIT 1").get(); }
  return org;
}

function ensureAdmin(email, password, name = 'Administrator') {
  const d = db.get();
  const org = ensureOperator();
  const u = d.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) return { created: false, id: u.id };
  auth.validatePassword(password);
  const r = d.prepare("INSERT INTO users(org_id, email, name, password_hash, role) VALUES (?,?,?,?,'admin')").run(org.id, email, name, auth.hashPassword(password));
  return { created: true, id: Number(r.lastInsertRowid) };
}

function defaults() {
  const set = (k, v) => { if (db.getSetting(k, undefined) === undefined) db.setSetting(k, v); };
  set('base_currency', config.baseCurrency);
  set('hormuz_advisory_active', true);
  set('operator_is_forwarder', false);
  set('operator_name', 'FreightIQ Operator');
  set('default_weights', { price: 0.5, speed: 0.3, reliability: 0.2 });
}

function run() {
  defaults();
  ensureOperator();
  fx.seedFallback();
  registry.syncTable();
  const p = seedProviders(), b = seedBenchmarks();
  if (config.bootstrapAdminEmail && config.bootstrapAdminPassword) {
    const r = ensureAdmin(config.bootstrapAdminEmail, config.bootstrapAdminPassword);
    if (r.created) console.log(`[seed] admin user created: ${config.bootstrapAdminEmail}`);
  }
  return { providers: p, benchmarks: b };
}

module.exports = { run, ensureAdmin, ensureOperator, seedProviders, seedBenchmarks };
