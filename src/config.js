'use strict';
// Central configuration. All secrets come from environment variables (or a .env file
// that is loaded server-side only). Nothing here is ever sent to the browser.
const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  port: Number(env('PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  dataDir: env('DATA_DIR', path.join(__dirname, '..', 'data')),
  dbFile: env('DB_FILE', ''), // defaults to <dataDir>/freightiq.db
  sessionTtlHours: Number(env('SESSION_TTL_HOURS', 12)),
  cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
  baseCurrency: env('BASE_CURRENCY', 'USD'),
  publicBaseUrl: env('PUBLIC_BASE_URL', ''),
  // AI agent (Anthropic Messages API)
  anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  anthropicBaseUrl: env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  webResearchMaxSearches: Number(env('WEB_RESEARCH_MAX_SEARCHES', 6)),
  // FX
  fxProviderUrl: env('FX_PROVIDER_URL', 'https://open.er-api.com/v6/latest/USD'),
  fxRefreshHours: Number(env('FX_REFRESH_HOURS', 12)),
  // Provider integrations (activate by supplying credentials)
  integrations: {
    freightos: { apiKey: env('FREIGHTOS_API_KEY', ''), baseUrl: env('FREIGHTOS_BASE_URL', 'https://api.freightos.com') },
    searates: { apiKey: env('SEARATES_API_KEY', ''), baseUrl: env('SEARATES_BASE_URL', 'https://rates.searates.com') },
    maersk: { consumerKey: env('MAERSK_CONSUMER_KEY', ''), clientSecret: env('MAERSK_CLIENT_SECRET', ''), customerCode: env('MAERSK_CUSTOMER_CODE', ''), baseUrl: env('MAERSK_BASE_URL', 'https://api.maersk.com') },
    hapag: { clientId: env('HLAG_CLIENT_ID', ''), clientSecret: env('HLAG_CLIENT_SECRET', ''), baseUrl: env('HLAG_BASE_URL', '') },
    dhlExpress: { username: env('DHL_EXPRESS_USERNAME', ''), password: env('DHL_EXPRESS_PASSWORD', ''), accountNumber: env('DHL_EXPRESS_ACCOUNT', ''), baseUrl: env('DHL_EXPRESS_BASE_URL', 'https://express.api.dhl.com/mydhlapi/test') },
    aramex: { username: env('ARAMEX_USERNAME', ''), password: env('ARAMEX_PASSWORD', ''), accountNumber: env('ARAMEX_ACCOUNT_NUMBER', ''), accountPin: env('ARAMEX_ACCOUNT_PIN', ''), accountEntity: env('ARAMEX_ACCOUNT_ENTITY', ''), accountCountry: env('ARAMEX_ACCOUNT_COUNTRY', ''), baseUrl: env('ARAMEX_BASE_URL', 'https://ws.aramex.net/ShippingAPI.V2/RateCalculator/Service_1_0.svc/json/CalculateRate') },
    xeneta: { apiKey: env('XENETA_API_KEY', ''), baseUrl: env('XENETA_BASE_URL', 'https://api.xeneta.com/v3.0') },
    cargoone: { apiKey: env('CARGOONE_API_KEY', ''), baseUrl: env('CARGOONE_BASE_URL', '') },
    freightify: { apiKey: env('FREIGHTIFY_API_KEY', ''), baseUrl: env('FREIGHTIFY_BASE_URL', '') },
    webcargo: { apiKey: env('WEBCARGO_API_KEY', ''), baseUrl: env('WEBCARGO_BASE_URL', '') },
  },
  // TEST MODE: no login screen — every visitor is signed in automatically as an administrator.
  // For evaluation only. Never enable with real client data.
  authDisabled: env('AUTH_DISABLED', 'false') === 'true',
  bootstrapAdminEmail: env('ADMIN_EMAIL', ''),
  bootstrapAdminPassword: env('ADMIN_PASSWORD', ''),
};
