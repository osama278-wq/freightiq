'use strict';
// Currency service. Rates are stored as units-per-USD. Live refresh from a configurable
// provider (default: open.er-api.com, which requires the attribution shown in the UI).
// If the live source is unreachable, a labelled fallback table is used and every
// conversion carries that label so users know the rate quality.
const db = require('./db');
const config = require('./config');

// Fallback table. GCC pegs are official fixed rates; others are APPROXIMATE placeholders
// that must be refreshed from a live source before commercial use.
const FALLBACK = {
  USD: [1, 'peg'], OMR: [0.3845, 'peg'], AED: [3.6725, 'peg'], SAR: [3.75, 'peg'], QAR: [3.64, 'peg'], BHD: [0.376, 'peg'],
  KWD: [0.307, 'approx'], EUR: [0.92, 'approx'], GBP: [0.79, 'approx'], CNY: [7.2, 'approx'], INR: [84.0, 'approx'],
  SGD: [1.33, 'approx'], JPY: [150, 'approx'], CHF: [0.88, 'approx'], AUD: [1.5, 'approx'], CAD: [1.37, 'approx'], HKD: [7.8, 'approx'],
  TRY: [34, 'approx'], PKR: [280, 'approx'], KRW: [1380, 'approx'], TWD: [32, 'approx'], MYR: [4.5, 'approx'], THB: [35, 'approx'], VND: [25000, 'approx'], EGP: [49, 'approx'], ZAR: [18, 'approx'],
};
const SUPPORTED = Object.keys(FALLBACK);

function seedFallback() {
  const d = db.get();
  const n = d.prepare('SELECT COUNT(*) c FROM fx_rates').get().c;
  if (n) return;
  const ins = d.prepare('INSERT INTO fx_rates(code, per_usd, source, as_of) VALUES (?,?,?,?)');
  const now = new Date().toISOString();
  for (const [code, [rate, kind]] of Object.entries(FALLBACK)) ins.run(code, rate, kind === 'peg' ? 'fallback:official-peg' : 'fallback:approximate', now);
}

async function refresh() {
  const started = new Date().toISOString();
  try {
    const ctrl = AbortSignal.timeout(10000);
    const r = await fetch(config.fxProviderUrl, { signal: ctrl });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.result && j.result !== 'success') throw new Error(j['error-type'] || 'provider error');
    const rates = j.rates || j.conversion_rates;
    if (!rates || !rates.OMR) throw new Error('Provider response missing rates/OMR');
    const asOf = j.time_last_update_utc ? new Date(j.time_last_update_utc).toISOString() : started;
    const d = db.get();
    const up = d.prepare('INSERT INTO fx_rates(code, per_usd, source, as_of) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET per_usd=excluded.per_usd, source=excluded.source, as_of=excluded.as_of');
    db.tx(() => { for (const [code, v] of Object.entries(rates)) if (typeof v === 'number' && v > 0) up.run(code, v, `live:${new URL(config.fxProviderUrl).host}`, asOf); });
    db.setSetting('fx_last_refresh', { ok: true, at: started, asOf, source: config.fxProviderUrl });
    return { ok: true, asOf, count: Object.keys(rates).length };
  } catch (e) {
    db.setSetting('fx_last_refresh', { ok: false, at: started, error: e.message, source: config.fxProviderUrl });
    return { ok: false, error: e.message };
  }
}

function rateRow(code) {
  return db.get().prepare('SELECT * FROM fx_rates WHERE code=?').get(String(code || '').toUpperCase());
}

// Convert amount from -> to. Returns { value, rate, basis } or throws for unknown currencies.
function convert(amount, from, to) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return null;
  from = String(from || 'USD').toUpperCase(); to = String(to || 'USD').toUpperCase();
  if (from === to) return { value: Number(amount), rate: 1, basis: 'same-currency' };
  const a = rateRow(from), b = rateRow(to);
  if (!a || !b) throw new Error(`No FX rate for ${!a ? from : to}`);
  const rate = b.per_usd / a.per_usd;
  return { value: Number(amount) * rate, rate, basis: `${a.source}@${a.as_of.slice(0, 10)} / ${b.source}@${b.as_of.slice(0, 10)}` };
}

function list() { return db.get().prepare('SELECT * FROM fx_rates ORDER BY code').all(); }
function setManual(code, perUsd) {
  db.get().prepare('INSERT INTO fx_rates(code, per_usd, source, as_of) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET per_usd=excluded.per_usd, source=excluded.source, as_of=excluded.as_of')
    .run(code.toUpperCase(), Number(perUsd), 'manual:admin', new Date().toISOString());
}

let timer;
function startAutoRefresh() {
  refresh().then((r) => console.log('[fx] refresh', r.ok ? `ok (${r.count} rates, as of ${r.asOf})` : `failed: ${r.error} — using stored/fallback rates`));
  timer = setInterval(() => refresh(), config.fxRefreshHours * 3600 * 1000);
  timer.unref();
}

module.exports = { seedFallback, refresh, convert, list, setManual, startAutoRefresh, SUPPORTED };
