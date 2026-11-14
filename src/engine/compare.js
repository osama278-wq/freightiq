'use strict';
// Unified comparison model. Every offer is normalised into the same charge categories,
// converted to a common comparison currency (original currency preserved), checked for
// coverage against the requested scope, and scored. Offers whose included services differ
// are explicitly marked "not like-for-like" rather than silently compared.
const fx = require('../fx');
const { round } = require('./shipment');

const CATEGORIES = [
  ['freight', 'Freight'], ['pickup', 'Pickup / pre-carriage'], ['origin', 'Origin charges'], ['destination', 'Destination charges'], ['delivery', 'Delivery / on-carriage'],
  ['fuel', 'Fuel surcharge'], ['security', 'Security surcharge'], ['customs', 'Customs clearance'], ['insurance', 'Insurance'], ['documentation', 'Documentation'], ['other', 'Additional fees'],
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

const STATUS = {
  VERIFIED_LIVE: { label: 'Verified Live Quotation', confidence: 0.95, firm: true, priced: true },
  MANUAL_QUOTE: { label: 'Manual Quotation', confidence: 0.9, firm: true, priced: true },
  INDICATIVE_ONLINE: { label: 'Indicative Online Price', confidence: 0.65, firm: false, priced: true },
  MARKET_BENCHMARK: { label: 'Market Benchmark', confidence: 0.45, firm: false, priced: true },
  HISTORICAL: { label: 'Historical Price', confidence: 0.3, firm: false, priced: true },
  AI_ESTIMATE: { label: 'AI Estimate (unverified)', confidence: 0.2, firm: false, priced: true },
  UNAVAILABLE_RFQ: { label: 'Price Unavailable – Request Required', confidence: 0, firm: false, priced: false },
};

// Categories a quote must cover (amount or explicitly "included") to be like-for-like.
function requiredCategories(request, mode) {
  const req = new Set(['freight']);
  const scope = request.scope || 'port_to_port';
  if (scope.startsWith('door')) { req.add('pickup'); req.add('origin'); }
  if (scope.endsWith('door')) { req.add('destination'); req.add('delivery'); }
  if (['air', 'express'].includes(mode)) req.add('fuel');
  if (request.customs_required) req.add('customs');
  if (request.insurance_required) req.add('insurance');
  return [...req];
}

// Resolve a charge line to a [min,max] amount in its own currency.
function lineAmount(ch, derived, mode) {
  if (ch.inclusion !== 'amount') return null;
  let min = ch.amount_min ?? ch.amount, max = ch.amount_max ?? ch.amount;
  if (min === null || min === undefined) return null;
  if (max === null || max === undefined) max = min;
  let qty = 1;
  if (ch.basis === 'per_kg_chargeable') qty = mode === 'express' ? derived.express_chargeable_kg : derived.air_chargeable_kg;
  else if (ch.basis === 'per_kg') qty = derived.gross_weight_kg;
  else if (ch.basis === 'per_rt') qty = derived.lcl_revenue_tons;
  else if (ch.basis === 'per_cbm') qty = derived.volume_cbm;
  else if (ch.basis === 'per_container') qty = ch.quantity || 1;
  else if (ch.basis === 'per_piece') qty = derived.packages;
  if (qty === null || qty === undefined) return { unresolved: true };
  let lo = min * qty, hi = max * qty;
  if (ch.minimum_charge) { lo = Math.max(lo, ch.minimum_charge); hi = Math.max(hi, ch.minimum_charge); }
  return { min: lo, max: hi, qty };
}

function evaluateResult(result, search, baseCurrency) {
  const request = search.request, derived = search.derived;
  const st = STATUS[result.status] || STATUS.AI_ESTIMATE;
  const lines = [];
  const covered = new Set(), excluded = new Set(), unknown = new Set();
  let min = 0, max = 0, hasPrice = false;
  const fxNotes = new Set();
  for (const ch of result.charges || []) {
    const cur = ch.currency || result.currency || 'USD';
    const amt = lineAmount(ch, derived, result.mode);
    let conv = null;
    if (amt && !amt.unresolved) {
      try {
        const a = fx.convert(amt.min, cur, baseCurrency), b = fx.convert(amt.max, cur, baseCurrency);
        conv = { min: a.value, max: b.value, rate: a.rate };
        fxNotes.add(`${cur}→${baseCurrency} @ ${round(a.rate, 6)} (${a.basis})`);
        min += conv.min; max += conv.max; hasPrice = true; covered.add(ch.category);
      } catch (e) { unknown.add(ch.category); fxNotes.add(`FX unavailable for ${cur}`); }
    } else if (ch.inclusion === 'included') covered.add(ch.category);
    else if (ch.inclusion === 'excluded') excluded.add(ch.category);
    else unknown.add(ch.category);
    lines.push({ ...ch, currency: cur, original: amt && !amt.unresolved ? { min: round(amt.min), max: round(amt.max), qty: amt.qty } : null, converted: conv ? { min: round(conv.min), max: round(conv.max) } : null, unresolved: !!(amt && amt.unresolved) });
  }
  const required = requiredCategories(request, result.mode);
  const missingRequired = required.filter((c) => !covered.has(c));
  for (const c of missingRequired) if (!excluded.has(c)) unknown.add(c);
  const comparable = st.priced && hasPrice && missingRequired.length === 0;
  const now = new Date();
  const expired = result.validity_to ? new Date(result.validity_to) < now : false;
  const ageDays = (now - new Date(result.retrieved_at)) / 86400000;
  let confidence = st.confidence * (comparable ? 1 : 0.7) * (expired ? 0.5 : 1) * (ageDays > 30 ? 0.8 : 1);
  if (result.provider && result.provider.reliability_rating) confidence *= 0.7 + 0.06 * result.provider.reliability_rating; // rating 0–5 (admin-entered)
  const flags = [];
  if (expired) flags.push('Quotation validity has expired');
  if (ageDays > 30) flags.push(`Price data is ${Math.round(ageDays)} days old`);
  if (!st.priced) flags.push('No price — quotation must be requested');
  if (missingRequired.length) flags.push(`Does not cover requested scope: ${missingRequired.map((c) => CATEGORY_LABEL[c]).join(', ')}`);
  if (result.status === 'AI_ESTIMATE') flags.push('AI estimate — not a quotation');
  return {
    status_label: st.label, firm: st.firm, priced: st.priced && hasPrice,
    total: hasPrice ? { min: round(min), max: round(max), mid: round((min + max) / 2), currency: baseCurrency, is_range: Math.abs(max - min) > 0.005 } : null,
    comparable, required_categories: required, missing_required: missingRequired,
    excluded: [...excluded], unknown: [...unknown], lines, fx: [...fxNotes],
    confidence: round(confidence, 2), expired, flags,
  };
}

const norm = (v, lo, hi) => (hi - lo < 1e-9 ? 0 : (v - lo) / (hi - lo));

function deadlineCheck(request, r) {
  if (!request.preferred_delivery_date || !request.ready_date || r.transit_max === null || r.transit_max === undefined) return null;
  const eta = new Date(request.ready_date); eta.setDate(eta.getDate() + Number(r.transit_max));
  return eta <= new Date(request.preferred_delivery_date);
}

function describe(r, ev, reason, extra = {}) {
  const adv = [], dis = [], unc = [...ev.flags];
  if (ev.firm) adv.push('Firm price (live or written quotation)'); else if (ev.priced) dis.push(`${ev.status_label} — confirm with a written quotation before booking`);
  if (ev.comparable) adv.push('Covers the full requested scope'); else if (ev.priced) dis.push('Coverage differs from requested scope — totals are not like-for-like');
  if (r.transit_max !== null && r.transit_max !== undefined && r.transit_max <= 6) adv.push(`Fast transit (${r.transit_min}–${r.transit_max} days)`);
  if (ev.total && ev.total.is_range) unc.push(`Price range ${ev.total.min}–${ev.total.max} ${ev.total.currency}`);
  if (ev.excluded.length) unc.push(`Excluded: ${ev.excluded.map((c) => CATEGORY_LABEL[c] || c).join(', ')}`);
  if (ev.unknown.length) unc.push(`Unknown/unstated: ${ev.unknown.map((c) => CATEGORY_LABEL[c] || c).join(', ')}`);
  if (r.limitations) unc.push(r.limitations);
  if (extra.deadline === false) dis.push('Estimated arrival misses the preferred delivery date');
  return {
    result_id: r.id, provider: r.provider_name, provider_type: r.provider_type, mode: r.mode, service_type: r.service_type, scope: r.scope,
    total: ev.total, transit: { min: r.transit_min, max: r.transit_max }, route: r.route, status: r.status, status_label: ev.status_label,
    advantages: adv, disadvantages: dis, uncertainties: [...new Set(unc)], source: { name: r.source_name, url: r.source_url, retrieved_at: r.retrieved_at },
    confidence: ev.confidence, why: reason, ...extra,
  };
}

// Pick from tiers: firm+comparable → comparable → any priced.
function tiered(pool, pick) {
  const tiers = [
    ['firm comparable quotations', pool.filter((x) => x.ev.firm && x.ev.comparable)],
    ['comparable prices (indicative/benchmark)', pool.filter((x) => x.ev.comparable)],
    ['all priced options (coverage differs)', pool],
  ];
  for (const [label, t] of tiers) if (t.length) return { item: pick(t), tier: label };
  return null;
}

function recommend(results, search) {
  const request = search.request;
  const w = request.weights || { price: 0.5, speed: 0.3, reliability: 0.2 };
  const pool = results.filter((x) => x.ev.priced && x.ev.total);
  const recs = {};
  const tierNote = (t) => (t === 'firm comparable quotations' ? '' : ` Selected from ${t} because no firmer option exists — treat as provisional.`);

  const ch = tiered(pool, (t) => t.slice().sort((a, b) => a.ev.total.mid - b.ev.total.mid)[0]);
  if (ch) recs.cheapest = describe(ch.item.r, ch.item.ev, `Lowest total (${ch.item.ev.total.mid} ${ch.item.ev.total.currency}) among ${ch.tier}.${tierNote(ch.tier)}`, { tier: ch.tier });

  const timed = pool.filter((x) => x.r.transit_max !== null && x.r.transit_max !== undefined);
  const fa = tiered(timed, (t) => t.slice().sort((a, b) => a.r.transit_max - b.r.transit_max || a.r.transit_min - b.r.transit_min || a.ev.total.mid - b.ev.total.mid)[0]);
  if (fa) recs.fastest = describe(fa.item.r, fa.item.ev, `Shortest estimated transit (${fa.item.r.transit_min}–${fa.item.r.transit_max} days) among ${fa.tier}.${tierNote(fa.tier)}`, { tier: fa.tier });

  // Weighted value score across priced options with transit information.
  const scored = timed.length ? timed : pool;
  if (scored.length) {
    const prices = scored.map((x) => x.ev.total.mid), times = scored.map((x) => x.r.transit_max ?? 0);
    const pLo = Math.min(...prices), pHi = Math.max(...prices), tLo = Math.min(...times), tHi = Math.max(...times);
    for (const x of scored) {
      const priceScore = 1 - norm(x.ev.total.mid, pLo, pHi);
      const speedScore = 1 - norm(x.r.transit_max ?? tHi, tLo, tHi);
      const relScore = x.ev.confidence;
      x.score = round(w.price * priceScore + w.speed * speedScore + w.reliability * relScore, 4);
      x.breakdown = { price: round(priceScore, 3), speed: round(speedScore, 3), reliability: round(relScore, 3) };
      x.deadline = deadlineCheck(request, x.r);
      x.recScore = x.score * (x.ev.comparable ? 1 : 0.75) * (x.deadline === false ? 0.6 : 1) + (x.ev.firm ? 0.1 : 0);
    }
    const bv = scored.slice().sort((a, b) => b.score - a.score)[0];
    recs.best_value = describe(bv.r, bv.ev, `Highest weighted score ${bv.score} (price ${Math.round(w.price * 100)}% · speed ${Math.round(w.speed * 100)}% · reliability ${Math.round(w.reliability * 100)}%). Component scores — price ${bv.breakdown.price}, speed ${bv.breakdown.speed}, reliability/confidence ${bv.breakdown.reliability}.`, { score: bv.score, breakdown: bv.breakdown });
    const rc = scored.slice().sort((a, b) => b.recScore - a.recScore)[0];
    const why = [`Best fit to your requirements (fit score ${round(rc.recScore, 3)}).`];
    if (rc.ev.firm) why.push('It is a firm price.'); else why.push('No firm quotation scored higher; request a written quote from this provider before booking.');
    if (rc.deadline === true) why.push('Arrives before the preferred delivery date.');
    if (rc.deadline === false) why.push('Warning: may miss the preferred delivery date.');
    if (!rc.ev.comparable) why.push('Coverage differs from the requested scope — add the missing charges before deciding.');
    if (request.max_transit_days && rc.r.transit_max > request.max_transit_days) why.push(`Exceeds required transit time (${request.max_transit_days} days).`);
    recs.recommended = describe(rc.r, rc.ev, why.join(' '), { score: round(rc.recScore, 4), deadline_ok: rc.deadline });
  }
  const unpriced = results.filter((x) => !x.ev.priced).length;
  return { weights: w, recommendations: recs, notes: [
    pool.length ? null : 'No priced options yet. Request quotations from the listed providers or enter received quotes manually.',
    unpriced ? `${unpriced} provider(s) do not publish prices for this request — use the RFQ actions to obtain quotations.` : null,
  ].filter(Boolean) };
}

// Landed cost for an offer (destination import taxes). Duty & VAT rates default to Oman's
// common 5%/5%, and must be confirmed for the 12-digit tariff line.
function landedCost({ goodsValue, goodsCurrency = 'USD', freightTotal, freightCurrency = 'USD', insurance = null, dutyRate = 0.05, vatRate = 0.05, fixedFees = 0, baseCurrency = 'USD' }) {
  const g = fx.convert(goodsValue, goodsCurrency, baseCurrency).value;
  const f = fx.convert(freightTotal, freightCurrency, baseCurrency).value;
  const ins = insurance !== null ? insurance : g * 0.004; // 0.4% indicative cargo insurance (paper)
  const cif = g + f + ins;
  const duty = cif * dutyRate, vat = (cif + duty) * vatRate;
  return { currency: baseCurrency, goods: round(g), freight: round(f), insurance: round(ins), insurance_assumed: insurance === null, cif: round(cif), duty: round(duty), duty_rate: dutyRate, vat: round(vat), vat_rate: vatRate, vat_note: 'Import VAT is generally recoverable as input tax for VAT-registered importers.', fixed_fees: round(fixedFees), landed_total: round(cif + duty + vat + fixedFees) };
}

module.exports = { CATEGORIES, CATEGORY_LABEL, STATUS, evaluateResult, recommend, requiredCategories, landedCost };
