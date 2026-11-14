'use strict';
// Report builders: Excel workbook and print-optimised HTML (browser "Save as PDF").
const geo = require('../data/geo');
const compare = require('../engine/compare');
const { workbook } = require('./xlsx');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (t) => (!t ? '—' : t.is_range ? `${t.min.toLocaleString('en-US')}–${t.max.toLocaleString('en-US')}` : t.mid.toLocaleString('en-US'));
const cname = (iso) => (geo.byIso[iso] ? geo.byIso[iso].name : iso || '—');
const MODE = { air: 'Air freight', express: 'Express', sea_lcl: 'Sea LCL', sea_fcl: 'Sea FCL', road: 'Road' };
const REC_LABEL = { cheapest: 'Cheapest option', fastest: 'Fastest option', best_value: 'Best value', recommended: 'Recommended' };

function excel(view) {
  const s = view.search, r = s.request, d = s.derived, cur = view.currency;
  const summary = [
    ['Field', 'Value'], ['Report', `Freight comparison ${s.ref}`], ['Generated (UTC)', new Date().toISOString()], ['Client', s.org_name], ['Search date', s.created_at],
    ['Origin', `${r.origin_city || ''} ${cname(r.origin_country)} ${r.origin_port || ''}`.trim()], ['Destination', `${r.dest_city || ''} ${cname(r.dest_country)} ${r.dest_port || ''}`.trim()],
    ['Cargo', r.cargo_description || ''], ['Category', r.cargo_category || ''], ['Packages', d.packages], ['Gross weight (kg)', d.gross_weight_kg], ['Volume (m³)', d.volume_cbm],
    ['Air chargeable (kg, ÷6000)', d.air_chargeable_kg], ['Express chargeable (kg, ÷5000)', d.express_chargeable_kg], ['LCL revenue tons', d.lcl_revenue_tons], ['Density (kg/m³)', d.density_kg_m3],
    ['Cargo value', r.cargo_value ? `${r.cargo_value} ${r.cargo_value_currency}` : ''], ['Scope', r.scope || ''], ['Incoterm', r.incoterm || ''], ['Ready date', r.ready_date || ''], ['Preferred delivery', r.preferred_delivery_date || ''],
    ['Comparison currency', cur], ['Weights (price/speed/reliability)', `${r.weights.price}/${r.weights.speed}/${r.weights.reliability}`],
  ];
  const comp = [['#', 'Provider', 'Provider type', 'Status', 'Mode', 'Service', 'Scope', `Total min (${cur})`, `Total max (${cur})`, 'Original currency', 'Like-for-like', 'Missing scope', 'Excluded', 'Unknown', 'Transit min (d)', 'Transit max (d)', 'Valid until', 'Confidence', 'Source', 'Source URL', 'Retrieved (UTC)', 'Limitations']];
  for (const x of view.results) {
    const e = x.evaluation;
    comp.push([x.id, x.provider_name, x.provider_type, e.status_label, MODE[x.mode] || x.mode, x.service_type, x.scope, e.total ? e.total.min : null, e.total ? e.total.max : null, x.currency, e.comparable ? 'Yes' : 'No',
      e.missing_required.map((c) => compare.CATEGORY_LABEL[c]).join(', '), e.excluded.join(', '), e.unknown.join(', '), x.transit_min, x.transit_max, x.validity_to, e.confidence, x.source_name, x.source_url, x.retrieved_at, x.limitations]);
  }
  const lines = [['Result #', 'Provider', 'Category', 'Label', 'Inclusion', 'Basis', 'Qty', 'Original min', 'Original max', 'Original currency', `Converted min (${cur})`, `Converted max (${cur})`]];
  for (const x of view.results) for (const l of x.evaluation.lines) lines.push([x.id, x.provider_name, compare.CATEGORY_LABEL[l.category] || l.category, l.label, l.inclusion, l.basis, l.original ? l.original.qty : null, l.original ? l.original.min : null, l.original ? l.original.max : null, l.currency, l.converted ? l.converted.min : null, l.converted ? l.converted.max : null]);
  const recs = [['Recommendation', 'Provider', 'Mode', `Total (${cur})`, 'Transit (days)', 'Status', 'Confidence', 'Why', 'Advantages', 'Disadvantages', 'Uncertainties', 'Source']];
  for (const [k, v] of Object.entries(view.recommendations)) recs.push([REC_LABEL[k], v.provider, MODE[v.mode], money(v.total), `${v.transit.min ?? '?'}–${v.transit.max ?? '?'}`, v.status_label, v.confidence, v.why, v.advantages.join('; '), v.disadvantages.join('; '), v.uncertainties.join('; '), `${v.source.name || ''} ${v.source.url || ''}`]);
  const src = [['Source', 'Outcome', 'Message', 'Checked at (UTC)']];
  for (const l of s.sources_log) src.push([l.name, l.outcome, l.message, l.at]);
  src.push([], ['Assumptions & advisories'], ...s.advisories.map((a) => [a.title, a.level, a.text, a.source || '']));
  src.push([], ['FX basis'], ...[...new Set(view.results.flatMap((x) => x.evaluation.fx))].map((f) => [f]));
  src.push([], ['Status definitions'], ...Object.values(compare.STATUS).map((x) => [x.label, x.firm ? 'firm price' : x.priced ? 'not firm' : 'no price']));
  return workbook([
    { name: 'Shipment', rows: summary, widths: [34, 70] },
    { name: 'Comparison', rows: comp, widths: [6, 32, 14, 26, 12, 30, 16, 14, 14, 10, 10, 30, 22, 22, 9, 9, 14, 10, 40, 50, 22, 60] },
    { name: 'Charge lines', rows: lines, widths: [9, 32, 22, 44, 11, 18, 8, 12, 12, 10, 14, 14] },
    { name: 'Recommendations', rows: recs, widths: [18, 30, 12, 18, 12, 26, 10, 70, 50, 50, 60, 50] },
    { name: 'Sources & assumptions', rows: src, widths: [40, 22, 90, 24] },
  ]);
}

function html(view, { shared = false } = {}) {
  const s = view.search, r = s.request, d = s.derived, cur = view.currency;
  const priced = view.results.filter((x) => x.evaluation.priced).sort((a, b) => a.evaluation.total.mid - b.evaluation.total.mid);
  const rfq = view.results.filter((x) => !x.evaluation.priced);
  const badge = (st) => `<span class="b b-${esc(st)}">${esc(compare.STATUS[st] ? compare.STATUS[st].label : st)}</span>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Freight comparison ${esc(s.ref)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--ink:#0f2233;--mut:#5b6b7a;--line:#d9e1e8;--acc:#0f3d5e}*{box-sizing:border-box}body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);margin:0;background:#fff}
.page{max-width:1100px;margin:0 auto;padding:28px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:26px 0 8px;color:var(--acc);border-bottom:2px solid var(--acc);padding-bottom:4px}
.meta{color:var(--mut)}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}th{background:#f3f6f9;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kv{border:1px solid var(--line);border-radius:6px;padding:8px}.kv b{display:block;font-size:11px;color:var(--mut);font-weight:500}
.rec{border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:6px;padding:10px;margin:8px 0;break-inside:avoid}.b{display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;background:#eef2f6}
.b-VERIFIED_LIVE{background:#dff5e7;color:#0c6b35}.b-MANUAL_QUOTE{background:#e1effc;color:#0b4f8a}.b-INDICATIVE_ONLINE{background:#fff3d6;color:#7a5300}.b-MARKET_BENCHMARK{background:#f1e8fb;color:#5a2d8c}.b-HISTORICAL{background:#eee;color:#555}.b-AI_ESTIMATE{background:#fde2e1;color:#8a1c17}.b-UNAVAILABLE_RFQ{background:#f6f6f6;color:#666}
.warn{color:#8a4b00}.num{text-align:right;white-space:nowrap}.small{font-size:11px;color:var(--mut)}.toolbar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:10px}
button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer}@media print{.toolbar{display:none}.page{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}
@page{size:A4 landscape;margin:12mm}
</style></head><body><div class="page">
<div class="toolbar"><button id="printBtn">Print / Save as PDF</button> <span class="small">${shared ? 'Shared read-only report' : ''}</span></div>
<h1>Freight price comparison — ${esc(s.ref)}</h1>
<div class="meta">Client: ${esc(s.org_name)} · Search date ${esc(s.created_at.slice(0, 16).replace('T', ' '))} UTC · Report generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Comparison currency ${esc(cur)}</div>
<h2>Shipment</h2><div class="grid">
<div class="kv"><b>Origin</b>${esc([r.origin_city, cname(r.origin_country), r.origin_port].filter(Boolean).join(' · '))}</div>
<div class="kv"><b>Destination</b>${esc([r.dest_city, cname(r.dest_country), r.dest_port].filter(Boolean).join(' · '))}</div>
<div class="kv"><b>Weight / volume</b>${esc(d.gross_weight_kg ?? '—')} kg · ${esc(d.volume_cbm ?? '—')} m³ · ${esc(d.packages ?? '—')} pkgs</div>
<div class="kv"><b>Chargeable</b>Air ${esc(d.air_chargeable_kg ?? '—')} kg · Express ${esc(d.express_chargeable_kg ?? '—')} kg · LCL ${esc(d.lcl_revenue_tons ?? '—')} RT</div>
<div class="kv"><b>Cargo</b>${esc(r.cargo_description || '—')} ${r.cargo_category ? '(' + esc(r.cargo_category) + ')' : ''}</div>
<div class="kv"><b>Scope / Incoterm</b>${esc((r.scope || '—').replace(/_/g, ' '))} / ${esc(r.incoterm || '—')}</div>
<div class="kv"><b>Ready / required by</b>${esc(r.ready_date || '—')} / ${esc(r.preferred_delivery_date || '—')}</div>
<div class="kv"><b>Value</b>${r.cargo_value ? esc(r.cargo_value + ' ' + r.cargo_value_currency) : '—'}</div></div>
<h2>AI recommendations</h2>
${Object.entries(view.recommendations).map(([k, v]) => `<div class="rec"><b>${REC_LABEL[k]}:</b> ${esc(v.provider)} — ${esc(MODE[v.mode] || v.mode)} · <b>${money(v.total)} ${esc(cur)}</b> · ${esc(v.transit.min ?? '?')}–${esc(v.transit.max ?? '?')} days · ${badge(v.status)} · confidence ${Math.round(v.confidence * 100)}%
<div>${esc(v.why)}</div><div class="small">+ ${esc(v.advantages.join('; ') || '—')}<br>− ${esc(v.disadvantages.join('; ') || '—')}<br>? ${esc(v.uncertainties.join('; ') || '—')}<br>Source: ${esc(v.source.name || '')} ${v.source.url ? '· ' + esc(v.source.url) : ''}</div></div>`).join('') || '<p>No priced options available yet.</p>'}
${view.notes.map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
<h2>Price comparison (${esc(cur)})</h2>
<table><thead><tr><th>#</th><th>Provider</th><th>Status</th><th>Mode / service</th><th class="num">Total</th><th>Transit</th><th>Like-for-like</th><th>Excluded / unknown</th><th>Valid until</th><th>Source · retrieved</th></tr></thead><tbody>
${priced.map((x) => { const e = x.evaluation; return `<tr><td>${x.id}</td><td>${esc(x.provider_name)}<div class="small">${esc(x.provider_type || '')}</div></td><td>${badge(x.status)}</td><td>${esc(MODE[x.mode])}<div class="small">${esc(x.service_type || '')} · ${esc((x.scope || '').replace(/_/g, ' '))}</div></td><td class="num">${money(e.total)}</td><td>${esc(x.transit_min ?? '?')}–${esc(x.transit_max ?? '?')} d</td><td>${e.comparable ? 'Yes' : '<span class="warn">No — missing ' + esc(e.missing_required.map((c) => compare.CATEGORY_LABEL[c]).join(', ')) + '</span>'}</td><td class="small">${esc([...e.excluded.map((c) => 'excl: ' + c), ...e.unknown.map((c) => '?: ' + c)].join(', ') || '—')}</td><td>${esc(x.validity_to || '—')}</td><td class="small">${esc(x.source_name || '')}${x.source_url ? '<br>' + esc(x.source_url) : ''}<br>${esc((x.retrieved_at || '').slice(0, 16))}</td></tr>`; }).join('') || '<tr><td colspan="10">No priced options.</td></tr>'}
</tbody></table>
<h2>Providers requiring a quotation request</h2>
<table><thead><tr><th>Provider</th><th>Type</th><th>Mode</th><th>How to request</th><th>Coverage evidence</th></tr></thead><tbody>
${rfq.map((x) => `<tr><td>${esc(x.provider_name)}</td><td>${esc(x.provider_type)}</td><td>${esc(MODE[x.mode])}</td><td class="small">${esc(x.rfq ? (x.rfq.email || x.rfq.quote_url || '') : '')}</td><td class="small">${esc(x.limitations || '')}</td></tr>`).join('') || '<tr><td colspan="5">—</td></tr>'}
</tbody></table>
<h2>Sources searched</h2>
<table><thead><tr><th>Source</th><th>Outcome</th><th>Detail</th><th>Checked (UTC)</th></tr></thead><tbody>${s.sources_log.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.outcome)}</td><td class="small">${esc(l.message)}</td><td class="small">${esc((l.at || '').slice(0, 16))}</td></tr>`).join('')}</tbody></table>
<h2>Assumptions & advisories</h2><ul>${s.advisories.map((a) => `<li><b>${esc(a.title)}.</b> ${esc(a.text)} ${a.source ? '<span class="small">[' + esc(a.source) + ']</span>' : ''}</li>`).join('')}
<li>Chargeable weight: air = max(gross, m³×1,000,000÷6000); express = max(gross, ÷5000 — verify contract divisor); LCL = max(1, m³, tonnes).</li>
<li>FX: ${esc([...new Set(view.results.flatMap((x) => x.evaluation.fx))].join(' · ') || 'single currency')}. Original currencies are preserved in the Excel export.</li>
<li>Only "Verified Live Quotation" and "Manual Quotation" are firm prices. Benchmarks, indicative and historical prices must be confirmed before booking.</li></ul>
</div><script src="/print.js"></script></body></html>`;
}

module.exports = { excel, html };
