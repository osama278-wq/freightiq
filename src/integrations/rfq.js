'use strict';
// Provider directory + RFQ adapter. For relevant providers that have no active pricing
// integration, it creates "Price Unavailable – Request Required" entries carrying a ready
// RFQ (email draft, quote-portal link). It never attaches a price.
const db = require('../db');
const geo = require('../data/geo');
const { makeResult } = require('./base');

const MODE_LABEL = { air: 'Air freight', express: 'Express courier', sea_lcl: 'Sea freight LCL', sea_fcl: 'Sea freight FCL', road: 'Road freight' };

function rfqText(request, derived, mode, provider) {
  const o = geo.byIso[request.origin_country], d = geo.byIso[request.dest_country];
  const lines = [
    `Dear ${provider.name} team,`, '',
    `Please quote ${MODE_LABEL[mode] || mode} for the following shipment:`, '',
    `• Route: ${request.origin_city ? request.origin_city + ', ' : ''}${o ? o.name : request.origin_country}${request.origin_port ? ' (' + request.origin_port + ')' : ''} → ${request.dest_city ? request.dest_city + ', ' : ''}${d ? d.name : request.dest_country}${request.dest_port ? ' (' + request.dest_port + ')' : ''}`,
    `• Service scope: ${(request.scope || 'please advise').replace(/_/g, ' ')}${request.incoterm ? ' — Incoterm ' + request.incoterm : ''}`,
    `• Cargo: ${request.cargo_description || 'general cargo'}${request.cargo_category ? ' (' + request.cargo_category + ')' : ''}${request.dangerous_goods ? ' — DANGEROUS GOODS' : ''}`,
    `• Packages: ${derived.packages ?? 'tbc'} | Gross weight: ${derived.gross_weight_kg ?? 'tbc'} kg | Volume: ${derived.volume_cbm ?? 'tbc'} m³`,
    mode === 'sea_fcl' ? `• Equipment: ${request.container_count || 1} × ${request.container_type || derived.suggested_container || '20GP'}` : `• Chargeable: air ${derived.air_chargeable_kg ?? '–'} kg (÷6000) | LCL ${derived.lcl_revenue_tons ?? '–'} RT`,
    `• Cargo ready: ${request.ready_date || 'tbc'}${request.preferred_delivery_date ? ' | Required delivery: ' + request.preferred_delivery_date : ''}`,
    `• Customs clearance required: ${request.customs_required === null ? 'please quote separately' : request.customs_required ? 'yes' : 'no'} | Insurance: ${request.insurance_required ? 'yes, value ' + (request.cargo_value || 'tbc') + ' ' + (request.cargo_value_currency || '') : 'no'}`,
    '', 'Please itemise: freight, fuel/security surcharges, origin charges, destination charges (D/O, THC, CFS), customs, delivery, documentation — stating currency, validity, transit time, routing and any exclusions.',
    request.dest_country === 'OM' ? 'For Oman delivery please state destination charges explicitly in OMR and confirm the discharge port (Sohar/Salalah) or UAE routing.' : '',
    '', 'Kind regards',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function relevance(p, request, modes, routes, operatorIsForwarder) {
  if (!p.active || ['platform', 'benchmark'].includes(p.provider_type)) return null;
  if (p.provider_type === 'air_carrier' && !operatorIsForwarder) return null;
  const pm = db.P(p.modes, []);
  const matchModes = modes.filter((m) => pm.includes(m) || (m === 'express' && p.provider_type === 'integrator'));
  if (!matchModes.length) return null;
  if (p.provider_type === 'ocean_carrier' && !matchModes.includes('sea_fcl')) return null;
  const cs = db.P(p.countries_served, []), rs = db.P(p.regions_served, []);
  const lane = routes.filter((r) => r.provider_id === p.id && r.origin_country === request.origin_country && r.dest_country === request.dest_country);
  if (lane.length) return { modes: matchModes, evidence: 'lane_evidenced', evidence_url: lane[0].evidence_url };
  const presence = cs.includes(request.origin_country) || cs.includes(request.dest_country) || (p.hq_country && [request.origin_country, request.dest_country].includes(p.hq_country) && rs.some((r) => !r.startsWith('Global')));
  const omanLink = (request.dest_country === 'OM' || request.origin_country === 'OM') && ['verified', 'reported'].includes(p.oman_presence);
  if (presence || omanLink) return { modes: matchModes, evidence: 'endpoint_presence' };
  const regionHit = rs.includes(geo.regionOf(request.origin_country)) || rs.includes(geo.regionOf(request.dest_country));
  if (regionHit) return { modes: matchModes, evidence: 'regional_presence' };
  if (rs.some((r) => r.startsWith('Global'))) return { modes: matchModes, evidence: 'global_network_claim' };
  return null;
}

const EVIDENCE_TEXT = {
  lane_evidenced: 'Lane coverage evidenced in provider database.',
  endpoint_presence: 'Provider has evidenced presence at origin or destination country; lane-specific service not yet confirmed.',
  regional_presence: 'Provider states presence in the origin/destination region; lane not confirmed.',
  global_network_claim: 'Provider states a global network; coverage of THIS lane is not evidenced — confirm in the RFQ.',
};

module.exports = {
  key: 'provider_rfq', name: 'Provider directory & RFQ generator', kind: 'rfq', modes: ['air', 'express', 'sea_lcl', 'sea_fcl', 'road'],
  docsUrl: null, requiredEnv: [], dataClass: 'UNAVAILABLE_RFQ',
  limitations: 'Creates request-for-quotation actions only. Email sending happens from the user\'s mail client (mailto) — no SMTP relay is configured.',
  isConfigured: () => true,
  supports: () => true,
  async search({ request, derived, modes, pricedProviderSlugs }) {
    const d = db.get();
    const providers = d.prepare('SELECT * FROM providers WHERE active=1').all();
    const routes = d.prepare('SELECT * FROM provider_routes').all();
    const operatorIsForwarder = db.getSetting('operator_is_forwarder', false);
    const out = [];
    const order = { lane_evidenced: 0, endpoint_presence: 1, regional_presence: 2, global_network_claim: 3 };
    const matches = providers.map((p) => ({ p, rel: relevance(p, request, modes, routes, operatorIsForwarder) })).filter((x) => x.rel).sort((a, b) => order[a.rel.evidence] - order[b.rel.evidence]);
    for (const { p, rel } of matches) {
      for (const mode of rel.modes) {
        if (pricedProviderSlugs.has(`${p.slug}:${mode}`)) continue; // a live/indicative price already exists
        const contact = db.P(p.contact, {});
        const body = rfqText(request, derived, mode, p);
        const subject = `RFQ: ${MODE_LABEL[mode]} ${request.origin_country} → ${request.dest_country} | ${derived.gross_weight_kg ?? '?'} kg / ${derived.volume_cbm ?? '?'} m³`;
        out.push(makeResult({
          provider_slug: p.slug, provider_name: p.name, provider_type: p.provider_type, status: 'UNAVAILABLE_RFQ', mode, service_type: MODE_LABEL[mode], scope: request.scope,
          route: { origin_country: request.origin_country, dest_country: request.dest_country, origin: request.origin_port || request.origin_city, destination: request.dest_port || request.dest_city },
          source_name: 'Provider database', source_url: p.website,
          limitations: `${EVIDENCE_TEXT[rel.evidence]} No public/online price available to this application for this provider.`,
          rfq: { method: contact.email ? 'email' : p.online_quote_url ? 'portal' : 'website', email: contact.email || null, quote_url: p.online_quote_url || contact.quote_page || p.website, online_quote: p.online_quote, subject, body, evidence_level: rel.evidence },
        }));
      }
    }
    return out;
  },
  rfqText,
};
