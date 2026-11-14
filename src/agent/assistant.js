'use strict';
// Interactive AI freight assistant. With ANTHROPIC_API_KEY it runs a Claude tool-use loop
// over the application's own functions (search, compare, providers, landed cost) plus the
// server-side web_search tool. Without a key it falls back to a deterministic intent parser
// that still executes real searches and comparisons — it just cannot hold free-form dialogue.
const db = require('../db');
const ai = require('./anthropic');
const geo = require('../data/geo');
const searchService = require('../services/searchService');
const compare = require('../engine/compare');
const { HttpError } = require('../http');
const { orgScope } = require('../auth');

const SYSTEM = `You are FreightIQ, a freight procurement assistant for an Oman-based company and its clients.
You help users search, compare and select international air and sea freight options using the application's tools.
NON-NEGOTIABLE RULES:
- Never invent a price, transit time, route coverage or quotation. Only state numbers returned by tools (or by web_search, with the URL).
- Always state each price's status: Verified Live Quotation, Manual Quotation, Indicative Online Price, Market Benchmark, Historical Price, AI Estimate, or Price Unavailable – Request Required.
- Never present benchmarks/indicative prices as confirmed. Never claim a provider was searched unless the search log says so.
- When offers cover different scopes (e.g. door-to-door vs port-to-port), say they are not like-for-like and name the missing charges.
- If information is missing, ask only the questions needed (the search tool returns a "missing" list).
- For follow-ups, use the current search context instead of asking for details again.
- Be concise and structured (short headings, bullets, small tables). Currency: show the comparison currency and note original currency where relevant.
Oman context: Muscat has no commercial container port (use Sohar/Salalah or UAE + road). A Strait of Hormuz advisory may be active (prefer Sohar/Salalah over Jebel Ali). Oman duty is commonly 5% on CIF (some lines 0%) and 5% VAT on CIF+duty.`;

const TOOLS = [
  { name: 'get_current_search', description: 'Return the active search: request, derived chargeable metrics, missing info, advisories, source log, top results and recommendations.', input_schema: { type: 'object', properties: {} } },
  { name: 'create_search', description: 'Create and run a new freight search. Countries as ISO-2 codes. Waits for results.', input_schema: { type: 'object', properties: {
    origin_country: { type: 'string' }, origin_city: { type: 'string' }, origin_port: { type: 'string', description: 'UN/LOCODE seaport or IATA airport' }, dest_country: { type: 'string' }, dest_city: { type: 'string' }, dest_port: { type: 'string' },
    cargo_description: { type: 'string' }, cargo_category: { type: 'string' }, packages: { type: 'number' }, gross_weight_kg: { type: 'number' }, volume_cbm: { type: 'number' }, cargo_value: { type: 'number' }, cargo_value_currency: { type: 'string' },
    shipping_method: { type: 'string', enum: ['air', 'sea', 'both'] }, sea_load: { type: 'string', enum: ['fcl', 'lcl', 'auto'] }, container_type: { type: 'string' }, container_count: { type: 'number' },
    scope: { type: 'string', enum: ['door_to_door', 'port_to_port', 'airport_to_airport', 'door_to_port', 'port_to_door'] }, ready_date: { type: 'string' }, preferred_delivery_date: { type: 'string' },
    customs_required: { type: 'boolean' }, insurance_required: { type: 'boolean' }, incoterm: { type: 'string' } }, required: ['origin_country', 'dest_country'] } },
  { name: 'update_search', description: 'Change fields of the active search (e.g. answers to missing-info questions, scope, weights) and re-run it.', input_schema: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] } },
  { name: 'rerun_search', description: 'Re-check prices for the active search (runs all sources again).', input_schema: { type: 'object', properties: {} } },
  { name: 'list_results', description: 'List results of the active search, sorted and filtered.', input_schema: { type: 'object', properties: { sort: { type: 'string', enum: ['price', 'transit', 'confidence'] }, mode: { type: 'string' }, exclude_provider: { type: 'string' }, only_priced: { type: 'boolean' }, limit: { type: 'number' } } } },
  { name: 'compare_results', description: 'Side-by-side charge breakdown of specific result IDs, with coverage differences.', input_schema: { type: 'object', properties: { result_ids: { type: 'array', items: { type: 'number' } } }, required: ['result_ids'] } },
  { name: 'find_providers', description: 'Search the provider database (forwarders, carriers, integrators, platforms) by lane, mode, type or text.', input_schema: { type: 'object', properties: { origin_country: { type: 'string' }, dest_country: { type: 'string' }, mode: { type: 'string' }, provider_type: { type: 'string' }, text: { type: 'string' } } } },
  { name: 'landed_cost', description: 'Compute landed cost (CIF + duty + VAT) for a result of the active search.', input_schema: { type: 'object', properties: { result_id: { type: 'number' }, duty_rate: { type: 'number' }, vat_rate: { type: 'number' } }, required: ['result_id'] } },
  { name: 'set_weights', description: 'Change importance of price/speed/reliability for recommendations of the active search.', input_schema: { type: 'object', properties: { price: { type: 'number' }, speed: { type: 'number' }, reliability: { type: 'number' } } } },
];

async function waitForSearch(user, id, ms = 170000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = db.get().prepare('SELECT status FROM searches WHERE id=?').get(id);
    if (!s || ['completed', 'failed'].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  return searchService.getSearch(user, id);
}

function compactResult(r) {
  const e = r.evaluation;
  return { id: r.id, provider: r.provider_name, provider_type: r.provider_type, status: e.status_label, mode: r.mode, service: r.service_type, scope: r.scope,
    total: e.total, comparable: e.comparable, missing_scope: e.missing_required, excluded: e.excluded, unknown: e.unknown, transit_days: [r.transit_min, r.transit_max],
    confidence: e.confidence, source: r.source_name, source_url: r.source_url, retrieved_at: r.retrieved_at, validity_to: r.validity_to, flags: e.flags, rfq_available: !!r.rfq };
}
function compactView(v) {
  return { ref: v.search.ref, status: v.search.status, request: v.search.request, derived: { ...v.search.derived, pieces: undefined }, missing: v.search.missing, advisories: v.search.advisories.map((a) => a.title + ': ' + a.text),
    sources_log: v.search.sources_log.map((l) => `${l.name}: ${l.outcome} — ${l.message}`), currency: v.currency, summary: v.summary, recommendations: v.recommendations, notes: v.notes,
    top_priced: v.results.filter((r) => r.evaluation.priced).sort((a, b) => a.evaluation.total.mid - b.evaluation.total.mid).slice(0, 8).map(compactResult),
    rfq_providers: v.results.filter((r) => r.status === 'UNAVAILABLE_RFQ').slice(0, 15).map((r) => `${r.provider_name} (${r.mode})`) };
}

function toolFns(user, conv) {
  const active = () => { if (!conv.search_id) throw new Error('No active search yet. Create one first.'); return conv.search_id; };
  const setActive = (id) => { conv.search_id = id; db.get().prepare('UPDATE conversations SET search_id=? WHERE id=?').run(id, conv.id); };
  return {
    get_current_search: async () => compactView(searchService.getSearch(user, active())),
    create_search: async (input) => { const v = searchService.createSearch(user, input); setActive(v.search.id); return compactView(await waitForSearch(user, v.search.id)); },
    update_search: async ({ patch }) => { searchService.updateRequest(user, active(), patch || {}); return compactView(await waitForSearch(user, active())); },
    rerun_search: async () => { searchService.rerun(user, active()); return compactView(await waitForSearch(user, active())); },
    list_results: async ({ sort = 'price', mode, exclude_provider, only_priced = true, limit = 10 }) => {
      let rs = searchService.getSearch(user, active(), { weights: conv.weights }).results;
      if (only_priced) rs = rs.filter((r) => r.evaluation.priced);
      if (mode) rs = rs.filter((r) => r.mode === mode || (mode === 'sea' && r.mode.startsWith('sea')));
      if (exclude_provider) rs = rs.filter((r) => !r.provider_name.toLowerCase().includes(String(exclude_provider).toLowerCase()));
      const key = { price: (r) => (r.evaluation.total ? r.evaluation.total.mid : Infinity), transit: (r) => r.transit_max ?? Infinity, confidence: (r) => -r.evaluation.confidence }[sort] || ((r) => 0);
      return rs.sort((a, b) => key(a) - key(b)).slice(0, limit).map(compactResult);
    },
    compare_results: async ({ result_ids }) => {
      const v = searchService.getSearch(user, active());
      return v.results.filter((r) => result_ids.includes(r.id)).map((r) => ({ ...compactResult(r), lines: r.evaluation.lines.map((l) => ({ category: l.category, label: l.label, inclusion: l.inclusion, original: l.original, original_currency: l.currency, converted: l.converted })) }));
    },
    find_providers: async (q) => findProviders(q),
    landed_cost: async ({ result_id, duty_rate = 0.05, vat_rate = 0.05 }) => {
      const v = searchService.getSearch(user, active());
      const r = v.results.find((x) => x.id === result_id); if (!r || !r.evaluation.total) throw new Error('Result not found or has no price');
      if (!v.search.request.cargo_value) throw new Error('Cargo value is missing on the search — ask the user for it.');
      return compare.landedCost({ goodsValue: v.search.request.cargo_value, goodsCurrency: v.search.request.cargo_value_currency, freightTotal: r.evaluation.total.mid, freightCurrency: v.currency, dutyRate: duty_rate, vatRate: vat_rate, baseCurrency: v.currency });
    },
    set_weights: async (w) => { conv.weights = w; return compactView(searchService.getSearch(user, active(), { weights: w })).recommendations; },
  };
}

function findProviders({ origin_country, dest_country, mode, provider_type, text } = {}) {
  let rows = db.get().prepare('SELECT * FROM providers WHERE active=1').all();
  if (provider_type) rows = rows.filter((p) => p.provider_type === provider_type);
  if (mode) rows = rows.filter((p) => db.P(p.modes, []).some((m) => m === mode || (mode === 'sea' && m.startsWith('sea'))));
  if (text) { const t = text.toLowerCase(); rows = rows.filter((p) => (p.name + ' ' + (p.service_notes || '')).toLowerCase().includes(t)); }
  const countries = [origin_country, dest_country].filter(Boolean).map((c) => c.toUpperCase());
  const scoreOf = (p) => {
    const cs = db.P(p.countries_served, []);
    let s = 0;
    if (countries.some((c) => cs.includes(c))) s += 3;
    if (countries.includes('OM') && ['verified', 'reported'].includes(p.oman_presence)) s += 2;
    if (countries.includes(p.hq_country)) s += 1;
    if (db.P(p.regions_served, []).some((r) => r.startsWith('Global'))) s += 0.5;
    return s;
  };
  return rows.map((p) => ({ id: p.id, name: p.name, type: p.provider_type, website: p.website, modes: db.P(p.modes, []), oman_presence: p.oman_presence, online_quote: p.online_quote, api: p.api_availability, relevance: scoreOf(p),
    evidence: countries.length ? (scoreOf(p) >= 3 ? 'presence evidenced at origin/destination' : scoreOf(p) >= 2 ? 'Oman presence evidenced' : 'lane coverage not evidenced') : null }))
    .filter((p) => !countries.length || p.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, 25);
}

// ───────────── Conversation management ─────────────
function getConversation(user, id) {
  const c = db.get().prepare('SELECT * FROM conversations WHERE id=?').get(Number(id));
  if (!c || (orgScope(user) !== null && c.org_id !== user.org_id) || c.user_id !== user.id) throw new HttpError(404, 'Not found');
  return c;
}
function createConversation(user, searchId) {
  if (searchId) searchService.loadSearchRow(user, searchId);
  const info = db.get().prepare('INSERT INTO conversations(org_id, user_id, search_id, title) VALUES (?,?,?,?)').run(user.org_id, user.id, searchId || null, 'Freight assistant');
  return db.get().prepare('SELECT * FROM conversations WHERE id=?').get(info.lastInsertRowid);
}
function history(convId) { return db.get().prepare('SELECT role, content, meta, created_at FROM messages WHERE conversation_id=? ORDER BY id').all(convId).map((m) => ({ ...m, meta: db.P(m.meta, null) })); }
function addMessage(convId, role, content, meta) { db.get().prepare('INSERT INTO messages(conversation_id, role, content, meta) VALUES (?,?,?,?)').run(convId, role, content, meta ? db.J(meta) : null); }

async function chat(user, convId, text) {
  const conv = getConversation(user, convId);
  if (!text || !String(text).trim()) throw new HttpError(400, 'Message is empty');
  addMessage(conv.id, 'user', String(text).slice(0, 4000));
  let reply;
  try { reply = ai.isConfigured() ? await chatLLM(user, conv) : await chatFallback(user, conv, String(text)); }
  catch (e) { reply = { text: `I couldn't complete that: ${e.message}`, meta: { error: true } }; }
  const fresh = db.get().prepare('SELECT search_id FROM conversations WHERE id=?').get(conv.id);
  addMessage(conv.id, 'assistant', reply.text, { ...(reply.meta || {}), search_id: fresh.search_id });
  return { reply: reply.text, meta: reply.meta || null, search_id: fresh.search_id, mode: ai.isConfigured() ? 'llm' : 'rules' };
}

async function chatLLM(user, conv) {
  const fns = toolFns(user, conv);
  const msgs = history(conv.id).slice(-14).map((m) => ({ role: m.role, content: m.content }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const sys = SYSTEM + `\nToday: ${new Date().toISOString().slice(0, 10)}. User: ${user.name} (${user.role}, org ${user.org_name}). Active search id: ${conv.search_id || 'none'}.`;
  const tools = [...TOOLS, ai.WEB_SEARCH_TOOL(4)];
  const used = [];
  for (let step = 0; step < 8; step++) {
    const resp = await ai.createMessage({ system: sys, tools, messages: msgs, max_tokens: 3000 });
    msgs.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason === 'pause_turn') continue;
    const calls = resp.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      const sources = [...ai.searchedUrls(resp.content).values()].map((s) => s.url);
      return { text: ai.textOf(resp.content), meta: { tools: used, web_sources: sources } };
    }
    const results = [];
    for (const c of calls) {
      used.push(c.name);
      try { const out = await fns[c.name](c.input || {}); results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60000) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: `Error: ${e.message}`, is_error: true }); }
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text: 'I stopped after several tool steps without a final answer. Please narrow the question.', meta: { tools: used } };
}

// ───────────── Rule-based fallback (no LLM key) ─────────────
const CITY = { shanghai: ['CN', 'CNSHA', 'PVG'], ningbo: ['CN', 'CNNGB'], shenzhen: ['CN', 'CNYTN', 'SZX'], guangzhou: ['CN', 'CNNSA', 'CAN'], qingdao: ['CN', 'CNTAO'], beijing: ['CN', null, 'PEK'], 'hong kong': ['HK', 'HKHKG', 'HKG'],
  muscat: ['OM', null, 'MCT'], sohar: ['OM', 'OMSOH', 'OHS'], salalah: ['OM', 'OMSLL', 'SLL'], duqm: ['OM', 'OMDQM'], dubai: ['AE', 'AEJEA', 'DXB'], 'abu dhabi': ['AE', 'AEKHL', 'AUH'], sharjah: ['AE', null, 'SHJ'], 'jebel ali': ['AE', 'AEJEA'],
  mumbai: ['IN', 'INNSA', 'BOM'], 'nhava sheva': ['IN', 'INNSA'], delhi: ['IN', null, 'DEL'], chennai: ['IN', 'INMAA', 'MAA'], mundra: ['IN', 'INMUN'], singapore: ['SG', 'SGSIN', 'SIN'],
  rotterdam: ['NL', 'NLRTM', 'AMS'], hamburg: ['DE', 'DEHAM'], frankfurt: ['DE', null, 'FRA'], antwerp: ['BE', 'BEANR'], london: ['GB', 'GBFXT', 'LHR'], 'new york': ['US', 'USNYC', 'JFK'], 'los angeles': ['US', 'USLAX', 'LAX'], houston: ['US', 'USHOU', 'IAH'], jeddah: ['SA', 'SAJED', 'JED'], riyadh: ['SA', null, 'RUH'], doha: ['QA', 'QAHMD', 'DOH'] };
const ALIAS = { uae: 'AE', emirates: 'AE', usa: 'US', 'united states': 'US', america: 'US', uk: 'GB', britain: 'GB', europe: 'DE', ksa: 'SA', china: 'CN', oman: 'OM', india: 'IN' };

function placeFrom(s) {
  s = s.toLowerCase().trim();
  for (const [k, v] of Object.entries(CITY)) if (s.includes(k)) return { country: v[0], city: k.replace(/\b\w/g, (c) => c.toUpperCase()), port: v[1], airport: v[2] };
  for (const [k, v] of Object.entries(ALIAS)) if (new RegExp(`\\b${k}\\b`).test(s)) return { country: v };
  const c = geo.COUNTRIES.find((x) => s.includes(x.name.toLowerCase()));
  return c ? { country: c.iso } : null;
}

function parseShipment(text) {
  const t = text.toLowerCase();
  const out = {};
  const m = t.match(/from\s+(.+?)\s+(?:to|into|→)\s+(.+?)(?:[,.?!]|\s+(?:by|via|with|for|using|including|incl)\b|$)/);
  if (m) {
    const o = placeFrom(m[1]), d = placeFrom(m[2]);
    if (o) { out.origin_country = o.country; if (o.city) out.origin_city = o.city; }
    if (d) { out.dest_country = d.country; if (d.city) out.dest_city = d.city; }
    out._o = o; out._d = d;
  }
  const kg = t.match(/(\d[\d,.]*)\s*(kg|kgs|kilo)/); if (kg) out.gross_weight_kg = Number(kg[1].replace(/,/g, ''));
  const ton = t.match(/(\d[\d,.]*)\s*(t|ton|tons|tonnes)\b/); if (!kg && ton) out.gross_weight_kg = Number(ton[1].replace(/,/g, '')) * 1000;
  const cbm = t.match(/(\d[\d,.]*)\s*(cbm|m3|m³|cubic)/); if (cbm) out.volume_cbm = Number(cbm[1].replace(/,/g, ''));
  if (/\b(20|twenty)[\s-]?(ft|foot|feet|')|20gp|20'/.test(t)) { out.sea_load = 'fcl'; out.container_type = '20GP'; out.shipping_method = 'sea'; }
  if (/\b40[\s-]?(ft|foot|feet|hc|')|40gp|40hc/.test(t)) { out.sea_load = 'fcl'; out.container_type = /hc|high cube/.test(t) ? '40HC' : '40GP'; out.shipping_method = 'sea'; }
  if (/\blcl\b/.test(t)) { out.sea_load = 'lcl'; out.shipping_method = 'sea'; }
  if (/compare air and sea|air (and|vs|or) sea|sea (and|vs|or) air/.test(t)) out.shipping_method = 'both';
  else if (/\bby air\b|air freight|\bair\b/.test(t) && !out.shipping_method) out.shipping_method = 'air';
  else if (/\bsea\b|ocean/.test(t) && !out.shipping_method) out.shipping_method = 'sea';
  if (/door[\s-]to[\s-]door/.test(t)) out.scope = 'door_to_door';
  if (/port[\s-]to[\s-]port/.test(t)) out.scope = 'port_to_port';
  if (/destination charges|including destination|total cost/.test(t)) out.customs_required = true;
  if (out.sea_load === 'fcl' && out._o && out._o.port) out.origin_port = out._o.port;
  if (out.sea_load === 'fcl' && out._d && out._d.port) out.dest_port = out._d.port;
  if (out.dest_country === 'OM' && out.sea_load === 'fcl' && !out.dest_port) out.dest_port = 'OMSOH';
  delete out._o; delete out._d;
  return out;
}

const fmtMoney = (t) => (t ? (t.is_range ? `${t.min.toLocaleString()}–${t.max.toLocaleString()} ${t.currency}` : `${t.mid.toLocaleString()} ${t.currency}`) : 'n/a');
function renderList(rs) {
  if (!rs.length) return 'No priced options in this search yet.';
  return rs.map((r, i) => `${i + 1}. **${r.provider}** — ${r.mode.replace('_', ' ')} · ${fmtMoney(r.total)} · ${r.transit_days[0] ?? '?'}–${r.transit_days[1] ?? '?'} days · _${r.status}_${r.comparable ? '' : ' · ⚠ not like-for-like (' + (r.missing_scope.join(', ') || 'coverage') + ')'} [#${r.id}]`).join('\n');
}
function renderRecs(v) {
  const L = { cheapest: 'Cheapest', fastest: 'Fastest', best_value: 'Best value', recommended: 'Recommended' };
  const parts = Object.entries(v.recommendations || {}).map(([k, r]) => `**${L[k]}:** ${r.provider} (${r.mode.replace('_', ' ')}) — ${fmtMoney(r.total)}, ${r.transit.min ?? '?'}–${r.transit.max ?? '?'} days, _${r.status_label}_, confidence ${Math.round(r.confidence * 100)}%.\n   ${r.why}`);
  return parts.length ? parts.join('\n') : (v.notes || []).join(' ');
}

async function chatFallback(user, conv, text) {
  const fns = toolFns(user, conv);
  const t = text.toLowerCase();
  const parsed = parseShipment(text);
  const prefix = '*(Rule-based mode — full conversational AI and live web research activate when the Anthropic API key is configured.)*\n\n';

  if (/(freight )?(companies|providers|forwarders|who operates|which forwarder)/.test(t) && !/cheap|price|cost/.test(t)) {
    const q = { origin_country: parsed.origin_country, dest_country: parsed.dest_country };
    if (!q.origin_country && conv.search_id) { const s = searchService.getSearch(user, conv.search_id).search.request; q.origin_country = s.origin_country; q.dest_country = s.dest_country; }
    const ps = findProviders(q);
    return { text: prefix + `Providers in the database for ${q.origin_country || '?'} → ${q.dest_country || '?'} (lane coverage is only claimed where evidenced):\n` + ps.slice(0, 15).map((p) => `• **${p.name}** — ${p.type}, ${p.modes.join('/')}${p.evidence ? ' · ' + p.evidence : ''}`).join('\n'), meta: { type: 'providers', items: ps } };
  }
  if (parsed.origin_country && parsed.dest_country) {
    const v = await fns.create_search({ ...parsed, cargo_description: text.slice(0, 200) });
    const full = searchService.getSearch(user, conv.search_id);
    const miss = full.search.missing.filter((m) => m.severity === 'required');
    let out = `Search **${v.ref}** completed (${full.summary.priced} priced of ${full.summary.total} results).\n\n${renderRecs(full)}`;
    if (miss.length) out += `\n\n**To improve accuracy, please tell me:**\n` + miss.map((m) => `• ${m.question}`).join('\n');
    return { text: prefix + out, meta: { type: 'search', search_id: conv.search_id } };
  }
  if (!conv.search_id) return { text: prefix + 'Tell me the shipment, e.g. "Ship 500 kg, 2.5 cbm from Shanghai to Muscat by air or sea, door to door".' };

  if (/recheck|re-check|refresh|rerun|again/.test(t)) { await fns.rerun_search(); const v = searchService.getSearch(user, conv.search_id); return { text: prefix + `Rechecked all sources at ${new Date().toISOString().slice(0, 16)}Z.\n\n${renderRecs(v)}` }; }
  if (/why|explain|more expensive|difference/.test(t)) {
    const rs = (await fns.list_results({ sort: 'price', limit: 50 }));
    const ids = (t.match(/#?(\d+)/g) || []).map((x) => Number(x.replace('#', ''))).filter((id) => rs.some((r) => r.id === id));
    const pair = ids.length >= 2 ? ids.slice(0, 2) : rs.length >= 2 ? [rs[0].id, rs[rs.length - 1].id] : [];
    if (pair.length < 2) return { text: prefix + 'I need at least two priced results to explain a difference.' };
    const [a, b] = await fns.compare_results({ result_ids: pair });
    const cats = [...new Set([...a.lines, ...b.lines].map((l) => l.category))];
    const row = (x, c) => { const l = x.lines.find((y) => y.category === c); return !l ? '—' : l.inclusion !== 'amount' ? l.inclusion : l.converted ? (l.converted.min === l.converted.max ? l.converted.min : `${l.converted.min}–${l.converted.max}`) : 'unresolved'; };
    const table = `| Charge | ${a.provider} [#${a.id}] | ${b.provider} [#${b.id}] |\n|---|---|---|\n` + cats.map((c) => `| ${compare.CATEGORY_LABEL[c] || c} | ${row(a, c)} | ${row(b, c)} |`).join('\n') + `\n| **Total** | ${fmtMoney(a.total)} | ${fmtMoney(b.total)} |`;
    const notes = [];
    if (a.mode !== b.mode) notes.push(`Different modes (${a.mode} vs ${b.mode}) — mode is the main cost driver.`);
    if (a.status !== b.status) notes.push(`Different data quality: ${a.status} vs ${b.status}.`);
    if (a.missing_scope.length || b.missing_scope.length) notes.push(`Coverage differs — missing in ${a.missing_scope.length ? a.provider + ': ' + a.missing_scope.join(', ') : ''} ${b.missing_scope.length ? b.provider + ': ' + b.missing_scope.join(', ') : ''}. Totals are not like-for-like.`);
    return { text: prefix + table + '\n\n' + notes.join('\n'), meta: { type: 'compare', ids: pair } };
  }
  if (/fastest|quickest/.test(t)) return { text: prefix + renderList(await fns.list_results({ sort: 'transit', limit: 5 })) };
  if (/alternative|instead of|other than|cheaper than/.test(t)) {
    const name = (t.match(/(?:to|than|of)\s+([a-z+&.\- ]+?)(?:\s+that|\s+which|[?.!]|$)/) || [])[1];
    return { text: prefix + `Priced alternatives${name ? ' excluding "' + name.trim() + '"' : ''}:\n` + renderList(await fns.list_results({ sort: 'price', exclude_provider: name ? name.trim() : undefined, limit: 8 })) };
  }
  const top = t.match(/top\s*(\d+)/);
  if (/cheapest|lowest|compare|top|best/.test(t)) {
    const modeF = /\bair\b/.test(t) && !/sea/.test(t) ? 'air' : /\bsea\b/.test(t) && !/air/.test(t) ? 'sea' : undefined;
    const v = searchService.getSearch(user, conv.search_id);
    return { text: prefix + renderList(await fns.list_results({ sort: 'price', mode: modeF, limit: top ? Number(top[1]) : 5 })) + '\n\n' + renderRecs(v) };
  }
  if (/landed|total cost|duty|vat/.test(t)) {
    const rs = await fns.list_results({ sort: 'price', limit: 1 });
    if (!rs.length) return { text: prefix + 'No priced result to compute landed cost on.' };
    const lc = await fns.landed_cost({ result_id: rs[0].id });
    return { text: prefix + `Landed cost on **${rs[0].provider}** (#${rs[0].id}, ${rs[0].status}): goods ${lc.goods} + freight ${lc.freight} + insurance ${lc.insurance}${lc.insurance_assumed ? ' (0.4% assumed)' : ''} = CIF ${lc.cif}; duty ${lc.duty_rate * 100}% = ${lc.duty}; VAT ${lc.vat_rate * 100}% = ${lc.vat} → **${lc.landed_total} ${lc.currency}**. ${lc.vat_note} Verify the 12-digit HS duty rate.` };
  }
  const v = searchService.getSearch(user, conv.search_id);
  return { text: prefix + `Current search ${v.search.ref}: ${v.summary.priced} priced results.\n\n${renderRecs(v)}\n\nTry: "cheapest", "fastest", "compare top 5", "explain #12 vs #15", "recheck prices", "alternatives to DHL", "landed cost", or describe a new shipment.` };
}

module.exports = { chat, createConversation, getConversation, history, findProviders, parseShipment };
