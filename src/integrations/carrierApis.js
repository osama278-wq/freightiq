'use strict';
// Direct carrier / integrator API adapters. They activate automatically when credentials
// are present in the environment. Request/response mappings follow the vendors' published
// documentation (links below) and MUST be validated in each vendor's sandbox during
// activation — see docs/INTEGRATIONS.md. Unparseable responses yield no offers (never a
// guessed price).
const config = require('../config');
const { makeResult, fetchJson, isoDate } = require('./base');

// ───────────────────────── DHL Express — MyDHL API ─────────────────────────
const dhlExpress = {
  key: 'dhl_express_mydhl', name: 'DHL Express — MyDHL API (rates)', kind: 'carrier_api', providerSlug: 'dhl-express', modes: ['express'],
  docsUrl: 'https://developer.dhl.com/api-reference/dhl-express-mydhl-api', requiredEnv: ['DHL_EXPRESS_USERNAME', 'DHL_EXPRESS_PASSWORD', 'DHL_EXPRESS_ACCOUNT'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Account-specific live rates for courier products. Pallet/non-stackable surcharges may need to be requested as value-added services. Sandbox base URL by default (set DHL_EXPRESS_BASE_URL for production).',
  isConfigured: () => { const c = config.integrations.dhlExpress; return !!(c.username && c.password && c.accountNumber); },
  supports: (r, d) => (d.express_chargeable_kg ? true : 'weight/dimensions required'),
  async search({ request, derived }) {
    const c = config.integrations.dhlExpress;
    const p = derived.pieces[0] || {};
    const q = new URLSearchParams({
      accountNumber: c.accountNumber, originCountryCode: request.origin_country, originCityName: request.origin_city || '', destinationCountryCode: request.dest_country, destinationCityName: request.dest_city || '',
      weight: String(derived.gross_weight_kg), length: String(p.length_cm || 1), width: String(p.width_cm || 1), height: String(p.height_cm || 1),
      plannedShippingDate: isoDate(request.ready_date), isCustomsDeclarable: String(request.origin_country !== request.dest_country), unitOfMeasurement: 'metric',
    });
    const j = await fetchJson(`${c.baseUrl}/rates?${q}`, { headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'), Accept: 'application/json' } });
    const retrieved = new Date().toISOString();
    return (j.products || []).map((pr) => {
      const tot = (pr.totalPrice || []).find((t) => t.currencyType === 'BILLC') || (pr.totalPrice || [])[0];
      if (!tot || tot.price == null) return null;
      const bd = ((pr.detailedPriceBreakdown || []).find((b) => b.currencyType === (tot.currencyType || 'BILLC')) || {}).breakdown || [];
      const charges = bd.length ? bd.map((b) => ({ category: /fuel/i.test(b.name) ? 'fuel' : /duty|tax|clear/i.test(b.name) ? 'customs' : /insur/i.test(b.name) ? 'insurance' : b.typeCode === 'SPRQT' || /express/i.test(b.name) ? 'freight' : 'other', label: b.name, basis: 'fixed', amount_min: b.price, amount_max: b.price, currency: tot.priceCurrency, inclusion: 'amount' }))
        : [{ category: 'freight', label: 'Total (no breakdown returned)', basis: 'fixed', amount_min: tot.price, amount_max: tot.price, currency: tot.priceCurrency, inclusion: 'amount' }];
      for (const cat of ['pickup', 'origin', 'destination', 'delivery']) if (!charges.some((x) => x.category === cat)) charges.push({ category: cat, label: 'Included in courier door-to-door product', basis: 'fixed', inclusion: 'included', currency: tot.priceCurrency });
      const days = pr.deliveryCapabilities && pr.deliveryCapabilities.totalTransitDays;
      return makeResult({ provider_slug: 'dhl-express', provider_name: 'DHL Express', provider_type: 'integrator', status: 'VERIFIED_LIVE', mode: 'express', service_type: pr.productName, scope: 'door_to_door',
        route: { origin_country: request.origin_country, dest_country: request.dest_country }, transit_min: days ?? null, transit_max: days ?? null, currency: tot.priceCurrency, charges,
        validity_to: request.ready_date || null, source_name: 'DHL Express MyDHL API /rates', source_url: dhlExpress.docsUrl, retrieved_at: retrieved,
        limitations: 'Account rate for the planned shipping date; duties & taxes not included unless DTP service selected.', raw: { productCode: pr.productCode } });
    }).filter(Boolean);
  },
};

// ───────────────────────── Aramex — Rate Calculator API ─────────────────────────
const aramex = {
  key: 'aramex_rate_calculator', name: 'Aramex — Rate Calculator API', kind: 'carrier_api', providerSlug: 'aramex', modes: ['express'],
  docsUrl: 'https://www.aramex.com/ae/en/developers-solution-center/aramex-apis', requiredEnv: ['ARAMEX_USERNAME', 'ARAMEX_PASSWORD', 'ARAMEX_ACCOUNT_NUMBER', 'ARAMEX_ACCOUNT_PIN', 'ARAMEX_ACCOUNT_ENTITY', 'ARAMEX_ACCOUNT_COUNTRY'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Courier (express) product rates. Aramex Freight (cargo) is priced separately — request via RFQ for >100 kg.',
  isConfigured: () => { const c = config.integrations.aramex; return !!(c.username && c.password && c.accountNumber && c.accountPin); },
  supports: (r, d) => (d.gross_weight_kg ? true : 'weight required'),
  async search({ request, derived }) {
    const c = config.integrations.aramex;
    const body = {
      ClientInfo: { UserName: c.username, Password: c.password, Version: 'v1.0', AccountNumber: c.accountNumber, AccountPin: c.accountPin, AccountEntity: c.accountEntity, AccountCountryCode: c.accountCountry, Source: 24 },
      OriginAddress: { City: request.origin_city || '', CountryCode: request.origin_country }, DestinationAddress: { City: request.dest_city || '', CountryCode: request.dest_country },
      ShipmentDetails: { PaymentType: 'P', ProductGroup: request.origin_country === request.dest_country ? 'DOM' : 'EXP', ProductType: request.origin_country === request.dest_country ? 'OND' : 'PPX',
        ActualWeight: { Unit: 'KG', Value: derived.gross_weight_kg }, ChargeableWeight: { Unit: 'KG', Value: derived.express_chargeable_kg }, NumberOfPieces: derived.packages || 1 },
      PreferredCurrencyCode: 'USD', Transaction: { Reference1: 'FreightIQ' },
    };
    const j = await fetchJson(c.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    if (j.HasErrors) throw new Error('Aramex: ' + (j.Notifications || []).map((n) => n.Message).join('; '));
    if (!j.TotalAmount || j.TotalAmount.Value == null) return [];
    const cur = j.TotalAmount.CurrencyCode;
    return [makeResult({ provider_slug: 'aramex', provider_name: 'Aramex', provider_type: 'integrator', status: 'VERIFIED_LIVE', mode: 'express', service_type: body.ShipmentDetails.ProductType, scope: 'door_to_door', currency: cur,
      route: { origin_country: request.origin_country, dest_country: request.dest_country },
      charges: [{ category: 'freight', label: 'Aramex total (rate calculator)', basis: 'fixed', amount_min: j.TotalAmount.Value, amount_max: j.TotalAmount.Value, currency: cur, inclusion: 'amount' },
        ...['pickup', 'origin', 'destination', 'delivery', 'fuel'].map((cat) => ({ category: cat, label: 'Included in courier total (per Aramex product terms)', basis: 'fixed', inclusion: 'included', currency: cur }))],
      source_name: 'Aramex Rate Calculator API', source_url: aramex.docsUrl, limitations: 'Transit time not returned by rate calculator. Duties/taxes excluded.', raw: { RateDetails: j.RateDetails } })];
  },
};

// ───────────────────────── Maersk — Offers API (Maersk Spot) ─────────────────────────
let maerskToken = null;
async function maerskAuth() {
  const c = config.integrations.maersk;
  if (maerskToken && maerskToken.exp > Date.now() + 60000) return maerskToken.token;
  const j = await fetchJson(`${c.baseUrl}/customer-identity/oauth/v2/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Consumer-Key': c.consumerKey },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.consumerKey, client_secret: c.clientSecret }) });
  maerskToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return maerskToken.token;
}
const maersk = {
  key: 'maersk_spot_offers', name: 'Maersk — Offers API (Maersk Spot)', kind: 'carrier_api', providerSlug: 'maersk', modes: ['sea_fcl'],
  docsUrl: 'https://developer.maersk.com/api-catalogue', requiredEnv: ['MAERSK_CONSUMER_KEY', 'MAERSK_CLIENT_SECRET', 'MAERSK_CUSTOMER_CODE'], dataClass: 'VERIFIED_LIVE',
  limitations: 'Spot offers only (dry 20GP/40GP/40HC/45HC). Dynamic pricing with no validity guarantee — book promptly. Maersk API terms forbid marketplace display without the customer\'s own credentials: each client must activate with its own Maersk account. Location codes: UN/LOCODE or Maersk RKST.',
  isConfigured: () => { const c = config.integrations.maersk; return !!(c.consumerKey && c.clientSecret && c.customerCode); },
  supports: (r) => (r.origin_port && r.dest_port ? true : 'origin and destination seaports (UN/LOCODE) required'),
  async search({ request, derived }) {
    const c = config.integrations.maersk;
    const token = await maerskAuth();
    const size = (request.container_type || derived.suggested_container || '20GP').replace('GP', 'DRY').replace('HC', 'HDRY');
    // Query parameter names per Maersk onboarding docs — validate in sandbox at activation.
    const q = new URLSearchParams({ originUNLocationCode: request.origin_port, destinationUNLocationCode: request.dest_port, containerSizeType: size, quantity: String(request.container_count || 1), customerCode: c.customerCode });
    const j = await fetchJson(`${c.baseUrl}/offers/v2/offers/brand/MAEU/departuredate/${isoDate(request.ready_date)}?${q}`, { headers: { Authorization: `Bearer ${token}`, 'Consumer-Key': c.consumerKey, Accept: 'application/json' } });
    const offers = Array.isArray(j) ? j : j.offers || j.productOffers || [];
    const out = [];
    for (const o of offers) {
      const prices = o.prices || o.priceDetails || (o.price && [o.price]) || [];
      const lines = []; let cur = null;
      for (const p of prices) {
        const amt = p.totalAmount ?? p.amount ?? p.price; if (amt == null) continue;
        cur = p.currency || p.currencyCode || cur;
        const n = String(p.chargeName || p.name || p.chargeType || 'Ocean freight');
        lines.push({ category: /bas|ocean|freight/i.test(n) ? 'freight' : /bunker|fuel|baf|emf/i.test(n) ? 'fuel' : /thc|terminal|origin/i.test(n) ? 'origin' : /dest|import|imp|d\/o/i.test(n) ? 'destination' : /doc|b\/l/i.test(n) ? 'documentation' : 'other', label: n, basis: 'per_container', quantity: request.container_count || 1, amount_min: amt, amount_max: amt, currency: p.currency || p.currencyCode, inclusion: 'amount' });
      }
      if (!lines.length) continue;
      out.push(makeResult({ provider_slug: 'maersk', provider_name: 'Maersk', provider_type: 'ocean_carrier', status: 'VERIFIED_LIVE', mode: 'sea_fcl', service_type: `Maersk Spot ${size}`, scope: 'port_to_port', currency: cur,
        route: { origin: request.origin_port, destination: request.dest_port }, transit_min: o.transitTime ?? null, transit_max: o.transitTime ?? null, charges: lines,
        validity_to: o.validTo || null, source_name: 'Maersk Offers API', source_url: maersk.docsUrl, limitations: maersk.limitations.split('.')[0] + '.', raw: { offerId: o.offerId || o.id } }));
    }
    return out;
  },
};

module.exports = [dhlExpress, aramex, maersk];
