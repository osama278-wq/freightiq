# Environment variables

Loaded from the process environment, or from `.env` in the project root (server-side only). See `.env.example` for a template.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | 8080 / 0.0.0.0 | Listen address |
| `DATA_DIR` | `./data` | SQLite location — must be persistent storage |
| `DB_FILE` | `<DATA_DIR>/freightiq.db` | Explicit DB path |
| `SESSION_TTL_HOURS` | 12 | Session lifetime |
| `COOKIE_SECURE` | false | Set **true** in production (HTTPS) |
| `PUBLIC_BASE_URL` | — | Absolute base for share links |
| `BASE_CURRENCY` | USD | Initial comparison currency (changeable in Settings) |
| `AUTH_DISABLED` | false | **Test mode.** `true` = no login screen; every visitor is an administrator. Evaluation only — never with real client data |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstraps the first admin at start-up |
| `ANTHROPIC_API_KEY` | — | Enables Claude assistant + web research |
| `ANTHROPIC_MODEL` | claude-sonnet-5-5 | Model ID |
| `ANTHROPIC_BASE_URL` | https://api.anthropic.com | Override (testing/proxy) |
| `WEB_RESEARCH_MAX_SEARCHES` | 6 | Web searches per research run (cost control) |
| `FX_PROVIDER_URL` | https://open.er-api.com/v6/latest/USD | FX JSON source (USD base, `rates` object) |
| `FX_REFRESH_HOURS` | 12 | Refresh interval |
| `DHL_EXPRESS_USERNAME`, `DHL_EXPRESS_PASSWORD`, `DHL_EXPRESS_ACCOUNT`, `DHL_EXPRESS_BASE_URL` | — / test URL | MyDHL API |
| `ARAMEX_USERNAME`, `ARAMEX_PASSWORD`, `ARAMEX_ACCOUNT_NUMBER`, `ARAMEX_ACCOUNT_PIN`, `ARAMEX_ACCOUNT_ENTITY`, `ARAMEX_ACCOUNT_COUNTRY`, `ARAMEX_BASE_URL` | — | Aramex Rate Calculator |
| `MAERSK_CONSUMER_KEY`, `MAERSK_CLIENT_SECRET`, `MAERSK_CUSTOMER_CODE`, `MAERSK_BASE_URL` | — | Maersk Offers API |
| `HLAG_CLIENT_ID`, `HLAG_CLIENT_SECRET`, `HLAG_BASE_URL` | — | Hapag-Lloyd |
| `FREIGHTOS_API_KEY`, `FREIGHTOS_BASE_URL` | — | Freightos estimator |
| `SEARATES_API_KEY`, `SEARATES_BASE_URL` | — | SeaRates |
| `XENETA_API_KEY`, `XENETA_BASE_URL` | — | Xeneta |
| `CARGOONE_API_KEY`, `CARGOONE_BASE_URL` | — | cargo.one |
| `FREIGHTIFY_API_KEY`, `FREIGHTIFY_BASE_URL` | — | Freightify |
| `WEBCARGO_API_KEY`, `WEBCARGO_BASE_URL` | — | WebCargo |

Never put any of these in frontend code, Git, or screenshots. Rotate keys if exposed.
