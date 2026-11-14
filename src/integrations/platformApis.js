'use strict';
// Freight platform & market-data adapters. Freightos estimator is implemented end-to-end;
// enterprise platforms whose API contracts are only issued after commercial onboarding are
// provided as activation-ready modules: they register, report status, and explain exactly
// what is needed — they do not pretend to search.
const config = require('../config');
const { makeResult, fetchJson } = require('./base');

const freightos = {
  key: 'freightos_estimator', name: 'Freightos — Freight Rate Estimator', kind: 'platform_api', providerSlug: 'freightos', modes: ['air', 'sea_lcl', 'sea_fcl', 'express'],
  docsUrl: 'https://developer.freightos.com', requiredEnv: ['FREIGHTOS_API_KEY'], dataClass: 'INDICATIVE_ONLINE',
  limitations: 'Returns min–max price and transit ranges derived from Freightos marketplace and historical data — indicative, not bookable. Charge coverage is not itemised, so these results are never treated as like-for-like with itemised quotes.',
  isConfigured: () => !!config.integrations.freightos.apiKey,
  supports: (r, d) => (d.gross_weight_kg && (r.origin_port || r.origin_city) && (r.dest_port || r.dest_city) ? true : 'weight and origin/destination city or port required'),
  async search({ request, derived, modes }) {
    const c = config.integrations.freightos;
    const p = derived.pieces[0] || {};
    const q = new URLSearchParams({ loadtype: 'boxes', weight: String(Math.ceil(derived.gross_weight_kg / (derived.packages || 1))), quantity: String(derived.packages || 1),
      width: String(p.width_cm || 100), length: String(p.length_cm || 120), height: String(p.height_cm || 100),
      origin: request.origin_port || `${request.origin_city}, ${request.origin_country}`, destination: request.dest_port || `${request.dest_city}, ${request.dest_country}`, format: 'json', apiKey: c.apiKey });
    const j = await fetchJson(`${c.baseUrl.replace(/\/$/, '')}/api/shippingCalculator?${q}`);
    const est = (j.response && j.response.estimatedFreightRates) || j.estimatedFreightRates || {};
    const list = Array.isArray(est.mode) ? est.mode : est.mode ? [est.mode] : [];
    const map = { air: 'air', LCL: 'sea_lcl', FCL: 'sea_fcl', express: 'express', ocean: 'sea_lcl' };
    return list.map((m) => {
      const mode = map[m.mode] || null;
      const lo = m.price && m.price.min && m.price.min.moneyAmount, hi = m.price && m.price.max && m.price.max.moneyAmount;
      if (!mode || !modes.includes(mode) || !lo || lo.amount == null) return null;
      return makeResult({ provider_slug: 'freightos', provider_name: 'Freightos marketplace estimate', provider_type: 'platform', status: 'INDICATIVE_ONLINE', mode, service_type: `Freightos estimate (${m.mode})`, scope: null,
        currency: lo.currency || 'USD', charges: [{ category: 'freight', label: 'Estimated freight (min–max)', basis: 'fixed', amount_min: Number(lo.amount), amount_max: Number((hi || lo).amount), currency: lo.currency || 'USD', inclusion: 'amount' }],
        transit_min: m.transitTimes && m.transitTimes.min, transit_max: m.transitTimes && m.transitTimes.max, route: { origin: q.get('origin'), destination: q.get('destination') },
        source_name: 'Freightos Freight Rate Estimator API', source_url: freightos.docsUrl, limitations: freightos.limitations });
    }).filter(Boolean);
  },
};

// Activation-ready modules. `isConfigured` requires both key and base URL (issued on onboarding).
function pending(o) {
  return {
    kind: 'platform_api', ...o,
    isConfigured: () => !!(o.cfg().apiKey && o.cfg().baseUrl),
    supports: () => true,
    async search() {
      throw new Error(`${o.name}: credentials present but the request/response mapping must be completed against the vendor sandbox contract issued at onboarding (see docs/INTEGRATIONS.md → ${o.key}). No search was performed.`);
    },
  };
}

const searates = pending({ key: 'searates_logistics_explorer', name: 'SeaRates — Logistics Explorer API', providerSlug: 'searates', modes: ['sea_fcl', 'sea_lcl', 'air', 'road'], cfg: () => config.integrations.searates,
  docsUrl: 'https://docs.searates.com', requiredEnv: ['SEARATES_API_KEY', 'SEARATES_BASE_URL'], dataClass: 'INDICATIVE_ONLINE',
  limitations: 'Forwarder rates published on SeaRates RMS (commonly updated monthly) — indicative unless booked. GraphQL endpoint (rates.searates.com/graphql); schema fields depend on plan.' });
const xeneta = pending({ key: 'xeneta_market', name: 'Xeneta — Ocean & Air market rates API', providerSlug: 'xeneta', modes: ['sea_fcl', 'air'], cfg: () => config.integrations.xeneta,
  docsUrl: 'https://help.xeneta.com/reference', requiredEnv: ['XENETA_API_KEY', 'XENETA_BASE_URL'], dataClass: 'MARKET_BENCHMARK',
  limitations: 'Market intelligence (benchmarks, spreads) for subscribed customers; never bookable. Requires Xeneta geographic codes for origin/destination.' });
const hapag = pending({ key: 'hapag_quick_quotes', name: 'Hapag-Lloyd — Quick Quotes API', providerSlug: 'hapag-lloyd', modes: ['sea_fcl'], cfg: () => ({ apiKey: config.integrations.hapag.clientId, baseUrl: config.integrations.hapag.baseUrl }),
  docsUrl: 'https://www.hapag-lloyd.com/en/online-business/api.html', requiredEnv: ['HLAG_CLIENT_ID', 'HLAG_CLIENT_SECRET', 'HLAG_BASE_URL'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Binding container quotes for Hapag-Lloyd customers after API Developer Portal approval.' });
const cargoone = pending({ key: 'cargoone_offers', name: 'cargo.one — Offer & Book API', providerSlug: 'cargo-one', modes: ['air'], cfg: () => config.integrations.cargoone,
  docsUrl: 'https://www.cargo.one/enterprise', requiredEnv: ['CARGOONE_API_KEY', 'CARGOONE_BASE_URL'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Live airline buy-rates for registered FREIGHT FORWARDERS only (airport-to-airport). Not available to shippers.' });
const freightify = pending({ key: 'freightify_rates', name: 'Freightify — Rates API', providerSlug: 'freightify', modes: ['sea_fcl', 'sea_lcl', 'air'], cfg: () => config.integrations.freightify,
  docsUrl: 'https://www.freightify.com', requiredEnv: ['FREIGHTIFY_API_KEY', 'FREIGHTIFY_BASE_URL'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Returns the subscribing forwarder\'s own contract/spot rates. Useful if your company (or a partner forwarder) runs Freightify.' });
const webcargo = pending({ key: 'webcargo_rates', name: 'WebCargo by Freightos — Rates/eBooking API', providerSlug: 'webcargo', modes: ['air', 'sea_fcl', 'sea_lcl'], cfg: () => config.integrations.webcargo,
  docsUrl: 'https://developer.freightos.com', requiredEnv: ['WEBCARGO_API_KEY', 'WEBCARGO_BASE_URL'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Enterprise/partner access for forwarders (airline eBooking and rate management).' });

module.exports = [freightos, searates, xeneta, hapag, cargoone, freightify, webcargo];
