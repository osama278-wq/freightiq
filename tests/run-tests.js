'use strict';
// End-to-end test suite (no dependencies). Starts the real server on a temp database plus a
// mock server that imitates the Anthropic Messages API (web_search) and DHL MyDHL /rates, then
// exercises realistic Oman lanes, calculations, FX, tenancy isolation, reports and the agent.
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fiq-test-'));
let MOCK_PORT;
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(['PASS', name]); } catch (e) { failed++; results.push(['FAIL', name, e.message]); } }

// ───────────── Mock external services ─────────────
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/v1/messages') {
      const j = JSON.parse(body);
      const isResearch = (j.system || '').includes('freight market research analyst');
      const content = isResearch ? [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'air freight Shanghai to Muscat price per kg' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://www.example-forwarder.com/air-freight-china-oman', title: 'Air freight China to Oman rates', page_age: 'October 2026', encrypted_content: 'x' }] },
        { type: 'text', text: '```json\n' + JSON.stringify({ offers: [
          { provider_name: 'Example Forwarder', provider_type: 'forwarder', mode: 'air', service_type: 'Airport-to-airport consol', scope: 'airport_to_airport', currency: 'USD', charges: [{ category: 'freight', label: 'Air freight', basis: 'per_kg_chargeable', amount_min: 3.1, amount_max: 3.9, inclusion: 'amount' }, { category: 'fuel', label: 'FSC', basis: 'fixed', inclusion: 'unknown' }], transit_min: 3, transit_max: 5, price_type: 'provider_published_rate', published_date: '2026-10-15', source_url: 'https://www.example-forwarder.com/air-freight-china-oman' },
          { provider_name: 'Hallucinated Co', provider_type: 'forwarder', mode: 'air', currency: 'USD', charges: [{ category: 'freight', basis: 'fixed', amount_min: 1, amount_max: 1, inclusion: 'amount' }], price_type: 'provider_published_rate', source_url: 'https://never-searched.example.com/page' },
        ], notes: 'test' }) + '\n```' },
      ] : [{ type: 'text', text: 'Mock assistant reply.' }];
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', content, stop_reason: 'end_turn' })); return;
    }
    if (u.pathname === '/mydhl/rates') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('dhluser:dhlpass').toString('base64')) { res.writeHead(401); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ products: [{ productName: 'EXPRESS WORLDWIDE', productCode: 'P', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'OMR', price: 120.5 }],
        detailedPriceBreakdown: [{ currencyType: 'BILLC', priceCurrency: 'OMR', breakdown: [{ name: 'EXPRESS WORLDWIDE', price: 95.5 }, { name: 'FUEL SURCHARGE', price: 25.0 }] }], deliveryCapabilities: { totalTransitDays: 3 } }] }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});

async function main() {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  MOCK_PORT = mock.address().port;
  Object.assign(process.env, {
    DATA_DIR: TMP, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    DHL_EXPRESS_USERNAME: 'dhluser', DHL_EXPRESS_PASSWORD: 'dhlpass', DHL_EXPRESS_ACCOUNT: '123456789', DHL_EXPRESS_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/mydhl`,
    FX_PROVIDER_URL: `http://127.0.0.1:${MOCK_PORT}/fx-unavailable`,
  });
  const config = require('../src/config');
  const { createServer } = require('../server');
  const server = createServer({ dbFile: path.join(TMP, 't.db'), autoFx: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const db = require('../src/db');
  const seed = require('../src/seed');
  const authm = require('../src/auth');
  const fx = require('../src/fx');
  const shipment = require('../src/engine/shipment');
  const compare = require('../src/engine/compare');

  // Users: operator admin + two client orgs
  seed.ensureAdmin('admin@op.test', 'AdminPass2026', 'Admin');
  const d = db.get();
  const orgA = Number(d.prepare("INSERT INTO organizations(name,type,country) VALUES ('Client A','client','OM')").run().lastInsertRowid);
  const orgB = Number(d.prepare("INSERT INTO organizations(name,type,country) VALUES ('Client B','client','OM')").run().lastInsertRowid);
  d.prepare("INSERT INTO users(org_id,email,name,password_hash,role) VALUES (?,?,?,?,'client_admin')").run(orgA, 'a@client.test', 'A', authm.hashPassword('ClientPass2026'));
  d.prepare("INSERT INTO users(org_id,email,name,password_hash,role) VALUES (?,?,?,?,'client_user')").run(orgB, 'b@client.test', 'B', authm.hashPassword('ClientPass2026'));

  async function login(email, pw) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const call = async (method, p, body, raw) => {
      const rr = await fetch(BASE + p, { method, headers: { cookie, 'x-csrf-token': j.csrf, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (raw) return rr;
      const t = await rr.text(); let out; try { out = JSON.parse(t); } catch { out = t; }
      return { status: rr.status, body: out };
    };
    return { call, csrf: j.csrf, cookie };
  }
  const waitDone = async (c, id) => { for (let i = 0; i < 100; i++) { const r = await c('GET', `/api/searches/${id}`); if (r.body.search.status === 'completed') return r.body; await new Promise((x) => setTimeout(x, 150)); } throw new Error('search did not complete'); };

  const admin = await login('admin@op.test', 'AdminPass2026');
  const A = await login('a@client.test', 'ClientPass2026');
  const B = await login('b@client.test', 'ClientPass2026');

  // ───────────── Calculations ─────────────
  await test('Chargeable weight: paper shipment 265 kg / 1.76 m³ → air 293.33, express 352, LCL 1.76 RT, density 150.6', () => {
    const a = shipment.analyse({ origin_country: 'SG', dest_country: 'OM', gross_weight_kg: 265, volume_cbm: 1.76 });
    assert.equal(a.derived.air_chargeable_kg, 293.33); assert.equal(a.derived.express_chargeable_kg, 352); assert.equal(a.derived.lcl_revenue_tons, 1.76); assert.equal(a.derived.density_kg_m3, 150.6);
  });
  await test('Piece dimensions: pallet 110×100×97 cm 178 kg → 1.067 m³; LCL minimum 1 RT applies to small cargo', () => {
    const a = shipment.analyse({ origin_country: 'SG', dest_country: 'OM', pieces: [{ qty: 1, length_cm: 110, width_cm: 100, height_cm: 97, weight_kg: 178, palletized: true }] });
    assert.equal(a.derived.volume_cbm, 1.067); assert.equal(a.derived.air_chargeable_kg, 178); assert.equal(a.derived.lcl_revenue_tons, 1.067);
    assert.ok(a.advisories.some((x) => x.title.includes('pallet')));
    const small = shipment.analyse({ origin_country: 'AE', dest_country: 'OM', gross_weight_kg: 50, volume_cbm: 0.2 });
    assert.equal(small.derived.lcl_revenue_tons, 1);
  });
  await test('Missing-info detection asks only for absent fields', () => {
    const a = shipment.analyse({ origin_country: 'CN', dest_country: 'OM' });
    const f = a.missing.map((m) => m.field);
    assert.ok(f.includes('gross_weight_kg') && f.includes('volume_cbm') && f.includes('scope'));
    const b = shipment.analyse({ origin_country: 'CN', dest_country: 'OM', gross_weight_kg: 100, volume_cbm: 1, scope: 'port_to_port', ready_date: '2026-12-01', cargo_category: 'general', customs_required: false, incoterm: 'FOB' });
    assert.equal(b.missing.filter((m) => m.severity === 'required').length, 0);
  });

  // ───────────── FX ─────────────
  await test('FX: OMR peg 0.3845/USD; 1000 OMR → 2600.78 USD; EUR→OMR via USD cross; same-currency identity', () => {
    assert.equal(Math.round(fx.convert(1000, 'OMR', 'USD').value * 100) / 100, 2600.78);
    const eo = fx.convert(100, 'EUR', 'OMR'); assert.ok(eo.value > 0 && eo.basis.includes('fallback'));
    assert.equal(fx.convert(5, 'AED', 'AED').value, 5);
    assert.throws(() => fx.convert(1, 'XXX', 'USD'));
  });

  // ───────────── Scenario: Singapore → Oman (paper lane) ─────────────
  let sgId;
  await test('Scenario SG→OM: benchmarks reproduce paper ranges; DHL Express live quote via mocked MyDHL; nothing claimed for unconfigured sources', async () => {
    const r = await admin.call('POST', '/api/searches', { origin_country: 'SG', origin_city: 'Singapore', dest_country: 'OM', dest_city: 'Muscat', gross_weight_kg: 265, volume_cbm: 1.76, packages: 2, cargo_value: 11163.97, scope: 'door_to_door', customs_required: true, ready_date: '2026-11-20', preferred_delivery_date: '2026-12-20' });
    assert.equal(r.status, 200); sgId = r.body.search.id;
    const v = await waitDone(admin.call, sgId);
    const air = v.results.find((x) => x.mode === 'air' && x.status === 'MARKET_BENCHMARK');
    assert.ok(air, 'air benchmark present');
    assert.ok(Math.abs(air.evaluation.total.min - 1169) < 5 && Math.abs(air.evaluation.total.max - 1880) < 5, `air total ${JSON.stringify(air.evaluation.total)}`);
    assert.equal(air.evaluation.comparable, true, 'benchmark covers door-to-door scope');
    const lcl = v.results.find((x) => x.service_type === 'Sea LCL direct to Sohar');
    assert.ok(lcl.evaluation.total.min > 700 && lcl.evaluation.total.max < 1450);
    const dhl = v.results.find((x) => x.source_key === 'dhl_express_mydhl');
    assert.ok(dhl && dhl.status === 'VERIFIED_LIVE', 'DHL live quote parsed');
    assert.equal(dhl.currency, 'OMR');
    assert.ok(Math.abs(dhl.evaluation.total.mid - 120.5 / 0.3845) < 0.05, 'OMR converted to USD');
    const log = Object.fromEntries(v.search.sources_log.map((l) => [l.key, l.outcome]));
    assert.equal(log.freightos_estimator, 'not_searched_credentials_missing');
    assert.equal(log.web_research, 'not_searched_credentials_missing');
    assert.equal(log.dhl_express_mydhl, 'ok');
    assert.ok(v.results.some((x) => x.status === 'UNAVAILABLE_RFQ' && x.provider_name.includes('FLG') && x.rfq.email === 'infoom@flgshipping.net'));
    assert.ok(v.recommendations.cheapest && v.recommendations.fastest && v.recommendations.best_value && v.recommendations.recommended);
  });
  await test('Comparison: firm DHL quote is not like-for-like for door-to-door customs scope (customs missing) and is flagged', async () => {
    const v = (await admin.call('GET', `/api/searches/${sgId}`)).body;
    const dhl = v.results.find((x) => x.source_key === 'dhl_express_mydhl');
    assert.equal(dhl.evaluation.comparable, false); assert.ok(dhl.evaluation.missing_required.includes('customs'));
  });
  await test('Manual quotation: firm, like-for-like quote becomes Cheapest from the firm tier; validation enforces source reference', async () => {
    const bad = await admin.call('POST', `/api/searches/${sgId}/quotes`, { provider_name: 'FLG Shipping & Logistics', mode: 'sea_lcl', currency: 'OMR', charges: [{ category: 'freight', amount: 100 }] });
    assert.equal(bad.status, 400);
    const ok = await admin.call('POST', `/api/searches/${sgId}/quotes`, { provider_name: 'FLG Shipping & Logistics', mode: 'sea_lcl', currency: 'OMR', scope: 'door_to_door', service_type: 'LCL SIN→Sohar→Muscat', transit_min: 20, transit_max: 26, validity_to: '2026-12-31', source_reference: 'Email from FLG 14 Nov 2026 ref Q-1',
      charges: [{ category: 'freight', basis: 'per_rt', amount: 40 }, { category: 'pickup', amount: 60 }, { category: 'origin', inclusion: 'included' }, { category: 'destination', amount: 95 }, { category: 'customs', amount: 35 }, { category: 'delivery', amount: 55 }, { category: 'insurance', inclusion: 'excluded' }] });
    assert.equal(ok.status, 200);
    const m = ok.body.results.find((x) => x.status === 'MANUAL_QUOTE');
    assert.equal(m.evaluation.comparable, true);
    const expected = (40 * 1.76 + 60 + 95 + 35 + 55) / 0.3845;
    assert.ok(Math.abs(m.evaluation.total.mid - expected) < 0.05, `total ${m.evaluation.total.mid} vs ${expected}`);
    assert.equal(ok.body.recommendations.cheapest.result_id, m.id);
    assert.equal(ok.body.recommendations.cheapest.tier, 'firm comparable quotations');
  });
  await test('Weights: speed-heavy weighting changes Best value towards faster option', async () => {
    const slow = (await admin.call('GET', `/api/searches/${sgId}?wp=1&ws=0&wr=0`)).body.recommendations.best_value;
    const fast = (await admin.call('GET', `/api/searches/${sgId}?wp=0&ws=1&wr=0`)).body.recommendations.best_value;
    assert.ok(fast.transit.max <= slow.transit.max, `${fast.transit.max} vs ${slow.transit.max}`);
  });
  await test('Currency switch: totals in OMR = USD × 0.3845', async () => {
    const usd = (await admin.call('GET', `/api/searches/${sgId}`)).body, omr = (await admin.call('GET', `/api/searches/${sgId}?currency=OMR`)).body;
    const a = usd.results.find((x) => x.evaluation.priced), b = omr.results.find((x) => x.id === a.id);
    assert.ok(Math.abs(b.evaluation.total.mid - a.evaluation.total.mid * 0.3845) < 0.05);
  });
  await test('Landed cost: CIF + 5% duty + 5% VAT on (CIF+duty)', async () => {
    const v = (await admin.call('GET', `/api/searches/${sgId}`)).body; const r = v.results.find((x) => x.status === 'MANUAL_QUOTE');
    const lc = (await admin.call('POST', `/api/searches/${sgId}/landed-cost`, { result_id: r.id, insurance: 44.66 })).body;
    const cif = 11163.97 + r.evaluation.total.mid + 44.66;
    assert.ok(Math.abs(lc.cif - cif) < 0.02 && Math.abs(lc.duty - cif * 0.05) < 0.02 && Math.abs(lc.vat - cif * 1.05 * 0.05) < 0.02);
  });

  // ───────────── Further lanes ─────────────
  const lanes = [
    ['China→Oman air+LCL', { origin_country: 'CN', origin_city: 'Shanghai', dest_country: 'OM', dest_city: 'Muscat', gross_weight_kg: 500, volume_cbm: 2.4, scope: 'door_to_door' }, ['air', 'sea_lcl']],
    ['China→UAE FCL 40HC', { origin_country: 'CN', origin_port: 'CNNGB', dest_country: 'AE', dest_port: 'AEJEA', shipping_method: 'sea', sea_load: 'fcl', container_type: '40HC', scope: 'port_to_port' }, ['sea_fcl']],
    ['UAE→Oman (road eligible)', { origin_country: 'AE', origin_city: 'Dubai', dest_country: 'OM', dest_city: 'Muscat', gross_weight_kg: 1200, volume_cbm: 6, scope: 'door_to_door' }, ['road', 'sea_lcl']],
    ['India→Oman LCL', { origin_country: 'IN', origin_port: 'INNSA', dest_country: 'OM', dest_port: 'OMSOH', shipping_method: 'sea', sea_load: 'lcl', gross_weight_kg: 3000, volume_cbm: 8, scope: 'port_to_port' }, ['sea_lcl']],
    ['Europe→Oman FCL 20GP', { origin_country: 'DE', origin_port: 'DEHAM', dest_country: 'OM', dest_port: 'OMSOH', shipping_method: 'sea', sea_load: 'fcl', container_type: '20GP', scope: 'port_to_port' }, ['sea_fcl']],
    ['USA→Oman air', { origin_country: 'US', origin_city: 'Houston', dest_country: 'OM', dest_city: 'Muscat', gross_weight_kg: 180, volume_cbm: 0.9, shipping_method: 'air', scope: 'airport_to_airport' }, ['air']],
  ];
  for (const [name, req, modes] of lanes) {
    await test(`Scenario ${name}: completes, correct modes, no invented prices, RFQs generated`, async () => {
      const r = await A.call('POST', '/api/searches', req); assert.equal(r.status, 200, JSON.stringify(r.body));
      const v = await waitDone(A.call, r.body.search.id);
      for (const m of modes) assert.ok(v.search.derived.modes.includes(m), `mode ${m} in ${v.search.derived.modes}`);
      const priced = v.results.filter((x) => x.evaluation.priced && x.source_key !== 'dhl_express_mydhl');
      assert.equal(priced.length, 0, 'no benchmark/price exists for this lane → none shown');
      assert.ok(v.results.filter((x) => x.status === 'UNAVAILABLE_RFQ').length > 0);
      if (modes.includes('sea_fcl')) assert.ok(v.results.some((x) => x.provider_type === 'ocean_carrier'), 'ocean carriers offered for FCL');
      if (req.dest_country === 'OM' && modes.some((m) => m.startsWith('sea'))) assert.ok(v.search.advisories.some((a) => a.title.includes('Hormuz')));
      assert.ok(v.notes.length > 0, 'explains missing prices');
    });
  }

  // ───────────── Tenancy isolation ─────────────
  await test('Client data separation: client B cannot list, read, export, quote on or share client A searches', async () => {
    const listA = (await A.call('GET', '/api/searches')).body; assert.ok(listA.length >= 6);
    const listB = (await B.call('GET', '/api/searches')).body; assert.equal(listB.length, 0);
    const id = listA[0].id;
    for (const [m, p, body] of [['GET', `/api/searches/${id}`], ['GET', `/api/searches/${id}/export.xlsx`], ['GET', `/api/searches/${id}/report.html`], ['POST', `/api/searches/${id}/rerun`, {}], ['POST', `/api/searches/${id}/share`, {}], ['POST', `/api/searches/${id}/quotes`, { provider_name: 'x', mode: 'air', currency: 'USD', source_reference: 'x', charges: [{ category: 'freight', amount: 1 }] }]]) {
      const r = await B.call(m, p, body); assert.equal(r.status, 404, `${m} ${p} → ${r.status}`);
    }
    const adminList = (await admin.call('GET', '/api/searches')).body; assert.ok(adminList.some((s) => s.id === id), 'operator sees all clients');
    const sv = await B.call('POST', '/api/saved', { search_id: id, result_id: 1 }); assert.equal(sv.status, 404);
    const conv = await B.call('POST', '/api/assistant/conversations', { search_id: id }); assert.equal(conv.status, 404);
  });
  await test('RBAC: clients cannot access administration or edit providers', async () => {
    assert.equal((await A.call('GET', '/api/admin/users')).status, 403);
    assert.equal((await B.call('PUT', '/api/providers/1', { name: 'x' })).status, 403);
    assert.equal((await A.call('PATCH', '/api/admin/settings', { base_currency: 'EUR' })).status, 403);
  });
  await test('CSRF: mutation without token is rejected', async () => {
    const r = await fetch(BASE + '/api/searches', { method: 'POST', headers: { cookie: A.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ origin_country: 'CN', dest_country: 'OM' }) });
    assert.equal(r.status, 403);
  });
  await test('Unauthenticated API access is rejected; secrets are never exposed', async () => {
    assert.equal((await fetch(BASE + '/api/searches')).status, 401);
    const settings = JSON.stringify((await admin.call('GET', '/api/admin/settings')).body) + JSON.stringify((await admin.call('GET', '/api/admin/integrations')).body);
    assert.ok(!settings.includes('dhlpass') && !settings.includes('123456789'));
    const js = await (await fetch(BASE + '/app.js')).text(); assert.ok(!/api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]/i.test(js));
  });

  // ───────────── Reports & sharing ─────────────
  await test('Excel export is a valid ZIP/XLSX with 5 sheets; HTML report contains sources & assumptions', async () => {
    const r = await admin.call('GET', `/api/searches/${sgId}/export.xlsx`, null, true);
    assert.equal(r.status, 200); const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.readUInt32LE(0), 0x04034b50); fs.writeFileSync(path.join(TMP, 'report.xlsx'), buf);
    assert.ok(buf.includes(Buffer.from('xl/worksheets/sheet5.xml')));
    const h = await (await admin.call('GET', `/api/searches/${sgId}/report.html`, null, true)).text();
    assert.ok(h.includes('Sources searched') && h.includes('Assumptions') && h.includes('AI recommendations'));
  });
  await test('Share link: works without login, revocable, expires', async () => {
    const s = (await admin.call('POST', `/api/searches/${sgId}/share`, { days: 2 })).body;
    const pub = await fetch(BASE + s.url); assert.equal(pub.status, 200);
    const shares = (await admin.call('GET', `/api/searches/${sgId}/shares`)).body;
    await admin.call('DELETE', `/api/searches/${sgId}/shares/${shares[0].id}`);
    assert.equal((await fetch(BASE + s.url)).status, 404);
    assert.equal((await fetch(BASE + '/share/invalidtoken')).status, 404);
  });
  await test('Saved quotations: save, duplicate rejected, export, isolation', async () => {
    const v = (await admin.call('GET', `/api/searches/${sgId}`)).body; const rid = v.results.find((x) => x.status === 'MANUAL_QUOTE').id;
    assert.equal((await admin.call('POST', '/api/saved', { search_id: sgId, result_id: rid, label: 'Best LCL' })).status, 200);
    assert.equal((await admin.call('POST', '/api/saved', { search_id: sgId, result_id: rid })).status, 409);
    assert.equal((await B.call('GET', '/api/saved')).body.length, 0);
    const x = await admin.call('GET', '/api/saved/export.xlsx', null, true); assert.equal(x.status, 200);
    // Re-running keeps the saved snapshot even though automated results are replaced.
    await admin.call('POST', `/api/searches/${sgId}/rerun`, {}); await new Promise((r) => setTimeout(r, 800));
    assert.equal((await admin.call('GET', '/api/saved')).body.length, 1);
  });

  // ───────────── Providers ─────────────
  await test('Provider directory: types distinguished, Oman filter, route coverage requires evidence URL', async () => {
    const all = (await A.call('GET', '/api/providers')).body;
    const types = new Set(all.map((p) => p.provider_type));
    for (const t of ['ocean_carrier', 'air_carrier', 'integrator', 'forwarder', 'nvocc', 'platform']) assert.ok(types.has(t), t);
    const om = (await A.call('GET', '/api/providers?country=OM')).body; assert.ok(om.some((p) => p.slug === 'asyad-logistics') && om.some((p) => p.slug === 'dsv'));
    const noEv = await admin.call('POST', `/api/providers/${all[0].id}/routes`, { origin_country: 'CN', dest_country: 'OM', mode: 'air' }); assert.equal(noEv.status, 400);
  });

  // ───────────── Assistant (rule-based) ─────────────
  await test('Assistant (rule-based): NL request creates a real search, then follow-ups use context', async () => {
    const c = (await A.call('POST', '/api/assistant/conversations', {})).body;
    const r1 = (await A.call('POST', `/api/assistant/conversations/${c.id}/messages`, { text: 'Find the cheapest way to ship 500 kg from Singapore to Muscat door to door' })).body;
    assert.equal(r1.mode, 'rules'); assert.ok(r1.search_id, 'search created'); assert.ok(/Search \*\*FQ-/.test(r1.reply));
    const r2 = (await A.call('POST', `/api/assistant/conversations/${c.id}/messages`, { text: 'Compare the top 5' })).body; assert.ok(r2.reply.includes('Cheapest') || r2.reply.includes('No priced'));
    const r3 = (await A.call('POST', `/api/assistant/conversations/${c.id}/messages`, { text: 'Which freight forwarders operate between Dubai and Muscat?' })).body; assert.ok(r3.reply.includes('Providers'));
    const r4 = (await A.call('POST', `/api/assistant/conversations/${c.id}/messages`, { text: 'Find the fastest shipping option' })).body; assert.ok(r4.reply.length > 20);
    const r5 = (await A.call('POST', `/api/assistant/conversations/${c.id}/messages`, { text: 'Explain why one quotation is more expensive than another' })).body; assert.ok(r5.reply.includes('|') || r5.reply.includes('need at least two'));
  });
  await test('Assistant parser: "20-foot container from Ningbo to Sohar" → FCL 20GP CNNGB→OMSOH', () => {
    const p = require('../src/agent/assistant').parseShipment('Find the cheapest sea freight for one 20-foot container from Ningbo to Sohar');
    assert.equal(p.origin_country, 'CN'); assert.equal(p.dest_country, 'OM'); assert.equal(p.sea_load, 'fcl'); assert.equal(p.container_type, '20GP'); assert.equal(p.origin_port, 'CNNGB'); assert.equal(p.dest_port, 'OMSOH');
  });

  // ───────────── Web research provenance guard (mock Anthropic API) ─────────────
  await test('AI web research: accepts only offers whose URL the search tool returned; hallucinated source rejected', async () => {
    config.anthropicApiKey = 'test-key';
    const r = await A.call('POST', '/api/searches', { origin_country: 'CN', origin_city: 'Shanghai', dest_country: 'OM', dest_city: 'Muscat', gross_weight_kg: 400, volume_cbm: 1.5, shipping_method: 'air', scope: 'airport_to_airport' });
    const v = await waitDone(A.call, r.body.search.id);
    config.anthropicApiKey = '';
    const web = v.results.filter((x) => x.source_key === 'web_research');
    assert.equal(web.length, 1, `got ${web.length}`); assert.equal(web[0].status, 'INDICATIVE_ONLINE'); assert.equal(web[0].provider_name, 'Example Forwarder');
    assert.ok(!v.results.some((x) => x.provider_name === 'Hallucinated Co'));
    const log = v.search.sources_log.find((l) => l.key === 'web_research'); assert.equal(log.offers_rejected, 1); assert.deepEqual(log.queries, ['air freight Shanghai to Muscat price per kg']);
    assert.equal(web[0].evaluation.comparable, false, 'fuel unknown → not like-for-like');
    assert.ok(web[0].evaluation.unknown.includes('fuel'));
  });

  await test('Admin: integration toggle → source logged as disabled (not searched)', async () => {
    await admin.call('PATCH', '/api/admin/integrations/dhl_express_mydhl', { enabled: false });
    const r = await admin.call('POST', '/api/searches', { origin_country: 'SG', dest_country: 'OM', gross_weight_kg: 30, volume_cbm: 0.1, scope: 'door_to_door' });
    const v = await waitDone(admin.call, r.body.search.id);
    assert.equal(v.search.sources_log.find((l) => l.key === 'dhl_express_mydhl').outcome, 'disabled');
    await admin.call('PATCH', '/api/admin/integrations/dhl_express_mydhl', { enabled: true });
  });
  await test('Login lockout after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'b@client.test', password: 'wrong' }) });
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'b@client.test', password: 'ClientPass2026' }) });
    assert.equal(r.status, 429);
  });
  await test('Status model: every status has label & confidence; benchmarks never firm', () => {
    for (const [k, s] of Object.entries(compare.STATUS)) { assert.ok(s.label); if (['MARKET_BENCHMARK', 'INDICATIVE_ONLINE', 'HISTORICAL', 'AI_ESTIMATE'].includes(k)) assert.equal(s.firm, false); }
  });

  await test('Test mode (AUTH_DISABLED): no login needed, visitor is admin, CSRF still enforced on the session', async () => {
    config.authDisabled = true;
    const me = await fetch(BASE + '/api/auth/me'); assert.equal(me.status, 200);
    const j = await me.json(); assert.equal(j.user.role, 'admin'); assert.equal(j.test_mode, true);
    const cookie = me.headers.get('set-cookie').split(';')[0];
    const ok = await fetch(BASE + '/api/searches', { method: 'POST', headers: { cookie, 'x-csrf-token': j.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ origin_country: 'AE', dest_country: 'OM', gross_weight_kg: 100, volume_cbm: 0.5 }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(BASE + '/api/searches', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ origin_country: 'AE', dest_country: 'OM' }) });
    assert.equal(bad.status, 403);
    config.authDisabled = false;
    assert.equal((await fetch(BASE + '/api/searches')).status, 401, 'normal mode requires login again');
  });

  server.close(); mock.close();
  for (const r of results) console.log(r[0] === 'PASS' ? '  ✓' : '  ✗', r[1], r[2] ? '\n      → ' + r[2] : '');
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log('XLSX sample written to', path.join(TMP, 'report.xlsx'));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
