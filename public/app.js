'use strict';
/* FreightIQ single-page app — vanilla JS, no build step. All data comes from the
   authenticated JSON API; no secrets ever live in this file. */
(() => {
const S = { user: null, csrf: null, ref: null, ai: false, test: false, upload: '', timers: [] };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MODE = { air: 'Air freight', express: 'Express', sea_lcl: 'Sea LCL', sea_fcl: 'Sea FCL', road: 'Road' };
const TYPE = { ocean_carrier: 'Ocean carrier', air_carrier: 'Air carrier', integrator: 'Express integrator', forwarder: 'Freight forwarder', nvocc: 'NVOCC / consolidator', broker: 'Broker', platform: 'Freight platform', benchmark: 'Benchmark', publisher: 'Publisher' };
const SCOPE = { door_to_door: 'Door-to-door', port_to_port: 'Port-to-port', airport_to_airport: 'Airport-to-airport', door_to_port: 'Door-to-port', port_to_door: 'Port-to-door' };
const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (t) => (!t ? '—' : t.is_range ? `${fmt(t.min)}–${fmt(t.max)}` : fmt(t.mid));
const dt = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '—');
const isOp = () => S.user && ['admin', 'staff'].includes(S.user.role);
const isAdmin = () => S.user && S.user.role === 'admin';
const statusBadge = (st, label) => `<span class="badge st-${esc(st)}">${esc(label || (S.ref && (S.ref.statuses.find((x) => x.key === st) || {}).label) || st)}</span>`;
const cname = (iso) => { const c = S.ref && S.ref.countries.find((x) => x.iso === iso); return c ? c.name : iso || '—'; };

async function api(method, path, body) {
  const opt = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (method !== 'GET' && S.csrf) opt.headers['X-CSRF-Token'] = S.csrf;
  const r = await fetch(path, opt);
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.includes('/auth/')) { S.user = null; location.hash = '#/login'; throw new Error('Session expired'); }
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.details = j.details; throw e; }
  return j;
}
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toast-root').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3500); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
function modal(title, html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal"><div class="hd"><h2>${esc(title)}</h2><button class="ghost sm right" data-close>✕</button></div>${html}</div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-close]').onclick = close;
  root.querySelector('.modal-bg').onclick = (e) => { if (e.target.classList.contains('modal-bg')) close(); };
  if (onMount) onMount(root.querySelector('.modal'), close);
  return close;
}
function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }

// Minimal safe markdown for assistant messages (escape first, then format).
function md(src) {
  const lines = esc(src).split('\n'); const out = []; let i = 0;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/(^|\s)_([^_\n]+?)_(?=\s|$|[.,;:)])/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:-|]+\|\s*$/.test(r));
      out.push('<table>' + body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') + '</table>'); continue;
    }
    if (/^\s*([-•*]|\d+\.)\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*([-•*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-•*]|\d+\.)\s+/, '')); out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>'); continue; }
    if (/^#{1,4}\s/.test(l)) { out.push(`<p><b>${inline(l.replace(/^#+\s/, ''))}</b></p>`); i++; continue; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : ''); i++;
  }
  return out.join('');
}

// ───────────── Layout & routing ─────────────
const NAV = [
  ['dashboard', '▦', 'Dashboard'], ['search/new', '＋', 'New Shipping Search'], ['searches', '☰', 'Search Results'], ['assistant', '✦', 'AI Freight Assistant'],
  ['providers', '⌂', 'Shipping Companies'], ['saved', '★', 'Saved Quotations'], ['upload', '⇪', 'Upload Documents', () => !!S.upload], ['reports', '⎙', 'Reports'], ['admin', '⚙', 'Administration', isOp], ['account', '☺', 'Account'],
];
function layout(active, inner) {
  return `<div class="layout"><aside class="side"><div class="brand"><svg width="28" height="28" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#fff"/><path d="M14 40h36l-6 8H20z" fill="#1f9e94"/><path d="M22 20h8v14h-8zM32 14h8v20h-8z" fill="#0f3d5e"/></svg><div>FreightIQ<small>Freight price intelligence</small></div></div>
  <nav class="nav">${NAV.filter((n) => !n[3] || n[3]()).map(([h, ic, l]) => `<a href="#/${h}" class="${active === h.split('/')[0] ? 'on' : ''}"><span class="ic">${ic}</span>${l}</a>`).join('')}</nav>
  <div class="who"><b>${esc(S.user.name)}</b>${esc(S.user.org_name)}<br>${esc(S.user.role.replace('_', ' '))}${S.test ? '<br><span class="badge" style="background:#ffd27a;color:#5a3a00;margin-top:6px">TEST MODE</span>' : '<br><button class="link" id="logout" style="color:#9fc0d6;margin-top:6px">Sign out</button>'}</div></aside><main class="main">${S.test ? '<div class="alert warn small"><b>Test mode — no login required.</b> Anyone with this link has full administrator access. Do not enter real client data.</div>' : ''}<div id="main">${inner || ''}</div></main></div>`;
}
function mount(active, inner) {
  $('#app').innerHTML = layout(active, inner);
  if ($('#logout')) $('#logout').onclick = guard(async () => { await api('POST', '/api/auth/logout'); S.user = null; location.hash = '#/login'; });
}
const ROUTES = [];
const route = (re, fn) => ROUTES.push([re, fn]);
async function router() {
  clearTimers();
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  if (!S.user && h !== 'login') { try { const me = await api('GET', '/api/auth/me'); S.user = me.user; S.csrf = me.csrf; S.ai = me.ai_enabled; S.test = !!me.test_mode; S.upload = me.upload_url || ''; } catch { location.hash = '#/login'; return; } }
  if (S.user && !S.ref) S.ref = await api('GET', '/api/reference');
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { try { await fn(...m.slice(1)); } catch (e) { toast(e.message, true); } return; } }
  location.hash = '#/dashboard';
}
window.addEventListener('hashchange', router);

// ───────────── Login ─────────────
route(/^login$/, async () => {
  try { const m = await (await fetch('/api/mode')).json(); if (m.test_mode) { location.hash = '#/dashboard'; return; } } catch { /* normal login */ }
  $('#app').innerHTML = `<div class="login"><form class="card" id="lf"><div class="brand" style="color:var(--acc);padding:0 0 14px"><svg width="34" height="34" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f3d5e"/><path d="M14 40h36l-6 8H20z" fill="#5fd0c7"/><path d="M22 20h8v14h-8zM32 14h8v20h-8z" fill="#fff"/></svg><div>FreightIQ<small style="color:var(--mut)">Air & sea freight price intelligence</small></div></div>
  <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
  <button style="width:100%;justify-content:center">Sign in</button><p class="small muted">Accounts are created by your administrator.</p></form></div>`;
  $('#lf').onsubmit = guard(async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const r = await api('POST', '/api/auth/login', { email: f.get('email'), password: f.get('password') });
    S.csrf = r.csrf; S.user = null; location.hash = '#/dashboard';
  });
});

// ───────────── Dashboard ─────────────
route(/^dashboard$/, async () => {
  mount('dashboard', '<div class="spin"></div>');
  const d = await api('GET', '/api/dashboard');
  const t = d.totals;
  $('#main').innerHTML = `<div class="top"><div><h1>Dashboard</h1><div class="sub">${esc(S.user.org_name)} · ${isOp() ? 'all clients' : 'your organisation'}</div></div><div class="row">${S.upload ? '<a class="btn ghost" href="#/upload">⇪ Upload documents</a>' : ''}<a class="btn" href="#/search/new">＋ New shipping search</a></div></div>
  <div class="grid g4">${[['Total searches', t.searches], ['Searches (30 days)', t.searches_30d], ['Saved quotations', t.saved_quotes], ['Firm quotes on file', t.firm_quotes]].map(([l, v]) => `<div class="card kpi"><div class="v">${fmt(v)}</div><div class="l">${l}</div></div>`).join('')}</div>
  <div class="grid g2"><div class="card"><h2>Recent shipping searches</h2>${searchTable(d.recent)}</div>
  <div class="card"><h2>Best available prices</h2>${d.best.length ? `<table><tr><th>Lane</th><th>Provider · mode</th><th class="num">Total</th><th>Status</th></tr>${d.best.map((b) => `<tr class="click" data-go="#/search/${b.search_id}"><td>${esc(b.lane)}<div class="small muted">${esc(b.ref)}</div></td><td>${esc(b.provider)}<div class="small muted">${esc(MODE[b.mode])} · ${b.transit.min ?? '?'}–${b.transit.max ?? '?'} d</div></td><td class="num">${money(b.total)} ${esc(b.total.currency)}</td><td>${esc(b.status_label)}</td></tr>`).join('')}</table>` : '<p class="muted">No priced searches yet.</p>'}</div></div>
  <div class="grid g3"><div class="card"><h2>Shipping market insights</h2>${d.insights.map((i) => `<div class="alert ${i.level}">${esc(i.text)}</div>`).join('')}</div>
  <div class="card"><h2>Price data quality</h2>${d.status_mix.length ? d.status_mix.map((s) => `<div class="row" style="margin-bottom:6px">${statusBadge(s.status)}<span class="right">${fmt(s.c)}</span></div>`).join('') : '<p class="muted">No results yet.</p>'}
  <h3 style="margin-top:14px">Top lanes</h3>${d.lanes.map((l) => `<div class="row small"><span>${esc(l.lane)}</span><span class="right">${l.c}</span></div>`).join('') || '<p class="muted small">—</p>'}</div>
  <div class="card"><h2>Recent activity</h2>${d.activity.map((a) => `<div class="small" style="margin-bottom:6px"><b>${esc(a.name || 'system')}</b> ${esc(a.action.replace(/_/g, ' '))} <span class="muted">${dt(a.at)}</span></div>`).join('') || '<p class="muted">—</p>'}</div></div>`;
  bindGo();
});
function bindGo(root = document) { $$('[data-go]', root).forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; }); }
function searchTable(rows) {
  if (!rows.length) return '<p class="muted">No searches yet. <a href="#/search/new">Start one</a>.</p>';
  return `<table><tr><th>Reference</th><th>Lane</th><th>Cargo</th><th>Results</th><th>Status</th>${isOp() ? '<th>Client</th>' : ''}<th>Created</th></tr>${rows.map((s) => `<tr class="click" data-go="#/search/${s.id}"><td class="mono">${esc(s.ref)}</td><td>${esc(s.lane)}<div class="small muted">${esc([s.origin_city, s.dest_city].filter(Boolean).join(' → '))}</div></td><td class="small">${fmt(s.weight_kg)} kg · ${fmt(s.volume_cbm, 2)} m³<div class="muted">${esc((s.modes || []).map((m) => MODE[m]).join(', '))}</div></td><td>${s.priced_count} priced / ${s.result_count}</td><td>${s.status === 'completed' ? '✓' : '<span class="spin"></span>'} ${esc(s.status)}</td>${isOp() ? `<td class="small">${esc(s.org_name)}</td>` : ''}<td class="small">${dt(s.created_at)}</td></tr>`).join('')}</table>`;
}

// ───────────── New search ─────────────
route(/^search\/new$/, async () => {
  mount('search', '');
  const R = S.ref;
  const opts = (arr, sel) => arr.map((x) => `<option value="${esc(x[0])}" ${x[0] === sel ? 'selected' : ''}>${esc(x[1])}</option>`).join('');
  const countryOpts = '<option value="">— select —</option>' + R.countries.map((c) => `<option value="${c.iso}">${esc(c.name)}</option>`).join('');
  const orgs = isOp() ? await api('GET', '/api/admin/orgs') : [];
  $('#main').innerHTML = `<div class="top"><div><h1>New shipping search</h1><div class="sub">Optional fields can be left empty — the agent tells you exactly what is missing.</div></div></div>
  <form id="sf"><div class="grid g2"><div class="card"><h2>Origin</h2><div class="grid g2">
    <div class="field"><label>Country *</label><select name="origin_country" required>${countryOpts}</select></div><div class="field"><label>City <span class="opt">(optional)</span></label><input name="origin_city"></div></div>
    <div class="field"><label>Origin seaport / airport <span class="opt">(UN/LOCODE or IATA, if known)</span></label><input name="origin_port" list="ports"></div></div>
  <div class="card"><h2>Destination</h2><div class="grid g2">
    <div class="field"><label>Country *</label><select name="dest_country" required>${countryOpts}</select></div><div class="field"><label>City <span class="opt">(optional)</span></label><input name="dest_city"></div></div>
    <div class="field"><label>Destination seaport / airport <span class="opt">(if known)</span></label><input name="dest_port" list="ports"></div></div></div>
  <datalist id="ports">${R.seaports.map((p) => `<option value="${p.code}">${esc(p.name)} (${p.country}) – seaport${p.insideGulf ? ' – inside Hormuz' : ''}</option>`).join('')}${R.airports.map((p) => `<option value="${p.code}">${esc(p.name)} (${p.country}) – airport</option>`).join('')}</datalist>
  <div class="card"><h2>Shipment details</h2><div class="grid g4">
    <div class="field" style="grid-column:span 2"><label>Cargo description</label><input name="cargo_description" placeholder="e.g. Pneumatic valves and fittings on 2 pallets"></div>
    <div class="field"><label>Cargo category</label><select name="cargo_category">${opts([['', '— select —'], ['general', 'General cargo'], ['dangerous_goods', 'Dangerous goods'], ['perishable', 'Perishable'], ['temperature_controlled', 'Temperature-controlled'], ['oversized', 'Oversized / project'], ['high_value', 'High value'], ['personal_effects', 'Personal effects']])}</select></div>
    <div class="field"><label>Number of packages</label><input name="packages" type="number" min="0"></div>
    <div class="field"><label>Total gross weight (kg)</label><input name="gross_weight_kg" type="number" step="any" min="0"></div>
    <div class="field"><label>Total volume (CBM) <span class="opt">or dimensions below</span></label><input name="volume_cbm" type="number" step="any" min="0"></div>
    <div class="field"><label>Cargo value</label><div class="row"><input name="cargo_value" type="number" step="any" min="0" style="flex:2"><select name="cargo_value_currency" style="flex:1">${R.currencies.map((c) => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    <div class="field"><label>Cargo readiness date</label><input name="ready_date" type="date"></div>
    <div class="field"><label>Preferred delivery date <span class="opt">(optional)</span></label><input name="preferred_delivery_date" type="date"></div></div>
    <details><summary>Piece dimensions (L × W × H cm) — improves chargeable-weight accuracy</summary><table id="pieces"><tr><th>Qty</th><th>Length cm</th><th>Width cm</th><th>Height cm</th><th>Weight kg / piece</th><th>Palletised</th><th></th></tr></table><button type="button" class="ghost sm" id="addPiece">＋ Add piece line</button></details></div>
  <div class="card"><h2>Shipping requirements</h2><div class="grid g4">
    <div class="field"><label>Preferred method</label><select name="shipping_method">${opts([['both', 'Air and sea (compare)'], ['air', 'Air only'], ['sea', 'Sea only']], 'both')}</select></div>
    <div class="field"><label>Sea load</label><select name="sea_load">${opts([['auto', 'Let the agent decide'], ['lcl', 'LCL'], ['fcl', 'FCL']], 'auto')}</select></div>
    <div class="field"><label>Container size</label><select name="container_type"><option value="">—</option>${R.containers.map((c) => `<option>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Containers</label><input name="container_count" type="number" min="1" placeholder="1"></div>
    <div class="field"><label>Service scope</label><select name="scope">${opts([['', '— select —'], ['door_to_door', 'Door-to-door'], ['port_to_port', 'Port-to-port'], ['airport_to_airport', 'Airport-to-airport'], ['door_to_port', 'Door-to-port'], ['port_to_door', 'Port-to-door']])}</select></div>
    <div class="field"><label>Max transit time (days)</label><input name="max_transit_days" type="number" min="1"></div>
    <div class="field"><label>Service level</label><select name="service_level">${opts([['any', 'Any'], ['economy', 'Economy'], ['standard', 'Standard'], ['express', 'Express']], 'any')}</select></div>
    <div class="field"><label>Incoterm</label><select name="incoterm"><option value="">— unknown —</option>${R.incoterms.map((i) => `<option>${i}</option>`).join('')}</select></div>
    <div class="field"><label>Insurance required</label><select name="insurance_required">${opts([['no', 'No'], ['yes', 'Yes']], 'no')}</select></div>
    <div class="field"><label>Customs clearance required</label><select name="customs_required">${opts([['', 'Not sure'], ['yes', 'Yes'], ['no', 'No']])}</select></div>
    <div class="field"><label>Dangerous goods</label><select name="dangerous_goods">${opts([['no', 'No'], ['yes', 'Yes']], 'no')}</select></div>
    ${isOp() ? `<div class="field"><label>Search on behalf of client</label><select name="org_id"><option value="">${esc(S.user.org_name)} (own)</option>${orgs.filter((o) => o.type === 'client').map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>` : ''}</div>
    <h3>Ranking priorities</h3><div class="grid g3">${['price', 'speed', 'reliability'].map((k, i) => `<div class="slider"><label style="width:80px;margin:0">${k[0].toUpperCase() + k.slice(1)}</label><input type="range" min="0" max="100" value="${[50, 30, 20][i]}" name="w_${k}"><span id="wv_${k}">${[50, 30, 20][i]}</span></div>`).join('')}</div></div>
  <div class="card" id="preview"><h2>Pre-search analysis</h2><p class="muted small">Fill in the form — chargeable weight, missing information and lane advisories appear here.</p></div>
  <div class="row"><button id="go">Search best shipping prices</button><span class="muted small">Searches every configured source; sources without credentials are listed as “not searched”.</span></div></form>`;
  const pieceRow = () => `<tr><td><input data-p="qty" type="number" min="1" value="1" style="width:70px"></td><td><input data-p="length_cm" type="number" step="any"></td><td><input data-p="width_cm" type="number" step="any"></td><td><input data-p="height_cm" type="number" step="any"></td><td><input data-p="weight_kg" type="number" step="any"></td><td><input data-p="palletized" type="checkbox" style="width:auto"></td><td><button type="button" class="ghost sm" data-rm>✕</button></td></tr>`;
  $('#addPiece').onclick = () => { $('#pieces').insertAdjacentHTML('beforeend', pieceRow()); bindPieces(); preview(); };
  const bindPieces = () => { $$('#pieces [data-rm]').forEach((b) => { b.onclick = () => { b.closest('tr').remove(); preview(); }; }); $$('#pieces input').forEach((i) => { i.oninput = preview; }); };
  const collect = () => {
    const f = new FormData($('#sf')); const o = {};
    for (const [k, v] of f.entries()) if (v !== '' && !k.startsWith('w_')) o[k] = v;
    o.pieces = $$('#pieces tr').slice(1).map((tr) => Object.fromEntries($$('input', tr).map((i) => [i.dataset.p, i.type === 'checkbox' ? i.checked : i.value]))).filter((p) => p.length_cm || p.weight_kg);
    o.weights = { price: +f.get('w_price'), speed: +f.get('w_speed'), reliability: +f.get('w_reliability') };
    if (o.origin_port) o.origin_port = o.origin_port.toUpperCase(); if (o.dest_port) o.dest_port = o.dest_port.toUpperCase();
    return o;
  };
  let pt;
  const preview = () => { clearTimeout(pt); pt = setTimeout(guard(async () => {
    if (!$('#sf')) return;
    const o = collect(); if (!o.origin_country && !o.dest_country) return;
    const a = await api('POST', '/api/searches/analyse', o); const d = a.derived;
    $('#preview').innerHTML = `<h2>Pre-search analysis</h2><div class="grid g6">${[['Volume', fmt(d.volume_cbm, 3) + ' m³'], ['Gross', fmt(d.gross_weight_kg, 1) + ' kg'], ['Air chargeable', fmt(d.air_chargeable_kg, 1) + ' kg'], ['Express chargeable', fmt(d.express_chargeable_kg, 1) + ' kg'], ['LCL revenue tons', fmt(d.lcl_revenue_tons, 2)], ['Density', fmt(d.density_kg_m3, 1) + ' kg/m³']].map(([l, v]) => `<div><div class="small muted">${l}</div><b>${v}</b></div>`).join('')}</div>
    <p class="small">Modes to evaluate: ${d.modes.map((m) => `<span class="pill">${MODE[m]}</span>`).join('')} ${d.suggested_container ? ` · Suggested container if FCL: <b>${d.suggested_container}</b>` : ''}</p>
    ${a.missing.length ? `<h3>Information the agent still needs</h3>${a.missing.map((m) => `<div class="alert ${m.severity === 'required' ? 'warn' : 'info'} small"><b>${m.severity === 'required' ? 'Required' : 'Recommended'}:</b> ${esc(m.question)}</div>`).join('')}` : '<div class="alert ok small">All key information provided.</div>'}
    ${a.advisories.length ? `<details><summary>${a.advisories.length} lane advisories</summary>${a.advisories.map((x) => `<div class="alert ${x.level} small"><b>${esc(x.title)}.</b> ${esc(x.text)}</div>`).join('')}</details>` : ''}`;
  }), 350); };
  $$('#sf input, #sf select').forEach((el) => { el.addEventListener('input', preview); el.addEventListener('change', preview); });
  ['price', 'speed', 'reliability'].forEach((k) => { $(`[name=w_${k}]`).oninput = (e) => { $(`#wv_${k}`).textContent = e.target.value; }; });
  $('#sf').onsubmit = guard(async (e) => {
    e.preventDefault(); const o = collect(); const orgId = o.org_id; delete o.org_id;
    $('#go').disabled = true; $('#go').innerHTML = '<span class="spin"></span> Searching…';
    try { const v = await api('POST', '/api/searches', { request: o, org_id: orgId }); location.hash = `#/search/${v.search.id}`; } finally { $('#go').disabled = false; $('#go').textContent = 'Search best shipping prices'; }
  });
});

// ───────────── Search list ─────────────
route(/^searches$/, async () => {
  mount('searches', '');
  const rows = await api('GET', '/api/searches?limit=200');
  $('#main').innerHTML = `<div class="top"><h1>Search results</h1><div class="row"><input id="q" placeholder="Filter by reference, city, cargo…" style="width:280px"><a class="btn" href="#/search/new">＋ New search</a></div></div><div class="card" id="lst">${searchTable(rows)}</div>`;
  bindGo();
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(guard(async () => { $('#lst').innerHTML = searchTable(await api('GET', '/api/searches?limit=200&q=' + encodeURIComponent(e.target.value))); bindGo(); }), 300); };
});

// ───────────── Search detail (comparison) ─────────────
const VS = { currency: null, weights: null, filters: { mode: '', status: '', q: '', priced: true, comparable: false, valid: false }, sort: 'price', open: new Set() };
route(/^search\/(\d+)$/, async (id) => {
  mount('searches', '<div class="spin"></div> Loading…');
  VS.open = new Set();
  await renderSearch(id);
});
async function renderSearch(id) {
  const q = new URLSearchParams();
  if (VS.currency) q.set('currency', VS.currency);
  if (VS.weights) { q.set('wp', VS.weights.price); q.set('ws', VS.weights.speed); q.set('wr', VS.weights.reliability); }
  const v = await api('GET', `/api/searches/${id}?${q}`);
  const s = v.search, r = s.request, d = s.derived;
  const w = VS.weights || r.weights;
  const running = s.status !== 'completed' && s.status !== 'failed';
  const REC = [['recommended', 'Recommended'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest'], ['best_value', 'Best value']];
  $('#main').innerHTML = `<div class="top"><div><h1>${esc(cname(r.origin_country))} → ${esc(cname(r.dest_country))} <span class="mono muted" style="font-size:13px">${esc(s.ref)}</span></h1>
    <div class="sub">${esc([r.origin_city, r.origin_port].filter(Boolean).join(' ')) || '—'} → ${esc([r.dest_city, r.dest_port].filter(Boolean).join(' ')) || '—'} · ${fmt(d.gross_weight_kg, 1)} kg · ${fmt(d.volume_cbm, 3)} m³ · ${esc(SCOPE[r.scope] || 'scope not set')} · ${isOp() ? esc(s.org_name) + ' · ' : ''}searched ${dt(s.created_at)} UTC ${running ? '<span class="spin"></span> searching…' : '· completed ' + dt(s.completed_at)}</div></div>
    <div class="row"><select id="cur" title="Comparison currency">${S.ref.currencies.map((c) => `<option ${c === v.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <button class="ghost" id="rerun">↻ Recheck prices</button><button class="ghost" id="addq">＋ Manual quote</button><button class="ghost" id="ask">✦ Ask assistant</button>
    <a class="btn ghost" href="/api/searches/${s.id}/export.xlsx?currency=${v.currency}">Excel</a><a class="btn ghost" target="_blank" href="/api/searches/${s.id}/report.html?currency=${v.currency}">PDF report</a><button class="ghost" id="share">Share</button></div></div>
  ${s.missing.length ? `<div class="card"><h2>The agent needs a few details for an accurate search</h2><div class="grid g2">${s.missing.map((m) => `<div class="field"><label>${m.severity === 'required' ? '<span style="color:var(--err)">Required</span>' : 'Recommended'} — ${esc(m.question)}</label>${missingInput(m)}</div>`).join('')}</div><button id="answer">Update & re-run search</button></div>` : ''}
  <div class="grid g4">${REC.map(([k, label]) => recCard(k, label, v.recommendations[k])).join('')}</div>
  ${v.notes.map((n) => `<div class="alert warn">${esc(n)}</div>`).join('')}
  <div class="card"><div class="row"><h2 style="margin:0">Ranking priorities</h2><span class="muted small">Re-weights Best value & Recommended instantly</span></div><div class="grid g3" style="margin-top:8px">${['price', 'speed', 'reliability'].map((k) => `<div class="slider"><label style="width:80px;margin:0">${k[0].toUpperCase() + k.slice(1)}</label><input type="range" min="0" max="100" value="${Math.round(w[k] * 100)}" data-w="${k}"><span>${Math.round(w[k] * 100)}%</span></div>`).join('')}</div></div>
  <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Comparison</h2><span class="muted small">${v.summary.priced} priced · ${v.summary.firm} firm · ${v.summary.total - v.summary.priced} require a quotation request · all prices in ${v.currency} (original currency preserved per line)</span></div>
   <div class="row" style="margin-bottom:10px"><select id="f_mode"><option value="">All methods</option>${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${VS.filters.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
   <select id="f_status"><option value="">All statuses</option>${S.ref.statuses.map((x) => `<option value="${x.key}" ${VS.filters.status === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
   <input id="f_q" placeholder="Provider, route, service…" value="${esc(VS.filters.q)}" style="width:200px">
   <label class="row small" style="margin:0"><input type="checkbox" id="f_priced" ${VS.filters.priced ? 'checked' : ''} style="width:auto"> Priced only</label>
   <label class="row small" style="margin:0"><input type="checkbox" id="f_comp" ${VS.filters.comparable ? 'checked' : ''} style="width:auto"> Like-for-like only</label>
   <label class="row small" style="margin:0"><input type="checkbox" id="f_valid" ${VS.filters.valid ? 'checked' : ''} style="width:auto"> Valid only</label>
   <select id="sort" class="right"><option value="price">Sort: lowest price</option><option value="transit">Sort: fastest transit</option><option value="confidence">Sort: highest confidence</option><option value="provider">Sort: provider</option><option value="validity">Sort: validity</option></select></div>
   <div class="tbl-wrap" id="tbl"></div></div>
  <div class="grid g2"><div class="card"><h2>Sources searched</h2><table>${s.sources_log.map((l) => `<tr><td>${esc(l.name)}<div class="small muted">${esc(l.data_class || '')}</div></td><td><span class="badge ${l.outcome === 'ok' ? 'st-VERIFIED_LIVE' : l.outcome === 'error' ? 'st-AI_ESTIMATE' : ''}">${esc(l.outcome.replace(/_/g, ' '))}</span></td><td class="small">${esc(l.message)}${l.queries ? `<div class="muted">Queries: ${esc(l.queries.join(' | '))}</div>` : ''}<div class="muted">${dt(l.at)} UTC</div></td></tr>`).join('') || '<tr><td class="muted">Search is still running…</td></tr>'}</table></div>
  <div class="card"><h2>Chargeable metrics & advisories</h2><div class="grid g3 small">${[['Air chargeable (÷6000)', fmt(d.air_chargeable_kg, 1) + ' kg'], ['Express chargeable (÷5000)', fmt(d.express_chargeable_kg, 1) + ' kg'], ['LCL revenue tons', fmt(d.lcl_revenue_tons, 2) + ' RT'], ['Density', fmt(d.density_kg_m3, 1) + ' kg/m³'], ['Value / kg', fmt(d.value_per_kg, 2)], ['Suggested container', d.suggested_container || '—']].map(([l, x]) => `<div><div class="muted">${l}</div><b>${x}</b></div>`).join('')}</div><div style="margin-top:10px">${s.advisories.map((a) => `<div class="alert ${a.level} small"><b>${esc(a.title)}.</b> ${esc(a.text)} ${a.source ? (a.source.startsWith('http') ? `<a href="${esc(a.source)}" target="_blank" rel="noopener">source</a>` : `<span class="muted">[${esc(a.source)}]</span>`) : ''}</div>`).join('')}</div></div></div>`;

  const drawTable = () => {
    const f = VS.filters; const now = new Date();
    let rs = v.results.filter((x) => (!f.mode || x.mode === f.mode) && (!f.status || x.status === f.status) && (!f.priced || x.evaluation.priced) && (!f.comparable || x.evaluation.comparable) && (!f.valid || !x.evaluation.expired)
      && (!f.q || `${x.provider_name} ${x.service_type} ${JSON.stringify(x.route)}`.toLowerCase().includes(f.q.toLowerCase())));
    const key = { price: (x) => (x.evaluation.total ? x.evaluation.total.mid : 1e12), transit: (x) => x.transit_max ?? 1e9, confidence: (x) => -x.evaluation.confidence, provider: (x) => x.provider_name.toLowerCase(), validity: (x) => (x.validity_to ? -new Date(x.validity_to) : 0) }[VS.sort];
    rs.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    // Group request-required providers to keep the table readable.
    const priced = rs.filter((x) => x.evaluation.priced), rfq = rs.filter((x) => !x.evaluation.priced);
    const rfqGroups = Object.values(rfq.reduce((m, x) => { (m[x.provider_name] = m[x.provider_name] || []).push(x); return m; }, {}));
    $('#tbl').innerHTML = `<table><thead><tr><th>Provider</th><th>Status</th><th>Method / service</th><th>Route</th><th class="num">Total (${v.currency})</th><th>Transit</th><th>Coverage</th><th>Validity</th><th>Source · retrieved</th><th></th></tr></thead><tbody>
      ${priced.map((x) => resultRow(x, v)).join('')}
      ${rfqGroups.map((g) => `<tr><td><b>${esc(g[0].provider_name)}</b><div class="small muted">${esc(TYPE[g[0].provider_type] || '')}</div></td><td>${statusBadge('UNAVAILABLE_RFQ')}</td><td>${g.map((x) => `<span class="pill">${MODE[x.mode]}</span>`).join('')}</td><td colspan="5" class="small muted">${esc(g[0].limitations || '')}</td><td class="small">${g[0].source_url ? `<a href="${esc(g[0].source_url)}" target="_blank" rel="noopener">website</a>` : ''}</td><td><button class="sm" data-rfq="${g.map((x) => x.id).join(',')}">Request quote</button></td></tr>`).join('')}
      ${!rs.length ? `<tr><td colspan="10" class="muted">${running ? 'Searching…' : 'No results match the filters.'}</td></tr>` : ''}</tbody></table>`;
    $$('#tbl [data-toggle]').forEach((b) => { b.onclick = () => { const k = Number(b.dataset.toggle); VS.open.has(k) ? VS.open.delete(k) : VS.open.add(k); drawTable(); }; });
    $$('#tbl [data-save]').forEach((b) => { b.onclick = guard(async () => { const label = prompt('Label for this saved quotation (optional):', '') ?? null; if (label === null) return; await api('POST', '/api/saved', { search_id: s.id, result_id: Number(b.dataset.save), label }); toast('Quotation saved'); renderSearch(s.id); }); });
    $$('#tbl [data-landed]').forEach((b) => { b.onclick = () => landedModal(v, Number(b.dataset.landed)); });
    $$('#tbl [data-del]').forEach((b) => { b.onclick = guard(async () => { if (!confirm('Delete this manual quotation?')) return; await api('DELETE', `/api/searches/${s.id}/results/${b.dataset.del}`); renderSearch(s.id); }); });
    $$('#tbl [data-rfq]').forEach((b) => { b.onclick = () => rfqModal(v, b.dataset.rfq.split(',').map(Number)); });
  };
  drawTable();
  $('#sort').value = VS.sort;
  const fset = (k, val) => { VS.filters[k] = val; drawTable(); };
  $('#f_mode').onchange = (e) => fset('mode', e.target.value); $('#f_status').onchange = (e) => fset('status', e.target.value); $('#f_q').oninput = (e) => fset('q', e.target.value);
  $('#f_priced').onchange = (e) => fset('priced', e.target.checked); $('#f_comp').onchange = (e) => fset('comparable', e.target.checked); $('#f_valid').onchange = (e) => fset('valid', e.target.checked);
  $('#sort').onchange = (e) => { VS.sort = e.target.value; drawTable(); };
  $('#cur').onchange = guard(async (e) => { VS.currency = e.target.value; await renderSearch(s.id); });
  let wt; $$('[data-w]').forEach((i) => { i.oninput = () => { i.nextElementSibling.textContent = i.value + '%'; clearTimeout(wt); wt = setTimeout(guard(async () => { VS.weights = Object.fromEntries($$('[data-w]').map((x) => [x.dataset.w, Number(x.value) / 100])); await renderSearch(s.id); }), 400); }; });
  $('#rerun').onclick = guard(async () => { await api('POST', `/api/searches/${s.id}/rerun`); toast('Re-checking all sources…'); setTimeout(() => renderSearch(s.id), 800); });
  $('#addq').onclick = () => manualQuoteModal(v);
  $('#ask').onclick = guard(async () => { const c = await api('POST', '/api/assistant/conversations', { search_id: s.id }); location.hash = `#/assistant/${c.id}`; });
  $('#share').onclick = guard(async () => { const days = prompt('Share a read-only report link valid for how many days? (1–90)', '7'); if (!days) return; const r2 = await api('POST', `/api/searches/${s.id}/share`, { days: Number(days) }); const url = r2.url.startsWith('http') ? r2.url : location.origin + r2.url; modal('Share link created', `<p>Anyone with this link can view a read-only report of this search until it expires (${r2.expires_in_days} days). Only share it with authorised recipients.</p><input readonly value="${esc(url)}">`); });
  if ($('#answer')) $('#answer').onclick = guard(async () => { const patch = {}; $$('[data-miss]').forEach((el) => { if (el.value !== '') patch[el.dataset.miss] = el.type === 'number' ? Number(el.value) : el.value === 'yes' ? true : el.value === 'no' ? false : el.value; }); if (!Object.keys(patch).length) return toast('Enter at least one answer', true); await api('PATCH', `/api/searches/${s.id}`, patch); toast('Search updated — re-running'); setTimeout(() => renderSearch(s.id), 600); });
  if (running) S.timers.push(setTimeout(() => { if (location.hash === `#/search/${s.id}`) renderSearch(s.id).catch(() => {}); }, 2500));
}
function missingInput(m) {
  const f = m.field;
  if (f === 'scope') return `<select data-miss="scope"><option value="">—</option>${Object.entries(SCOPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
  if (f === 'customs_required') return '<select data-miss="customs_required"><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>';
  if (f === 'incoterm') return `<select data-miss="incoterm"><option value="">—</option>${S.ref.incoterms.map((i) => `<option>${i}</option>`).join('')}</select>`;
  if (f === 'container_type') return `<select data-miss="container_type"><option value="">—</option>${S.ref.containers.map((c) => `<option>${c}</option>`).join('')}</select>`;
  if (f === 'cargo_category') return '<select data-miss="cargo_category"><option value="">—</option><option value="general">General</option><option value="dangerous_goods">Dangerous goods</option><option value="perishable">Perishable</option><option value="temperature_controlled">Temperature-controlled</option><option value="oversized">Oversized</option></select>';
  if (f.endsWith('_country')) return `<select data-miss="${f}"><option value="">—</option>${S.ref.countries.map((c) => `<option value="${c.iso}">${esc(c.name)}</option>`).join('')}</select>`;
  if (f.endsWith('_date')) return `<input type="date" data-miss="${f}">`;
  if (['gross_weight_kg', 'volume_cbm', 'cargo_value'].includes(f)) return `<input type="number" step="any" data-miss="${f}">`;
  return `<input data-miss="${f}">`;
}
function recCard(k, label, rc) {
  if (!rc) return `<div class="rec"><div class="t">${label}</div><div class="muted small">No priced option yet.</div></div>`;
  return `<div class="rec"><div class="t">${label}</div><div class="p">${esc(rc.provider)}</div><div class="small muted">${esc(MODE[rc.mode])} · ${esc(rc.service_type || '')}</div>
   <div class="price">${money(rc.total)} <span class="small">${esc(rc.total.currency)}</span></div><div class="small">${rc.transit.min ?? '?'}–${rc.transit.max ?? '?'} days · ${statusBadge(rc.status, rc.status_label)}</div>
   <div class="small muted">Confidence ${Math.round(rc.confidence * 100)}%</div><div class="conf"><i style="width:${Math.round(rc.confidence * 100)}%"></i></div>
   <div class="why">${esc(rc.why)}</div>
   <details><summary class="small">Pros, cons & uncertainties</summary><ul>${rc.advantages.map((a) => `<li>✓ ${esc(a)}</li>`).join('')}${rc.disadvantages.map((a) => `<li>✗ ${esc(a)}</li>`).join('')}${rc.uncertainties.map((a) => `<li>? ${esc(a)}</li>`).join('')}</ul>
   <div class="small muted">Source: ${rc.source.url ? `<a href="${esc(rc.source.url)}" target="_blank" rel="noopener">${esc(rc.source.name || rc.source.url)}</a>` : esc(rc.source.name || '—')} · ${dt(rc.source.retrieved_at)}</div></details></div>`;
}
function resultRow(x, v) {
  const e = x.evaluation; const open = VS.open.has(x.id);
  const route = x.route || {}; const rt = [route.origin || route.origin_country, route.via, route.destination || route.dest_country].filter(Boolean).join(' → ');
  const cov = e.comparable ? '<span class="badge st-VERIFIED_LIVE">Like-for-like</span>' : `<span class="badge st-INDICATIVE_ONLINE" title="Missing: ${esc(e.missing_required.join(', '))}">Not like-for-like</span>`;
  let html = `<tr><td><b>${esc(x.provider_name)}</b><div class="small muted">${esc(TYPE[x.provider_type] || x.provider_type || '')}</div></td><td>${statusBadge(x.status, e.status_label)}${x.saved ? ' ★' : ''}</td>
   <td>${esc(MODE[x.mode])}<div class="small muted">${esc(x.service_type || '')} · ${esc(SCOPE[x.scope] || 'scope n/s')}</div></td><td class="small">${esc(rt || '—')}</td>
   <td class="num"><b>${money(e.total)}</b>${x.currency && x.currency !== v.currency ? `<div class="small muted">orig. ${esc(x.currency)}</div>` : ''}</td><td class="nowrap">${x.transit_min ?? '?'}–${x.transit_max ?? '?'} d</td>
   <td>${cov}${e.excluded.length ? `<div class="small muted">excl: ${esc(e.excluded.join(', '))}</div>` : ''}${e.unknown.length ? `<div class="small" style="color:var(--warn)">unknown: ${esc(e.unknown.join(', '))}</div>` : ''}</td>
   <td class="small">${x.validity_to ? (e.expired ? `<span style="color:var(--err)">expired ${esc(x.validity_to)}</span>` : esc(x.validity_to)) : '—'}</td>
   <td class="small">${x.source_url ? `<a href="${esc(x.source_url)}" target="_blank" rel="noopener">${esc((x.source_name || 'source').slice(0, 60))}</a>` : esc((x.source_name || '').slice(0, 60))}<div class="muted">${dt(x.retrieved_at)}</div></td>
   <td class="nowrap"><button class="ghost sm" data-toggle="${x.id}">${open ? '▲' : '▼'} Details</button></td></tr>`;
  if (open) {
    html += `<tr class="expand"><td colspan="10"><div class="grid g2"><div><h3>Charge breakdown</h3><table class="lines"><tr><th>Category</th><th>Line</th><th>Basis</th><th class="num">Original</th><th class="num">${v.currency}</th></tr>
     ${e.lines.map((l) => `<tr><td>${esc((S.ref.categories.find((c) => c.key === l.category) || {}).label || l.category)}</td><td>${esc(l.label || '')}</td><td>${esc(l.basis || '')}${l.original && l.original.qty !== 1 ? ' × ' + fmt(l.original.qty, 2) : ''}</td><td class="num">${l.inclusion !== 'amount' ? `<i>${esc(l.inclusion)}</i>` : l.original ? `${fmt(l.original.min, 2)}${l.original.max !== l.original.min ? '–' + fmt(l.original.max, 2) : ''} ${esc(l.currency)}` : '<i>unresolved</i>'}</td><td class="num">${l.converted ? `${fmt(l.converted.min, 2)}${l.converted.max !== l.converted.min ? '–' + fmt(l.converted.max, 2) : ''}` : ''}</td></tr>`).join('')}
     <tr><td colspan="4"><b>Total of known charges</b></td><td class="num"><b>${money(e.total)}</b></td></tr></table><div class="small muted">FX: ${esc(e.fx.join(' · ') || 'n/a')}</div></div>
     <div><h3>Assessment</h3>${e.flags.map((f) => `<div class="alert warn small">${esc(f)}</div>`).join('')}<p class="small"><b>Required for your scope:</b> ${esc(e.required_categories.join(', '))}<br><b>Confidence:</b> ${Math.round(e.confidence * 100)}%<br><b>Limitations:</b> ${esc(x.limitations || '—')}${x.notes ? `<br><b>Notes:</b> ${esc(x.notes)}` : ''}</p>
     <div class="row">${x.saved ? '<span class="badge">★ Saved</span>' : `<button class="sm" data-save="${x.id}">★ Save quotation</button>`}<button class="ghost sm" data-landed="${x.id}">Landed cost</button>${x.source_key === 'manual_entry' ? `<button class="danger sm" data-del="${x.id}">Delete</button>` : ''}</div></div></div></td></tr>`;
  }
  return html;
}
function rfqModal(v, ids) {
  const rs = v.results.filter((x) => ids.includes(x.id));
  const first = rs[0]; const rq = first.rfq || {};
  modal(`Request quotation — ${first.provider_name}`, `<p class="small muted">${esc(first.limitations || '')}</p>
    <div class="field"><label>Mode</label><select id="rm">${rs.map((x) => `<option value="${x.id}">${MODE[x.mode]}</option>`).join('')}</select></div>
    <div class="field"><label>Send to</label><div class="small">${rq.email ? `Email: <b>${esc(rq.email)}</b>` : 'No public RFQ email on file'} ${rq.quote_url ? ` · <a href="${esc(rq.quote_url)}" target="_blank" rel="noopener">Quote page / portal</a>` : ''} · Online quote: ${esc(rq.online_quote || 'unknown')}</div></div>
    <div class="field"><label>Subject</label><input id="rs"></div><div class="field"><label>Message</label><textarea id="rb" style="min-height:260px"></textarea></div>
    <div class="row"><a class="btn" id="rmail">Open in email client</a><button class="ghost" id="rcopy">Copy text</button><button class="ghost" id="rentered">Enter received quote…</button></div>`, (m, close) => {
    const fill = () => { const x = rs.find((y) => y.id === Number($('#rm', m).value)); $('#rs', m).value = x.rfq.subject; $('#rb', m).value = x.rfq.body; $('#rmail', m).href = `mailto:${encodeURIComponent(x.rfq.email || '')}?subject=${encodeURIComponent($('#rs', m).value)}&body=${encodeURIComponent($('#rb', m).value)}`; };
    fill(); $('#rm', m).onchange = fill; $('#rb', m).oninput = $('#rs', m).oninput = () => { $('#rmail', m).href = `mailto:${encodeURIComponent(first.rfq.email || '')}?subject=${encodeURIComponent($('#rs', m).value)}&body=${encodeURIComponent($('#rb', m).value)}`; };
    $('#rcopy', m).onclick = () => { navigator.clipboard.writeText(`${$('#rs', m).value}\n\n${$('#rb', m).value}`).then(() => toast('Copied')); };
    $('#rentered', m).onclick = () => { close(); const x = rs.find((y) => y.id === Number($('#rm', m).value)) || first; manualQuoteModal(v, { provider_name: x.provider_name, provider_id: x.provider_id, mode: x.mode }); };
  });
}
function manualQuoteModal(v, pre = {}) {
  const cats = S.ref.categories;
  const s = v.search;
  modal('Enter received quotation', `<p class="small muted">Use this for quotations received by email, phone or PDF. Each line must state whether it is a priced amount, included, excluded or unknown. The source reference is mandatory.</p>
  <form id="mq"><div class="grid g3"><div class="field"><label>Provider name *</label><input name="provider_name" required value="${esc(pre.provider_name || '')}"></div>
  <div class="field"><label>Mode *</label><select name="mode">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${pre.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div class="field"><label>Quote currency *</label><select name="currency">${S.ref.currencies.map((c) => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
  <div class="field"><label>Service / product</label><input name="service_type" placeholder="e.g. Consolidated air via DXB"></div>
  <div class="field"><label>Scope</label><select name="scope">${Object.entries(SCOPE).map(([k, l]) => `<option value="${k}" ${s.request.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div class="field"><label>Status</label><select name="status"><option value="MANUAL_QUOTE">Manual Quotation (current, written)</option><option value="HISTORICAL">Historical Price (past quote)</option></select></div>
  <div class="field"><label>Transit min (days)</label><input name="transit_min" type="number" min="0"></div><div class="field"><label>Transit max (days)</label><input name="transit_max" type="number" min="0"></div>
  <div class="field"><label>Valid until</label><input name="validity_to" type="date"></div>
  <div class="field"><label>Origin port/airport</label><input name="origin"></div><div class="field"><label>Via</label><input name="via"></div><div class="field"><label>Destination port/airport</label><input name="destination"></div></div>
  <div class="field"><label>Source reference * <span class="opt">(e.g. "Email from J. Smith, 14 Nov 2026, ref Q-2231")</span></label><input name="source_reference" required></div>
  <h3>Charge lines</h3><table id="ql"><tr><th>Category</th><th>Description</th><th>Inclusion</th><th>Basis</th><th>Amount / rate</th><th>Currency</th><th></th></tr></table>
  <button type="button" class="ghost sm" id="addl">＋ Add line</button>
  <div class="field" style="margin-top:10px"><label>Notes / exclusions</label><textarea name="notes"></textarea></div><button>Save quotation</button></form>`, (m, close) => {
    const line = (cat = 'freight', inc = 'amount') => `<tr><td><select data-l="category">${cats.map((c) => `<option value="${c.key}" ${c.key === cat ? 'selected' : ''}>${c.label}</option>`).join('')}</select></td><td><input data-l="label"></td>
      <td><select data-l="inclusion">${['amount', 'included', 'excluded', 'unknown'].map((x) => `<option ${x === inc ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><select data-l="basis"><option value="fixed">per shipment</option><option value="per_kg_chargeable">per chargeable kg</option><option value="per_kg">per gross kg</option><option value="per_cbm">per CBM</option><option value="per_rt">per RT (W/M)</option><option value="per_container">per container</option></select></td>
      <td><input data-l="amount" type="number" step="any" style="width:100px"></td><td><select data-l="currency"><option value="">(quote)</option>${S.ref.currencies.map((c) => `<option>${c}</option>`).join('')}</select></td><td><button type="button" class="ghost sm" data-x>✕</button></td></tr>`;
    const add = (c, i) => { $('#ql', m).insertAdjacentHTML('beforeend', line(c, i)); $$('[data-x]', m).forEach((b) => { b.onclick = () => b.closest('tr').remove(); }); };
    ['freight', 'fuel', 'security', 'origin', 'destination', 'customs', 'delivery', 'insurance', 'documentation'].forEach((c) => add(c, c === 'freight' ? 'amount' : 'unknown'));
    $('#addl', m).onclick = () => add('other');
    $('#mq', m).onsubmit = guard(async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
      f.charges = $$('#ql tr', m).slice(1).map((tr) => Object.fromEntries($$('[data-l]', tr).map((i) => [i.dataset.l, i.value]))).filter((c) => c.inclusion !== 'unknown' || c.label);
      f.charges.forEach((c) => { if (!c.currency) delete c.currency; if (c.basis === 'per_container') c.quantity = s.request.container_count || 1; });
      for (const k of ['transit_min', 'transit_max']) f[k] = f[k] === '' ? null : Number(f[k]);
      if (pre.provider_id) f.provider_id = pre.provider_id;
      await api('POST', `/api/searches/${s.id}/quotes`, f); close(); toast('Quotation added'); renderSearch(s.id);
    });
  });
}
function landedModal(v, rid) {
  const x = v.results.find((r) => r.id === rid); const req = v.search.request;
  modal(`Landed cost — ${x.provider_name}`, `<div class="grid g3"><div class="field"><label>Goods value</label><input id="gv" type="number" step="any" value="${req.cargo_value || ''}"></div><div class="field"><label>Goods currency</label><select id="gc">${S.ref.currencies.map((c) => `<option ${c === (req.cargo_value_currency || 'USD') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
   <div class="field"><label>Insurance (${v.currency}) <span class="opt">blank = 0.4% assumed</span></label><input id="ins" type="number" step="any"></div><div class="field"><label>Duty rate %</label><input id="du" type="number" step="any" value="5"></div><div class="field"><label>VAT rate %</label><input id="va" type="number" step="any" value="5"></div><div class="field"><label>Fixed fees (${v.currency})</label><input id="ff" type="number" step="any" value="0"></div></div>
   <button id="calc">Calculate</button><div id="lc" style="margin-top:12px"></div><p class="small muted">Freight uses the midpoint of this offer's known charges (${money(x.evaluation.total)} ${v.currency}). Duty is assessed on CIF; VAT on CIF + duty. Confirm the 12-digit GCC tariff rate for each line (0% or 5% in Oman).</p>`, (m) => {
    $('#calc', m).onclick = guard(async () => {
      const r = await api('POST', `/api/searches/${v.search.id}/landed-cost?currency=${v.currency}`, { result_id: rid, goods_value: Number($('#gv', m).value), goods_currency: $('#gc', m).value, insurance: $('#ins', m).value === '' ? null : Number($('#ins', m).value), duty_rate: Number($('#du', m).value) / 100, vat_rate: Number($('#va', m).value) / 100, fixed_fees: Number($('#ff', m).value) || 0 });
      $('#lc', m).innerHTML = `<table>${[['Goods', r.goods], ['Freight', r.freight], [`Insurance${r.insurance_assumed ? ' (0.4% assumed)' : ''}`, r.insurance], ['CIF value', r.cif], [`Customs duty (${r.duty_rate * 100}%)`, r.duty], [`Import VAT (${r.vat_rate * 100}%)`, r.vat], ['Fixed fees', r.fixed_fees]].map(([l, n]) => `<tr><td>${l}</td><td class="num">${fmt(n, 2)} ${r.currency}</td></tr>`).join('')}<tr><td><b>Landed total</b></td><td class="num"><b>${fmt(r.landed_total, 2)} ${r.currency}</b></td></tr></table><p class="small muted">${esc(r.vat_note)}</p>`;
    });
  });
}

// ───────────── Assistant ─────────────
route(/^assistant(?:\/(\d+))?$/, async (cid) => {
  mount('assistant', '');
  const convs = await api('GET', '/api/assistant/conversations');
  if (!cid) { if (convs.length) { location.hash = `#/assistant/${convs[0].id}`; return; } const c = await api('POST', '/api/assistant/conversations', {}); location.hash = `#/assistant/${c.id}`; return; }
  const c = await api('GET', `/api/assistant/conversations/${cid}`);
  const examples = ['Find the cheapest way to ship 500 kg, 2.4 cbm from Shanghai to Muscat door to door', 'Compare air and sea freight from Shanghai to Muscat', 'Find the cheapest sea freight for one 20-foot container from Ningbo to Sohar', 'Which freight forwarders operate between Dubai and Muscat?', 'Find alternatives to DHL that are cheaper', 'Compare the top five available freight quotations', 'Find the fastest shipping option', 'Calculate the total landed cost including destination charges', 'Recheck the available prices for this shipment', 'Explain why one quotation is more expensive than another'];
  $('#main').innerHTML = `<div class="top"><div><h1>AI freight assistant</h1><div class="sub">${S.ai ? 'Claude-powered agent with live web search and full access to your searches.' : 'Rule-based mode (no ANTHROPIC_API_KEY configured) — still runs real searches and comparisons.'} ${c.search_id ? `· Context: <a href="#/search/${c.search_id}">search #${c.search_id}</a>` : '· No active search yet'}</div></div>
   <div class="row"><select id="convs">${convs.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>Conversation #${x.id} · ${x.n} msgs · ${dt(x.created_at)}</option>`).join('')}</select><button class="ghost" id="newc">New conversation</button></div></div>
   <div class="card chat"><div class="msgs" id="msgs">${c.messages.length ? '' : `<div class="muted">Ask a question in natural language. Examples:</div><div class="chips">${examples.map((e) => `<span class="chip">${esc(e)}</span>`).join('')}</div>`}${c.messages.map(msgHtml).join('')}</div>
   <form class="composer" id="cf"><textarea id="ct" placeholder="Ask about prices, providers, lanes… (Enter to send, Shift+Enter for new line)"></textarea><button id="send">Send</button></form></div>`;
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  $$('.chip').forEach((ch) => { ch.onclick = () => { $('#ct').value = ch.textContent; $('#ct').focus(); }; });
  $('#convs').onchange = (e) => { location.hash = `#/assistant/${e.target.value}`; };
  $('#newc').onclick = guard(async () => { const n = await api('POST', '/api/assistant/conversations', {}); location.hash = `#/assistant/${n.id}`; });
  $('#ct').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cf').requestSubmit(); } };
  $('#cf').onsubmit = guard(async (e) => {
    e.preventDefault(); const text = $('#ct').value.trim(); if (!text) return;
    $('#ct').value = ''; box.insertAdjacentHTML('beforeend', msgHtml({ role: 'user', content: text }) + '<div class="msg assistant" id="pending"><span class="spin"></span> Working — searching sources and comparing…</div>'); box.scrollTop = box.scrollHeight;
    $('#send').disabled = true;
    try { const r = await api('POST', `/api/assistant/conversations/${c.id}/messages`, { text }); $('#pending').outerHTML = msgHtml({ role: 'assistant', content: r.reply, meta: { ...(r.meta || {}), search_id: r.search_id } }); }
    catch (err) { $('#pending').outerHTML = msgHtml({ role: 'assistant', content: 'Error: ' + err.message }); }
    finally { $('#send').disabled = false; box.scrollTop = box.scrollHeight; }
  });
});
function msgHtml(m) {
  const meta = m.meta || {};
  const extra = m.role === 'assistant' ? `${meta.search_id ? `<div class="small" style="margin-top:6px"><a href="#/search/${meta.search_id}">Open comparison for search #${meta.search_id} →</a></div>` : ''}${meta.web_sources && meta.web_sources.length ? `<details class="small"><summary>Web sources (${meta.web_sources.length})</summary>${meta.web_sources.map((u) => `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></div>`).join('')}</details>` : ''}` : '';
  return `<div class="msg ${m.role}">${m.role === 'assistant' ? md(m.content) : esc(m.content)}${extra}</div>`;
}

// ───────────── Providers directory ─────────────
route(/^providers$/, async () => {
  mount('providers', '');
  $('#main').innerHTML = `<div class="top"><div><h1>Shipping companies directory</h1><div class="sub">Carriers, forwarders, NVOCCs, express integrators and platforms are different provider types — each is labelled. Lane coverage is only shown where evidenced.</div></div>${isOp() ? '<button id="newp">＋ Add provider</button>' : ''}</div>
   <div class="card"><div class="row"><input id="pq" placeholder="Search name, hub, notes…" style="width:240px"><select id="pt"><option value="">All provider types</option>${Object.entries(TYPE).filter(([k]) => !['benchmark', 'publisher'].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
   <select id="pm"><option value="">All modes</option>${Object.entries(MODE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select id="pc"><option value="">Any country</option>${S.ref.countries.map((c) => `<option value="${c.iso}">${esc(c.name)}</option>`).join('')}</select><span class="right muted small" id="pn"></span></div></div>
   <div class="card"><div class="tbl-wrap" id="ptbl"></div></div>`;
  const load = guard(async () => {
    const q = new URLSearchParams({ q: $('#pq').value, type: $('#pt').value, mode: $('#pm').value, country: $('#pc').value });
    const rows = await api('GET', '/api/providers?' + q);
    $('#pn').textContent = `${rows.length} providers`;
    $('#ptbl').innerHTML = `<table><thead><tr><th>Company</th><th>Type</th><th>Modes</th><th>HQ</th><th>Oman presence</th><th>Online quote</th><th>API</th><th>Verified</th></tr></thead><tbody>${rows.map((p) => `<tr class="click" data-pid="${p.id}"><td><b>${esc(p.name)}</b>${p.parent_group ? `<div class="small muted">${esc(p.parent_group)}</div>` : ''}</td><td><span class="pill">${esc(TYPE[p.provider_type] || p.provider_type)}</span></td><td>${p.modes.map((m) => `<span class="pill">${MODE[m] || m}</span>`).join('')}</td><td>${esc(p.hq_country || '—')}</td>
     <td>${p.oman_presence === 'verified' ? '<span class="badge st-VERIFIED_LIVE">verified</span>' : p.oman_presence === 'reported' ? '<span class="badge st-INDICATIVE_ONLINE">reported</span>' : '<span class="badge">unverified</span>'}</td><td class="small">${esc(p.online_quote)}</td><td class="small">${esc(p.api_availability)}</td><td class="small">${esc(p.last_verified || '—')}</td></tr>`).join('')}</tbody></table>`;
    $$('[data-pid]').forEach((tr) => { tr.onclick = () => providerModal(Number(tr.dataset.pid), load); });
  });
  let t; ['pq', 'pt', 'pm', 'pc'].forEach((id) => { $('#' + id).addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); }); });
  if ($('#newp')) $('#newp').onclick = () => providerEdit(null, load);
  load();
});
async function providerModal(id, reload) {
  const p = await api('GET', `/api/providers/${id}`);
  modal(p.name, `<div class="grid g2 small"><div><b>Type:</b> ${esc(TYPE[p.provider_type])}<br><b>Group:</b> ${esc(p.parent_group || '—')}<br><b>Website:</b> ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website)}</a>` : '—'}<br><b>HQ:</b> ${esc(cname(p.hq_country))}<br><b>Regions:</b> ${esc(p.regions_served.join(', ') || '—')}<br><b>Countries:</b> ${esc(p.countries_served.join(', ') || '—')}<br><b>Hubs:</b> ${esc(p.main_hubs.join(', ') || '—')}</div>
   <div><b>Modes:</b> ${p.modes.map((m) => MODE[m] || m).join(', ')}<br><b>Online quotation:</b> ${esc(p.online_quote)} ${p.online_quote_url ? `<a href="${esc(p.online_quote_url)}" target="_blank" rel="noopener">link</a>` : ''}<br><b>API:</b> ${esc(p.api_availability)} ${p.api_docs_url ? `<a href="${esc(p.api_docs_url)}" target="_blank" rel="noopener">docs</a>` : ''}<br><b>Booking platform:</b> ${esc(p.booking_platform || '—')}<br><b>Contact:</b> ${esc(Object.entries(p.contact).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—')}<br><b>Oman presence:</b> ${esc(p.oman_presence)}<br><b>Reliability rating:</b> ${p.reliability_rating ?? 'not rated'} ${p.reliability_basis ? '(' + esc(p.reliability_basis) + ')' : ''}</div></div>
   ${p.service_notes ? `<div class="alert info small" style="margin-top:10px">${esc(p.service_notes)}</div>` : ''}
   <h3>Evidence</h3>${p.evidence.length ? p.evidence.map((e) => `<div class="small">• ${esc(e.claim)} ${e.url ? `— <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url.slice(0, 90))}</a>` : ''}</div>`).join('') : '<p class="small muted">No evidence recorded — facts are company-stated/unverified.</p>'}
   <h3 style="margin-top:10px">Evidenced lanes</h3>${p.routes.length ? p.routes.map((r) => `<div class="small">• ${esc(r.origin_country)} → ${esc(r.dest_country)} · ${esc(MODE[r.mode] || r.mode)} — <a href="${esc(r.evidence_url)}" target="_blank" rel="noopener">evidence</a> ${isOp() ? `<button class="link" data-delr="${r.id}">remove</button>` : ''}</div>`).join('') : '<p class="small muted">None recorded.</p>'}
   ${p.integrations.length ? `<h3 style="margin-top:10px">Integrations</h3>${p.integrations.map((i) => `<div class="small">• ${esc(i.name)} — <b>${esc(i.status.replace(/_/g, ' '))}</b></div>`).join('')}` : ''}
   ${isOp() ? `<div class="row" style="margin-top:14px"><button id="pe">Edit provider</button><button class="ghost" id="pr">Add evidenced lane</button></div>` : ''}`, (m, close) => {
    if (!isOp()) return;
    $('#pe', m).onclick = () => { close(); providerEdit(p, reload); };
    $('#pr', m).onclick = guard(async () => {
      const o = prompt('Origin country (ISO-2):'); if (!o) return; const d = prompt('Destination country (ISO-2):'); if (!d) return; const mo = prompt('Mode (air, express, sea_lcl, sea_fcl, road):', 'sea_lcl'); if (!mo) return; const u = prompt('Evidence URL (required):'); if (!u) return;
      await api('POST', `/api/providers/${p.id}/routes`, { origin_country: o, dest_country: d, mode: mo, evidence_url: u }); close(); providerModal(p.id, reload);
    });
    $$('[data-delr]', m).forEach((b) => { b.onclick = guard(async () => { await api('DELETE', `/api/providers/${p.id}/routes/${b.dataset.delr}`); close(); providerModal(p.id, reload); }); });
  });
}
function providerEdit(p, reload) {
  const v = p || { name: '', provider_type: 'forwarder', modes: [], regions_served: [], countries_served: [], main_hubs: [], contact: {}, evidence: [], online_quote: 'unknown', api_availability: 'unknown', oman_presence: 'unverified', active: 1 };
  const list = (a) => (a || []).join(', ');
  modal(p ? `Edit — ${p.name}` : 'Add provider', `<form id="pf"><div class="grid g3">
   <div class="field"><label>Name *</label><input name="name" value="${esc(v.name)}" required></div><div class="field"><label>Type *</label><select name="provider_type">${Object.entries(TYPE).filter(([k]) => !['benchmark', 'publisher'].includes(k)).map(([k, l]) => `<option value="${k}" ${v.provider_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label>Parent group</label><input name="parent_group" value="${esc(v.parent_group || '')}"></div>
   <div class="field"><label>Website</label><input name="website" value="${esc(v.website || '')}"></div><div class="field"><label>HQ country (ISO-2)</label><input name="hq_country" value="${esc(v.hq_country || '')}"></div><div class="field"><label>Modes (comma: air, express, sea_lcl, sea_fcl, road)</label><input name="modes" value="${esc(list(v.modes))}"></div>
   <div class="field"><label>Regions served (comma)</label><input name="regions_served" value="${esc(list(v.regions_served))}"></div><div class="field"><label>Countries served (ISO-2, comma)</label><input name="countries_served" value="${esc(list(v.countries_served))}"></div><div class="field"><label>Main hubs (comma)</label><input name="main_hubs" value="${esc(list(v.main_hubs))}"></div>
   <div class="field"><label>Contact email</label><input name="c_email" value="${esc(v.contact.email || '')}"></div><div class="field"><label>Contact phone</label><input name="c_phone" value="${esc(v.contact.phone || '')}"></div><div class="field"><label>Quote page</label><input name="c_quote" value="${esc(v.contact.quote_page || '')}"></div>
   <div class="field"><label>Online quote</label><select name="online_quote">${['yes', 'login_required', 'no', 'unknown'].map((x) => `<option ${v.online_quote === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>Online quote URL</label><input name="online_quote_url" value="${esc(v.online_quote_url || '')}"></div>
   <div class="field"><label>API availability</label><select name="api_availability">${['public', 'partner', 'enterprise', 'none', 'unknown'].map((x) => `<option ${v.api_availability === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field"><label>API docs URL</label><input name="api_docs_url" value="${esc(v.api_docs_url || '')}"></div>
   <div class="field"><label>Booking platform</label><input name="booking_platform" value="${esc(v.booking_platform || '')}"></div><div class="field"><label>Oman presence</label><select name="oman_presence">${['verified', 'reported', 'unverified', 'none'].map((x) => `<option ${v.oman_presence === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
   <div class="field"><label>Reliability rating (0–5)</label><input name="reliability_rating" type="number" step="0.1" min="0" max="5" value="${v.reliability_rating ?? ''}"></div><div class="field"><label>Rating basis (required with rating)</label><input name="reliability_basis" value="${esc(v.reliability_basis || '')}"></div><div class="field"><label>Active</label><select name="active"><option value="1" ${v.active ? 'selected' : ''}>Yes</option><option value="0" ${!v.active ? 'selected' : ''}>No</option></select></div></div>
   <div class="field"><label>Service characteristics / notes</label><textarea name="service_notes">${esc(v.service_notes || '')}</textarea></div>
   <div class="field"><label>Evidence (one per line: claim | URL)</label><textarea name="evidence">${esc(v.evidence.map((e) => `${e.claim} | ${e.url || ''}`).join('\n'))}</textarea></div>
   <div class="field"><label>Last verified (date)</label><input type="date" name="last_verified" value="${esc(v.last_verified || '')}"></div><button>Save</button></form>`, (m, close) => {
    $('#pf', m).onsubmit = guard(async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
      const arr = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const body = { ...f, modes: arr(f.modes), regions_served: arr(f.regions_served), countries_served: arr(f.countries_served).map((x) => x.toUpperCase()), main_hubs: arr(f.main_hubs),
        contact: Object.fromEntries([['email', f.c_email], ['phone', f.c_phone], ['quote_page', f.c_quote]].filter(([, x]) => x)), active: f.active === '1',
        reliability_rating: f.reliability_rating === '' ? null : Number(f.reliability_rating), evidence: f.evidence.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([claim, url]) => ({ claim, url: url || null })),
        hq_country: f.hq_country ? f.hq_country.toUpperCase() : null, last_verified: f.last_verified || null };
      for (const k of ['c_email', 'c_phone', 'c_quote']) delete body[k];
      await api(p ? 'PUT' : 'POST', p ? `/api/providers/${p.id}` : '/api/providers', body); close(); toast('Provider saved'); reload();
    });
  });
}

// ───────────── Saved quotations ─────────────
route(/^saved$/, async () => {
  mount('saved', '');
  const rows = await api('GET', '/api/saved');
  $('#main').innerHTML = `<div class="top"><div><h1>Saved quotations</h1><div class="sub">Snapshots taken when saved — prices do not change if the search is re-run.</div></div><div class="row"><button class="ghost" id="cmp">Compare selected</button><a class="btn ghost" href="/api/saved/export.xlsx">Export Excel</a></div></div>
   <div class="card">${rows.length ? `<table><tr><th></th><th>Label / search</th><th>Lane</th><th>Provider</th><th>Status</th><th>Method</th><th class="num">Total</th><th>Transit</th><th>Like-for-like</th><th>Valid until</th><th>Saved</th><th></th></tr>${rows.map((q) => { const s = q.snapshot; const exp = s.validity_to && new Date(s.validity_to) < new Date(); return `<tr><td><input type="checkbox" data-sel="${q.id}" style="width:auto"></td><td><b>${esc(q.label || '—')}</b><div class="small"><a href="#/search/${q.search_id}">${esc(q.ref)}</a>${isOp() ? ' · ' + esc(q.org_name) : ''}</div></td><td>${esc(s.lane)}</td><td>${esc(s.provider)}</td><td>${statusBadge(s.status, s.status_label)}</td><td>${esc(MODE[s.mode])}</td><td class="num">${money(s.total)} ${esc(s.total ? s.total.currency : '')}</td><td>${s.transit[0] ?? '?'}–${s.transit[1] ?? '?'} d</td><td>${s.comparable ? 'Yes' : 'No'}</td><td class="small">${exp ? `<span style="color:var(--err)">expired ${esc(s.validity_to)}</span>` : esc(s.validity_to || '—')}</td><td class="small">${dt(q.created_at)}</td><td><button class="ghost sm" data-rm="${q.id}">Remove</button></td></tr>`; }).join('')}</table>` : '<p class="muted">No saved quotations yet. Save offers from a search comparison.</p>'}</div>`;
  $$('[data-rm]').forEach((b) => { b.onclick = guard(async () => { await api('DELETE', `/api/saved/${b.dataset.rm}`); router(); }); });
  $('#cmp').onclick = () => {
    const sel = $$('[data-sel]:checked').map((c) => rows.find((q) => q.id === Number(c.dataset.sel)));
    if (sel.length < 2) return toast('Select at least two quotations', true);
    const cats = [...new Set(sel.flatMap((q) => q.snapshot.lines.map((l) => l.category)))];
    const cell = (q, c) => { const l = q.snapshot.lines.find((x) => x.category === c); return !l ? '—' : l.inclusion !== 'amount' ? `<i>${l.inclusion}</i>` : l.converted ? fmt(l.converted.min === l.converted.max ? l.converted.min : (l.converted.min + l.converted.max) / 2, 2) : '?'; };
    modal('Saved quotation comparison', `<div class="tbl-wrap"><table><tr><th></th>${sel.map((q) => `<th>${esc(q.snapshot.provider)}<div class="small muted">${esc(MODE[q.snapshot.mode])} · ${esc(q.snapshot.status_label)}</div></th>`).join('')}</tr>
      ${cats.map((c) => `<tr><td>${esc((S.ref.categories.find((x) => x.key === c) || {}).label || c)}</td>${sel.map((q) => `<td class="num">${cell(q, c)}</td>`).join('')}</tr>`).join('')}
      <tr><td><b>Total</b></td>${sel.map((q) => `<td class="num"><b>${money(q.snapshot.total)} ${esc(q.snapshot.total ? q.snapshot.total.currency : '')}</b></td>`).join('')}</tr>
      <tr><td>Transit</td>${sel.map((q) => `<td>${q.snapshot.transit[0] ?? '?'}–${q.snapshot.transit[1] ?? '?'} d</td>`).join('')}</tr><tr><td>Like-for-like</td>${sel.map((q) => `<td>${q.snapshot.comparable ? 'Yes' : 'No — missing ' + esc((q.snapshot.missing || []).join(', '))}</td>`).join('')}</tr></table></div><p class="small muted">Amounts shown in each snapshot's comparison currency at the time of saving. If currencies differ, re-run the searches in one currency.</p>`);
  };
});

// ───────────── Upload documents (Google Drive via Apps Script) ─────────────
route(/^upload$/, async () => {
  if (!S.upload) { location.hash = '#/dashboard'; return; }
  mount('upload', `<div class="top"><div><h1>Upload Documents <span class="muted" dir="rtl" lang="ar">رفع المستندات</span></h1>
    <div class="sub">Send bills, invoices and shipping lists to our team. Each file is saved with today's date in front of its name (dd-mm).</div></div>
    <a class="btn ghost" href="${esc(S.upload)}" target="_blank" rel="noopener">Open in new tab ↗</a></div>
   <div class="card" style="padding:0;overflow:hidden"><iframe class="upframe" src="${esc(S.upload)}" title="Upload documents" allow="clipboard-write"></iframe></div>
   <p class="small muted">If the form doesn't appear (some browsers block embedded Google pages), use <b>Open in new tab</b>.</p>`);
});

// ───────────── Reports ─────────────
route(/^reports$/, async () => {
  mount('reports', '');
  const rows = await api('GET', '/api/searches?limit=200');
  $('#main').innerHTML = `<div class="top"><div><h1>Reports</h1><div class="sub">Professional PDF (print-optimised, use “Save as PDF”) and Excel reports with shipment data, providers, quotations, comparison, transit times, AI recommendations, sources and assumptions.</div></div><select id="rc">${S.ref.currencies.map((c) => `<option ${c === S.ref.base_currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
   <div class="card">${rows.filter((s) => s.status === 'completed').length ? `<table><tr><th>Reference</th><th>Lane</th><th>Results</th>${isOp() ? '<th>Client</th>' : ''}<th>Date</th><th></th></tr>${rows.filter((s) => s.status === 'completed').map((s) => `<tr><td class="mono"><a href="#/search/${s.id}">${esc(s.ref)}</a></td><td>${esc(s.lane)}</td><td>${s.priced_count} priced / ${s.result_count}</td>${isOp() ? `<td>${esc(s.org_name)}</td>` : ''}<td class="small">${dt(s.created_at)}</td><td class="row"><a class="btn sm" data-x="pdf" target="_blank" href="/api/searches/${s.id}/report.html">PDF report</a><a class="btn ghost sm" data-x="xlsx" href="/api/searches/${s.id}/export.xlsx">Excel</a></td></tr>`).join('')}</table>` : '<p class="muted">No completed searches yet.</p>'}</div>`;
  $('#rc').onchange = (e) => { $$('[data-x]').forEach((a) => { a.href = a.href.split('?')[0] + '?currency=' + e.target.value; }); };
});

// ───────────── Account ─────────────
route(/^account$/, async () => {
  mount('account', '');
  const team = ['client_admin', 'admin', 'staff'].includes(S.user.role) ? await api('GET', '/api/org/users') : null;
  $('#main').innerHTML = `<div class="top"><h1>Account</h1></div><div class="grid g2"><div class="card"><h2>Change password</h2><form id="pw"><div class="field"><label>Current password</label><input type="password" name="current_password" required></div><div class="field"><label>New password (min 10 chars, letters + numbers)</label><input type="password" name="new_password" required></div><button>Update password</button></form></div>
   ${team ? `<div class="card"><h2>${esc(S.user.org_name)} — team</h2><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th></tr>${team.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td class="small">${dt(u.last_login)}</td></tr>`).join('')}</table>
   ${S.user.role === 'client_admin' ? `<h3 style="margin-top:12px">Invite team member</h3><form id="nu" class="grid g2"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Initial password" required><select name="role"><option value="client_user">Client user</option><option value="client_admin">Client admin</option></select><button>Add user</button></form>` : ''}</div>` : ''}</div>`;
  $('#pw').onsubmit = guard(async (e) => { e.preventDefault(); await api('POST', '/api/auth/password', Object.fromEntries(new FormData(e.target).entries())); e.target.reset(); toast('Password updated'); });
  if ($('#nu')) $('#nu').onsubmit = guard(async (e) => { e.preventDefault(); await api('POST', '/api/org/users', Object.fromEntries(new FormData(e.target).entries())); toast('User added'); router(); });
});

// ───────────── Administration ─────────────
route(/^admin(?:\/(\w+))?$/, async (tab = 'clients') => {
  if (!isOp()) { location.hash = '#/dashboard'; return; }
  mount('admin', '');
  const TABS = [['clients', 'Users & clients'], ['integrations', 'API integrations'], ['settings', 'Search & currency settings'], ['benchmarks', 'Data sources (benchmarks)'], ['history', 'Search history'], ['audit', 'Audit log'], ['performance', 'System performance']];
  $('#main').innerHTML = `<div class="top"><h1>Administration</h1></div><div class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="adm"><div class="spin"></div></div>`;
  const A = $('#adm');
  if (tab === 'clients') {
    const [orgs, users] = await Promise.all([api('GET', '/api/admin/orgs'), api('GET', '/api/admin/users')]);
    A.innerHTML = `<div class="grid g2"><div class="card"><h2>Organisations</h2><table><tr><th>Name</th><th>Type</th><th>Users</th><th>Searches</th><th>Active</th></tr>${orgs.map((o) => `<tr><td>${esc(o.name)}</td><td>${esc(o.type)}</td><td>${o.users}</td><td>${o.searches}</td><td>${isAdmin() ? `<button class="ghost sm" data-org="${o.id}" data-act="${o.active ? 0 : 1}">${o.active ? 'Active — disable' : 'Disabled — enable'}</button>` : o.active ? 'Yes' : 'No'}</td></tr>`).join('')}</table>
      ${isAdmin() ? `<h3 style="margin-top:12px">Add client organisation</h3><form id="no" class="grid g3"><input name="name" placeholder="Company name" required><input name="country" placeholder="Country ISO-2"><input name="contact_email" placeholder="Contact email"><button>Create client</button></form>` : ''}</div>
      <div class="card"><h2>Users</h2><div class="tbl-wrap" style="max-height:420px"><table><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>Status</th><th>Last login</th></tr>${users.map((u) => `<tr><td>${esc(u.name)}</td><td class="small">${esc(u.email)}</td><td class="small">${esc(u.org_name)}</td><td>${isAdmin() ? `<select data-role="${u.id}">${['admin', 'staff', 'client_admin', 'client_user'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(u.role)}</td><td>${isAdmin() ? `<button class="ghost sm" data-uact="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Active' : 'Disabled'}</button>` : u.active ? 'Active' : 'Disabled'}</td><td class="small">${dt(u.last_login)}</td></tr>`).join('')}</table></div>
      ${isAdmin() ? `<h3 style="margin-top:12px">Create user</h3><form id="nu" class="grid g3"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Initial password (min 10)" required><select name="org_id">${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><select name="role"><option value="client_user">client_user</option><option value="client_admin">client_admin</option><option value="staff">staff (operator)</option><option value="admin">admin (operator)</option></select><button>Create user</button></form>` : ''}</div></div>`;
    $$('[data-org]').forEach((b) => { b.onclick = guard(async () => { await api('PATCH', `/api/admin/orgs/${b.dataset.org}`, { active: b.dataset.act === '1' }); router(); }); });
    $$('[data-role]').forEach((s) => { s.onchange = guard(async () => { await api('PATCH', `/api/admin/users/${s.dataset.role}`, { role: s.value }); toast('Role updated'); }); });
    $$('[data-uact]').forEach((b) => { b.onclick = guard(async () => { await api('PATCH', `/api/admin/users/${b.dataset.uact}`, { active: b.dataset.v === '1' }); router(); }); });
    if ($('#no')) $('#no').onsubmit = guard(async (e) => { e.preventDefault(); await api('POST', '/api/admin/orgs', Object.fromEntries(new FormData(e.target).entries())); router(); });
    if ($('#nu')) $('#nu').onsubmit = guard(async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()); f.org_id = Number(f.org_id); await api('POST', '/api/admin/users', f); toast('User created'); router(); });
  }
  if (tab === 'integrations') {
    const list = await api('GET', '/api/admin/integrations');
    A.innerHTML = `<div class="alert info">Credentials are read only from server environment variables (never from the browser). Set the listed variables in <span class="mono">.env</span> or your host's secret manager and restart the server; the module activates automatically. See <span class="mono">docs/INTEGRATIONS.md</span>.</div>
     <div class="card"><table><tr><th>Integration</th><th>Status</th><th>Produces</th><th>Modes</th><th>Credentials</th><th>Last success</th><th>Calls / failed</th><th>Limitations</th>${isAdmin() ? '<th></th>' : ''}</tr>${list.map((i) => `<tr><td><b>${esc(i.name)}</b><div class="small muted">${esc(i.kind)}${i.docs_url ? ` · <a href="${esc(i.docs_url)}" target="_blank" rel="noopener">docs</a>` : ''}</div></td>
      <td><span class="badge ${i.status === 'active' || i.status === 'ready' ? 'st-VERIFIED_LIVE' : i.status === 'error' ? 'st-AI_ESTIMATE' : i.status === 'disabled' ? '' : 'st-INDICATIVE_ONLINE'}">${esc(i.status.replace(/_/g, ' '))}</span></td><td class="small">${esc(i.data_class)}</td><td class="small">${i.modes.map((m) => MODE[m]).join(', ')}</td>
      <td class="small">${i.env_present.map((e) => `<div class="mono">${e.present ? '✓' : '✗'} ${esc(e.name)}</div>`).join('') || '—'}</td><td class="small">${dt(i.last_success)}${i.last_error ? `<div style="color:var(--err)" title="${esc(i.last_error)}">last error ${dt(i.last_error_at)}</div>` : ''}</td><td>${i.calls_total} / ${i.calls_failed}</td><td class="small">${esc(i.limitations)}</td>
      ${isAdmin() ? `<td><button class="ghost sm" data-int="${i.key}" data-v="${i.enabled ? 0 : 1}">${i.enabled ? 'Disable' : 'Enable'}</button></td>` : ''}</tr>`).join('')}</table></div>`;
    $$('[data-int]').forEach((b) => { b.onclick = guard(async () => { await api('PATCH', `/api/admin/integrations/${b.dataset.int}`, { enabled: b.dataset.v === '1' }); router(); }); });
  }
  if (tab === 'settings') {
    const [st, fxd] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/fx')]);
    const lr = fxd.last_refresh;
    A.innerHTML = `<div class="grid g2"><div class="card"><h2>Search settings</h2><form id="stf">
     <div class="field"><label>Operator / company name</label><input name="operator_name" value="${esc(st.operator_name)}"></div>
     <div class="field"><label>Default comparison currency</label><select name="base_currency">${fxd.rates.map((r) => `<option ${r.code === st.base_currency ? 'selected' : ''}>${r.code}</option>`).join('')}</select></div>
     <div class="field"><label>Strait of Hormuz advisory (route Oman ocean cargo via Sohar/Salalah)</label><select name="hormuz_advisory_active"><option value="true" ${st.hormuz_advisory_active ? 'selected' : ''}>Active</option><option value="false" ${!st.hormuz_advisory_active ? 'selected' : ''}>Inactive</option></select></div>
     <div class="field"><label>Our company operates as a freight forwarder (include airline buy-rates & forwarder-only platforms)</label><select name="operator_is_forwarder"><option value="false" ${!st.operator_is_forwarder ? 'selected' : ''}>No</option><option value="true" ${st.operator_is_forwarder ? 'selected' : ''}>Yes</option></select></div>
     <div class="grid g3">${['price', 'speed', 'reliability'].map((k) => `<div class="field"><label>Default weight — ${k}</label><input name="w_${k}" type="number" step="0.05" min="0" max="1" value="${st.default_weights[k]}"></div>`).join('')}</div>
     ${isAdmin() ? '<button>Save settings</button>' : ''}</form><p class="small muted">AI agent: ${st.ai.enabled ? `enabled (model ${esc(st.ai.model)}, up to ${st.ai.web_research_max_searches} web searches per research run)` : 'disabled — set ANTHROPIC_API_KEY'}.</p></div>
     <div class="card"><h2>Currency rates <span class="small muted">(units per 1 USD)</span></h2><div class="alert ${lr && lr.ok ? 'ok' : 'warn'} small">${lr ? (lr.ok ? `Live refresh OK — rates as of ${dt(lr.asOf)} UTC from ${esc(lr.source)}` : `Last live refresh failed (${esc(lr.error)}) at ${dt(lr.at)} — using stored rates. GCC pegs are official; "fallback:approximate" rates must be refreshed or set manually before commercial use.`) : 'Never refreshed.'}</div>
     ${isAdmin() ? '<button class="ghost sm" id="fxr">Refresh from live source now</button>' : ''}<div class="tbl-wrap" style="max-height:420px;margin-top:8px"><table><tr><th>Code</th><th class="num">Per USD</th><th>Source</th><th>As of</th>${isAdmin() ? '<th></th>' : ''}</tr>${fxd.rates.filter((r) => S.ref.currencies.includes(r.code)).map((r) => `<tr><td>${r.code}</td><td class="num">${r.per_usd}</td><td class="small">${esc(r.source)}</td><td class="small">${dt(r.as_of)}</td>${isAdmin() ? `<td><button class="link" data-fx="${r.code}">set</button></td>` : ''}</tr>`).join('')}</table></div>
     ${S.ref.fx_attribution ? `<p class="small"><a href="${S.ref.fx_attribution.url}" target="_blank" rel="noopener">${esc(S.ref.fx_attribution.text)}</a></p>` : ''}</div></div>`;
    if ($('#stf') && isAdmin()) $('#stf').onsubmit = guard(async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()); await api('PATCH', '/api/admin/settings', { operator_name: f.operator_name, base_currency: f.base_currency, hormuz_advisory_active: f.hormuz_advisory_active === 'true', operator_is_forwarder: f.operator_is_forwarder === 'true', default_weights: { price: +f.w_price, speed: +f.w_speed, reliability: +f.w_reliability } }); S.ref = null; toast('Settings saved'); router(); });
    if ($('#fxr')) $('#fxr').onclick = guard(async () => { const r = await api('POST', '/api/admin/fx/refresh'); toast(r.ok ? 'FX refreshed' : 'Refresh failed: ' + r.error, !r.ok); router(); });
    $$('[data-fx]').forEach((b) => { b.onclick = guard(async () => { const v = prompt(`Units of ${b.dataset.fx} per 1 USD:`); if (!v) return; await api('PUT', `/api/admin/fx/${b.dataset.fx}`, { per_usd: Number(v) }); router(); }); });
  }
  if (tab === 'benchmarks') {
    const list = await api('GET', '/api/admin/benchmarks');
    A.innerHTML = `<div class="alert info">Benchmarks are lane-level scenario models (status <b>Market Benchmark</b> or <b>Historical Price</b>) — never quotations. They apply only within their size band. Seeded from the uploaded research paper (Singapore → Oman, 13 Nov 2026).</div>
     <div class="card"><table><tr><th>Lane</th><th>Mode / service</th><th>Size band</th><th>Charges</th><th>Transit</th><th>Source · as of</th><th></th></tr>${list.map((b) => `<tr><td>${esc(b.origin_country)} → ${esc(b.dest_country)}<div class="small muted">${esc(b.origin_point || '')} → ${esc(b.dest_point || '')}</div></td><td>${esc(MODE[b.mode])}<div class="small muted">${esc(b.service_type || '')} · ${esc(SCOPE[b.scope] || '')}</div></td><td class="small">${b.applies_min_kg != null ? `${b.applies_min_kg}–${b.applies_max_kg} kg` : ''}${b.applies_min_cbm != null ? `${b.applies_min_cbm}–${b.applies_max_cbm} m³` : ''}</td>
      <td class="small">${b.charges.map((c) => `${esc(c.label)}: ${c.inclusion === 'amount' ? `${c.amount_min}–${c.amount_max} ${c.currency} ${c.basis !== 'fixed' ? c.basis : ''}` : c.inclusion}`).join('<br>')}</td><td>${b.transit_min}–${b.transit_max} d</td><td class="small">${esc(b.source_name)}<br>${esc(b.as_of)}</td><td><button class="ghost sm" data-delb="${b.id}">Delete</button></td></tr>`).join('')}</table>
     <details style="margin-top:12px"><summary>Add benchmark (JSON)</summary><p class="small muted">Charge basis: fixed, per_kg_chargeable, per_kg, per_rt, per_cbm, per_container. Inclusion: amount, included, excluded, unknown.</p><textarea id="bj" style="min-height:220px;font-family:monospace">${esc(JSON.stringify({ origin_country: 'CN', dest_country: 'OM', origin_point: 'CNSHA', dest_point: 'OMSOH', mode: 'sea_fcl', service_type: '20GP port-to-port', scope: 'port_to_port', currency: 'USD', transit_min: 20, transit_max: 30, source_name: 'Name of index/report', source_url: 'https://…', as_of: new Date().toISOString().slice(0, 10), status: 'MARKET_BENCHMARK', charges: [{ category: 'freight', label: 'Ocean freight 20GP', basis: 'per_container', amount_min: 0, amount_max: 0, currency: 'USD', inclusion: 'amount' }] }, null, 2))}</textarea><button id="addb">Add benchmark</button></details></div>`;
    $$('[data-delb]').forEach((b) => { b.onclick = guard(async () => { if (!confirm('Delete benchmark?')) return; await api('DELETE', `/api/admin/benchmarks/${b.dataset.delb}`); router(); }); });
    $('#addb').onclick = guard(async () => { let j; try { j = JSON.parse($('#bj').value); } catch { throw new Error('Invalid JSON'); } await api('POST', '/api/admin/benchmarks', j); toast('Benchmark added'); router(); });
  }
  if (tab === 'history') { const rows = await api('GET', '/api/admin/history?limit=300'); A.innerHTML = `<div class="card">${searchTable(rows)}</div>`; bindGo(A); }
  if (tab === 'audit') {
    const rows = await api('GET', '/api/admin/audit?limit=300');
    A.innerHTML = `<div class="card"><div class="tbl-wrap"><table><tr><th>When (UTC)</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr>${rows.map((a) => `<tr><td class="small nowrap">${dt(a.at)}</td><td class="small">${esc(a.email || '—')}</td><td>${esc(a.action)}</td><td class="small">${esc(a.entity || '')} ${esc(a.entity_id || '')}</td><td class="small mono">${esc((a.detail || '').slice(0, 160))}</td></tr>`).join('')}</table></div></div>`;
  }
  if (tab === 'performance') {
    const p = await api('GET', '/api/admin/performance');
    A.innerHTML = `<div class="grid g4">${[['Uptime', Math.round(p.uptime_s / 60) + ' min'], ['Memory (RSS)', p.memory_mb + ' MB'], ['Database', p.db_bytes ? fmt(p.db_bytes / 1048576, 1) + ' MB' : '—'], ['Avg search time', (p.avg_search_s ?? '—') + ' s']].map(([l, v]) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
     <div class="grid g2"><div class="card"><h2>API routes (7 days)</h2><table><tr><th>Route</th><th class="num">Calls</th><th class="num">Errors</th><th class="num">Avg ms</th></tr>${p.routes.map((r) => `<tr><td class="mono">${esc(r.route)}</td><td class="num">${r.count}</td><td class="num">${r.errors}</td><td class="num">${r.avg_ms}</td></tr>`).join('')}</table></div>
     <div class="card"><h2>Integrations health</h2><table><tr><th>Integration</th><th>Status</th><th class="num">Calls</th><th class="num">Failed</th></tr>${p.integrations.map((i) => `<tr><td>${esc(i.key)}</td><td>${esc(i.status)}</td><td class="num">${i.calls_total}</td><td class="num">${i.calls_failed}</td></tr>`).join('')}</table><h3 style="margin-top:12px">Searches by status</h3>${p.searches.map((s) => `<div class="row small"><span>${esc(s.status)}</span><span class="right">${s.c}</span></div>`).join('')}<p class="small muted">Node ${esc(p.node)}</p></div></div>`;
  }
});

router();
})();
