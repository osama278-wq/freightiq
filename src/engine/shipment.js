'use strict';
// Shipment analysis: chargeable weights, density, mode suitability, missing-information
// detection and lane advisories (Oman-specific rules from the uploaded research paper).
const geo = require('../data/geo');
const db = require('../db');

const AIR_DIVISOR = 6000;      // IATA cm³/kg
const EXPRESS_DIVISOR = 5000;  // common courier divisor — contract divisor must be verified
const round = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

const MODES = ['air', 'express', 'sea_lcl', 'sea_fcl', 'road'];
const CONTAINERS = { '20GP': { cbm: 33, kg: 28000 }, '40GP': { cbm: 67, kg: 26500 }, '40HC': { cbm: 76, kg: 26500 }, '20RF': { cbm: 28, kg: 27000 }, '40RH': { cbm: 67, kg: 29000 } };

// Normalise and validate the raw request coming from the form or the AI assistant.
function normalizeRequest(input) {
  const r = { ...input };
  r.origin_country = String(r.origin_country || '').toUpperCase() || null;
  r.dest_country = String(r.dest_country || '').toUpperCase() || null;
  for (const k of ['gross_weight_kg', 'volume_cbm', 'packages', 'cargo_value', 'max_transit_days', 'container_count'])
    r[k] = num(r[k]);
  r.pieces = Array.isArray(r.pieces) ? r.pieces.map((p) => ({ qty: num(p.qty) || 1, length_cm: num(p.length_cm), width_cm: num(p.width_cm), height_cm: num(p.height_cm), weight_kg: num(p.weight_kg), palletized: !!p.palletized, stackable: p.stackable !== false })).filter((p) => p.length_cm || p.weight_kg) : [];
  r.cargo_value_currency = String(r.cargo_value_currency || 'USD').toUpperCase();
  r.shipping_method = ['air', 'sea', 'both'].includes(r.shipping_method) ? r.shipping_method : 'both';
  r.sea_load = ['fcl', 'lcl', 'auto'].includes(r.sea_load) ? r.sea_load : 'auto';
  r.scope = ['door_to_door', 'port_to_port', 'airport_to_airport', 'door_to_port', 'port_to_door'].includes(r.scope) ? r.scope : null;
  r.service_level = ['economy', 'standard', 'express', 'any'].includes(r.service_level) ? r.service_level : 'any';
  r.insurance_required = r.insurance_required === true || r.insurance_required === 'yes';
  r.customs_required = r.customs_required === true || r.customs_required === 'yes' ? true : r.customs_required === false || r.customs_required === 'no' ? false : null;
  r.weights = normalizeWeights(r.weights);
  r.dangerous_goods = r.dangerous_goods === true || r.dangerous_goods === 'yes';
  return r;
}

function normalizeWeights(w) {
  const p = num(w && w.price), s = num(w && w.speed), rl = num(w && w.reliability);
  if (p === null && s === null && rl === null) return { price: 0.5, speed: 0.3, reliability: 0.2 };
  const t = (p || 0) + (s || 0) + (rl || 0) || 1;
  return { price: round((p || 0) / t, 3), speed: round((s || 0) / t, 3), reliability: round((rl || 0) / t, 3) };
}

function deriveMetrics(r) {
  let cbm = r.volume_cbm, kg = r.gross_weight_kg, pieces = r.packages;
  let express_kg_pieces = null;
  const pieceInfo = [];
  if (r.pieces.length) {
    let v = 0, w = 0, n = 0, ex = 0;
    for (const p of r.pieces) {
      const pv = p.length_cm && p.width_cm && p.height_cm ? (p.length_cm * p.width_cm * p.height_cm) / 1e6 : null;
      if (pv) v += pv * p.qty;
      if (p.weight_kg) w += p.weight_kg * p.qty;
      n += p.qty;
      const exVol = pv ? (pv * 1e6) / EXPRESS_DIVISOR : 0;
      ex += Math.max(p.weight_kg || 0, exVol) * p.qty;
      pieceInfo.push({ ...p, cbm: round(pv, 3), density: pv && p.weight_kg ? round(p.weight_kg / pv, 1) : null, overweight: (p.weight_kg || 0) > 70 });
    }
    if (!cbm && v) cbm = v;
    if (!kg && w) kg = w;
    if (!pieces) pieces = n;
    express_kg_pieces = ex;
  }
  const air_vol_kg = cbm ? (cbm * 1e6) / AIR_DIVISOR : null;
  const exp_vol_kg = cbm ? (cbm * 1e6) / EXPRESS_DIVISOR : null;
  const air_chargeable = kg !== null || air_vol_kg !== null ? Math.max(kg || 0, air_vol_kg || 0) : null;
  const express_chargeable = express_kg_pieces || (kg !== null || exp_vol_kg !== null ? Math.max(kg || 0, exp_vol_kg || 0) : null);
  const lcl_rt = cbm !== null || kg !== null ? Math.max(1, cbm || 0, (kg || 0) / 1000) : null;
  const density = cbm && kg ? kg / cbm : null;
  const value_per_kg = r.cargo_value && kg ? r.cargo_value / kg : null;
  let suggested_container = null;
  if (cbm) {
    if (cbm <= 28) suggested_container = '20GP'; else if (cbm <= 58) suggested_container = '40GP'; else if (cbm <= 68) suggested_container = '40HC'; else suggested_container = `${Math.ceil(cbm / 68)}×40HC`;
  }
  return {
    volume_cbm: round(cbm, 3), gross_weight_kg: round(kg, 2), packages: pieces,
    air_volumetric_kg: round(air_vol_kg), air_chargeable_kg: round(air_chargeable), express_volumetric_kg: round(exp_vol_kg), express_chargeable_kg: round(express_chargeable),
    lcl_revenue_tons: round(lcl_rt, 3), density_kg_m3: round(density, 1), value_per_kg: round(value_per_kg, 2), suggested_container,
    divisors: { air: AIR_DIVISOR, express: EXPRESS_DIVISOR, lcl: '1 m³ = 1,000 kg (min 1 RT)' }, pieces: pieceInfo,
  };
}

// Which transport modes should be evaluated for this request.
function candidateModes(r, d) {
  const m = new Set();
  const sameRegionRoad = r.origin_country && r.dest_country && ['GCC'].includes(geo.regionOf(r.origin_country)) && geo.regionOf(r.origin_country) === geo.regionOf(r.dest_country);
  if (r.shipping_method !== 'sea') { m.add('air'); if ((d.express_chargeable_kg || 0) <= 500 || r.service_level === 'express') m.add('express'); }
  if (r.shipping_method !== 'air') {
    if (r.sea_load === 'fcl') m.add('sea_fcl');
    else if (r.sea_load === 'lcl') m.add('sea_lcl');
    else { m.add('sea_lcl'); if ((d.volume_cbm || 0) >= 12 || r.container_type) m.add('sea_fcl'); }
  }
  if (sameRegionRoad) m.add('road');
  return [...m];
}

function missingInfo(r, d, modes) {
  const q = [];
  const ask = (field, question, severity = 'required') => q.push({ field, question, severity });
  if (!r.origin_country) ask('origin_country', 'Which country is the cargo shipping from?');
  if (!r.dest_country) ask('dest_country', 'Which country is the cargo going to?');
  const needsWV = modes.some((m) => ['air', 'express', 'sea_lcl', 'road'].includes(m));
  if (needsWV && d.gross_weight_kg === null) ask('gross_weight_kg', 'What is the total gross weight in kg? It drives air chargeable weight and LCL revenue tons.');
  if (needsWV && d.volume_cbm === null) ask('volume_cbm', 'What is the total volume (CBM) or the piece dimensions (L×W×H cm)? Air and LCL prices cannot be computed without it.');
  if (modes.includes('sea_fcl') && !r.container_type) ask('container_type', `Which container type/size do you need? Based on volume, ${d.suggested_container || '20GP'} looks appropriate.`, 'recommended');
  if (!r.scope) ask('scope', 'Do you need door-to-door, port-to-port or airport-to-airport service? Quotes with different scopes are not comparable.');
  if ((r.scope || '').startsWith('door') && !r.origin_city) ask('origin_city', 'Which city/address is the pickup location?', 'recommended');
  if ((r.scope || '').endsWith('door') && !r.dest_city) ask('dest_city', 'Which city/address is the delivery location?', 'recommended');
  if (!r.ready_date) ask('ready_date', 'When will the cargo be ready for pickup? Quotes and sailings are date-dependent.', 'recommended');
  if (!r.cargo_category) ask('cargo_category', 'What category is the cargo (general, dangerous goods, perishable, temperature-controlled, oversized)?', 'recommended');
  if (r.customs_required === null) ask('customs_required', 'Should the quotes include destination customs clearance?', 'recommended');
  if (r.insurance_required && !r.cargo_value) ask('cargo_value', 'Insurance was requested — what is the declared cargo value?');
  if (!r.incoterm) ask('incoterm', 'Which Incoterm applies (e.g. EXW, FOB, CIF, DAP)? It decides which charges you pay.', 'recommended');
  return q;
}

function advisories(r, d, modes) {
  const out = [];
  const add = (level, title, text, source) => out.push({ level, title, text, source: source || null });
  const PAPER = 'Uploaded research paper (Oman Industrial Freight Optimization, Nov 2026)';
  const hormuz = db.getSetting('hormuz_advisory_active', true);

  if (d.density_kg_m3 !== null && d.density_kg_m3 < 166.67 && modes.includes('air'))
    add('warn', 'Volumetric weight governs air pricing', `Density ${d.density_kg_m3} kg/m³ is below the IATA breakeven (166.67 kg/m³). Air chargeable weight is ${d.air_chargeable_kg} kg vs ${d.gross_weight_kg} kg gross. Consider tighter cartonisation or sea for low-density units.`, PAPER);
  const heavy = d.pieces.filter((p) => p.overweight || p.palletized);
  if (heavy.length && modes.includes('express'))
    add('warn', 'Express courier pallet / overweight penalties', `${heavy.length} piece(s) exceed 70 kg or are palletised. Express integrators apply handling surcharges (e.g. DHL Express Oman 2025 tariff: OMR 125.00 per non-stackable pallet, OMR 8.25 per overweight piece). Repacking into <70 kg cartons, or using air cargo, is usually cheaper.`, 'https://mydhl.express.dhl/content/dam/downloads/om/en/rate-guide/service_and_rate_guide_om_en_2025.pdf.coredownload.pdf');
  if (r.dest_country === 'OM') {
    if (modes.some((m) => m.startsWith('sea'))) {
      add('info', 'Muscat has no commercial container port', 'Port Sultan Qaboos ceased commercial cargo operations in 2014. Sea cargo for Muscat discharges at Sohar or Salalah (inside Oman) or at a UAE port followed by road haulage.', PAPER);
      if (hormuz) add('warn', 'Strait of Hormuz advisory active', 'Default Oman ocean routing to Sohar (OMSOH) or Salalah (OMSLL) — outside the Strait. Jebel Ali and Khalifa Port sit inside it and currently carry diversion/emergency surcharges and congestion risk. (Admins can switch this advisory off in Settings.)', PAPER);
      add('info', 'Maersk Sohar Import Service fee', 'USD 500 per 20\' and USD 1,000 per 40\' container (effective 15 Sep 2026) on Maersk imports into Sohar — check whether FCL quotes include it.', 'https://www.maersk.com/news/articles/2026/08/14/implementation-of-an-import-service-world-to-oman');
    }
    if (modes.includes('air')) add('info', 'Muscat Airport free storage', 'TRANSOM cargo terminal grants 48 hours free storage before OMR 0.022/kg/day. Pre-lodge Bayan declarations before arrival.', 'https://www.transomcargo.om/wp-content/uploads/2025/11/AGENT-CHARGES-Import.pdf');
    add('info', 'Oman landed taxes are separate from freight', 'Customs duty (commonly 5%, some lines 0% — verify the 12-digit GCC code in Bayan) is assessed on CIF; 5% import VAT applies on CIF + duty (generally recoverable for VAT-registered importers). Bayan declaration fee OMR 15; OMR 10 per amendment. Use the landed-cost tool on each offer.', PAPER);
  }
  if (r.origin_country === 'SG' && r.dest_country === 'OM')
    add('info', 'GSFTA preferential origin — check ROI', 'GCC–Singapore FTA (Form No. 1) only removes duty on Singapore-origin content. If SG-origin value × duty rate is under ~USD 60, certificate and documentation costs usually exceed the saving.', PAPER);
  if (d.value_per_kg !== null) {
    if (d.value_per_kg >= 50) add('info', 'High value density favours air', `Cargo value ≈ ${d.value_per_kg} per kg — above the ~50/kg rule of thumb where air freight is often justified.`, 'https://suaidglobal.com/insights/international-shipping-rates-comparison/');
  }
  if (r.dest_country === 'OM' && r.origin_country === 'SG') {
    const kg = d.express_chargeable_kg || 0, cbm = d.volume_cbm || 0;
    let rule = null;
    if (kg && kg < 45) rule = 'Under 45 kg: express courier in cartons is usually cheapest.';
    else if (cbm && cbm < 1.2) rule = '45–180 kg / up to ~1.2 m³: consolidated air often matches or beats LCL once fixed LCL fees are included.';
    else if (cbm && cbm < 15.5) rule = '1.2–15 m³: direct sea LCL to Sohar is the lowest-cost mode in the lane model.';
    else if (cbm) rule = '≥15.5 m³: a 20\' FCL becomes cheaper than LCL on this lane.';
    if (rule) add('info', 'Mode break-even (lane model)', rule, PAPER);
  }
  if (r.dangerous_goods) add('warn', 'Dangerous goods', 'DG cargo needs UN number, class and MSDS. Many spot/online products (e.g. Maersk Spot excluding IMO 1 and 5.1 into Oman) and consolidations will not accept it; expect manual quotations.', null);
  return out;
}

function analyse(input) {
  const r = normalizeRequest(input);
  const d = deriveMetrics(r);
  const modes = candidateModes(r, d);
  return { request: r, derived: { ...d, modes }, missing: missingInfo(r, d, modes), advisories: advisories(r, d, modes) };
}

module.exports = { analyse, normalizeRequest, deriveMetrics, normalizeWeights, MODES, CONTAINERS, AIR_DIVISOR, EXPRESS_DIVISOR, round };
