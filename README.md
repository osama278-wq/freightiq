# FreightIQ — AI-Powered Global Air & Sea Freight Price Intelligence

A multi-client web application that searches the air and sea freight market for a shipment, collects prices from every source it can legitimately access, normalises them into one comparison model, and recommends the **cheapest**, **fastest**, **best-value** and **overall recommended** option — while labelling every number with where it came from, when, and how firm it is.

> Core rule built into the code: **the system never invents a quotation.** Sources without credentials are logged as *"not searched"*, prices without a verifiable source are rejected, and providers that don't publish prices get a ready-to-send RFQ instead of a number.

---

## Quick start (local)

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`, `fetch`, `crypto`, `zlib`). **No npm dependencies.**

```bash
cp .env.example .env            # optional: add ANTHROPIC_API_KEY and carrier credentials
npm run create-admin -- admin@yourco.om "StrongPass2026" "Your Name"
npm start                        # http://localhost:8080
npm test                         # 30 end-to-end tests
```

Optional demo data (3 demo users, password `DemoPass2026`): `npm run seed -- --demo`

## Documentation

| Document | Purpose |
|---|---|
| [docs/RESEARCH_ANALYSIS.md](docs/RESEARCH_ANALYSIS.md) | Stage 1–2: what was taken from the research paper and the market/API research |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, modules, database structure, security model, AI agent design |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Every provider integration, its data class, credentials and activation steps |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | All environment variables |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment (Docker, VPS, Render), backups, HTTPS |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Administrator guide |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Client user guide |

## Development log — implemented vs. dependent on external services

### Implemented and tested (works today with zero credentials)
- Secure multi-tenant accounts: operator admin/staff + client organisations (client_admin/client_user); scrypt passwords, HttpOnly SameSite=Strict session cookies, CSRF tokens, login lockout, audit log. Clients can never see another client's data (tested on every endpoint — returns 404).
- Shipment form with all requested fields, piece-level dimensions, live pre-search analysis (air ÷6000, express ÷5000, LCL W/M with 1 RT minimum, density, container suggestion) and **missing-information questions** that can be answered inline and re-run.
- Search orchestrator with background job queue, per-source timeout and a **transparent source log** (ok / no offers / not searched – credentials missing / disabled / error).
- Unified comparison engine: 11 charge categories, amount/included/excluded/unknown per line, per-kg/per-RT/per-CBM/per-container bases, currency conversion with original currency preserved, **like-for-like coverage check against the requested scope**, validity/age flags, confidence scoring.
- Recommendation engine: Cheapest / Fastest / Best value / Recommended with tiering (firm comparable → comparable → all), adjustable price/speed/reliability weights, deadline check, advantages/disadvantages/uncertainties/source/confidence/explanation.
- Lane benchmark library seeded from the research paper (Singapore → Muscat sea LCL, sea-road via UAE, consolidated air, express) — reproduces the paper's ranges (e.g. air USD 1,167–1,879 vs paper 1,169–1,880).
- Oman/GCC advisories from the paper: Hormuz routing (Sohar/Salalah), no container port at Muscat, Maersk Sohar IMP fee, MCT free storage, landed taxes, GSFTA ROI, pallet penalties, volumetric waste, mode break-even.
- Provider database: 56 records across forwarders, NVOCCs, ocean carriers, air carriers, express integrators and platforms, with type distinction, evidence URLs and Oman presence status; admin CRUD; evidenced-lane records (evidence URL mandatory).
- RFQ generator for every relevant provider without a price (email draft / portal link), manual quotation entry (source reference mandatory), landed-cost calculator (CIF, duty, VAT).
- Saved quotations (immutable snapshots), side-by-side compare, Excel export; per-search **Excel report** (5 sheets) and **print-optimised PDF report**; expiring, revocable share links.
- AI assistant with persistent conversations that keep search context; works in rule-based mode without an API key (real searches, compare, fastest, alternatives, explain differences, landed cost, recheck).
- Administration: users & clients, integration status/toggles, settings, FX management (live refresh + manual override), benchmark data sources, search history, audit log, performance metrics.

### Built and tested against mocks — activates when credentials are supplied
- **Claude web research** (`ANTHROPIC_API_KEY`): live web search for published lane prices with a provenance guard — any offer whose URL was not returned by the search tool in that run is discarded (verified by test).
- **Claude conversational agent** (`ANTHROPIC_API_KEY`): tool-use loop over search/compare/providers/landed-cost + web search.
- **DHL Express MyDHL `/rates`** — verified against a mock of the documented response shape.
- **Aramex Rate Calculator**, **Maersk Offers API (Spot)**, **Freightos Rate Estimator** — implemented from vendor documentation; validate in each vendor sandbox at activation (see INTEGRATIONS.md).

### Activation-ready modules (contract issued only at commercial onboarding)
SeaRates Logistics Explorer, Xeneta, Hapag-Lloyd Quick Quotes, cargo.one, Freightify, WebCargo. These register, show status and required credentials, and **refuse to claim a search** until their request/response mapping is completed against the sandbox contract.

### Not implemented (deliberately)
- Scraping of carrier/forwarder websites behind logins — excluded to respect terms of use and authentication. Use the official APIs or RFQs.
- Automatic email sending (SMTP): RFQs open in the user's mail client. An SMTP adapter can be added in `src/integrations/rfq.js`.
- Native PDF rendering: reports are print-optimised HTML ("Save as PDF" in any browser).
- Live FX in this build environment: the sandbox had no outbound network, so tests ran on the labelled fallback table (GCC pegs exact). In production the live source refreshes automatically.
