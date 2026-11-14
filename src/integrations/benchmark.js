'use strict';
// Benchmark library adapter — applies admin-maintained lane benchmarks (seeded from the
// uploaded research paper). Produces MARKET_BENCHMARK / HISTORICAL results only, and only
// when lane AND size band match. No extrapolation outside the band.
const db = require('../db');
const { makeResult } = require('./base');

module.exports = {
  key: 'benchmark_library', name: 'Lane benchmark library', kind: 'benchmark', modes: ['air', 'express', 'sea_lcl', 'sea_fcl', 'road'],
  docsUrl: null, requiredEnv: [], dataClass: 'MARKET_BENCHMARK',
  limitations: 'Scenario benchmarks, not quotations. Only covers lanes and size bands present in the library (initially Singapore → Oman from the research paper). Admins can add lanes.',
  isConfigured: () => true,
  supports: () => true,
  async search({ request, derived, modes }) {
    const rows = db.get().prepare('SELECT * FROM benchmarks WHERE origin_country=? AND dest_country=?').all(request.origin_country, request.dest_country);
    const out = [];
    for (const b of rows) {
      if (!modes.includes(b.mode)) continue;
      const kg = b.mode === 'express' ? derived.express_chargeable_kg : derived.air_chargeable_kg;
      if (b.applies_min_kg !== null && (kg === null || kg < b.applies_min_kg)) continue;
      if (b.applies_max_kg !== null && (kg === null || kg > b.applies_max_kg)) continue;
      if (b.applies_min_cbm !== null && (derived.volume_cbm === null || derived.volume_cbm < b.applies_min_cbm)) continue;
      if (b.applies_max_cbm !== null && (derived.volume_cbm === null || derived.volume_cbm > b.applies_max_cbm)) continue;
      out.push(makeResult({
        provider_name: 'Market benchmark (lane model)', provider_type: 'benchmark', status: b.status || 'MARKET_BENCHMARK', mode: b.mode, service_type: b.service_type, scope: b.scope,
        route: { origin: b.origin_point, destination: b.dest_point, origin_country: b.origin_country, dest_country: b.dest_country },
        transit_min: b.transit_min, transit_max: b.transit_max, currency: b.currency, charges: db.P(b.charges, []),
        source_name: `${b.source_name} (as of ${b.as_of})`, source_url: b.source_url, retrieved_at: new Date(b.as_of).toISOString(),
        limitations: `Benchmark as of ${b.as_of}; not bookable. ${b.notes || ''}`.trim(), raw: { benchmark_id: b.id },
      }));
    }
    return out;
  },
};
