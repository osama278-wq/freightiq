# Architecture

## Stack decision
Inspected the environment: Node 22 with built-in SQLite, fetch, crypto and zlib, and **no package-registry access**. A zero-dependency Node service was chosen because it (a) runs anywhere Node ≥ 22.13 runs, (b) has no supply-chain surface, (c) deploys as one container. The SQLite layer is isolated in `src/db.js`; moving to PostgreSQL later means replacing that module and the SQL dialect in services.

```
Browser SPA (public/)  ──HTTPS/JSON + session cookie + CSRF──▶  server.js
                                                                 ├─ src/http.js        router, body limits, security headers, metrics
                                                                 ├─ src/auth.js        scrypt, sessions, RBAC, tenancy scope
                                                                 ├─ src/routes.js      REST API
                                                                 ├─ services/searchService.js   job queue + orchestration
                                                                 ├─ engine/shipment.js chargeable weights, missing info, advisories
                                                                 ├─ engine/compare.js  normalisation, coverage, FX, scoring, recommendations, landed cost
                                                                 ├─ integrations/*     provider adapters (standard contract)
                                                                 ├─ agent/*            Claude client, assistant (tool-use) + rule fallback
                                                                 ├─ reports/*          XLSX writer, printable HTML/PDF report
                                                                 └─ fx.js              live FX + labelled fallback
```

## Search pipeline
1. `POST /api/searches` → `shipment.analyse()` normalises input, computes chargeable metrics, candidate modes, missing-info questions and advisories → row stored (`queued`) → background queue (concurrency 2).
2. `runSearch` iterates adapters in registry order: benchmark → carrier APIs → platform APIs → web research → RFQ directory (last, skips providers that already have a price). Each adapter: enabled? relevant modes? configured? supported for this request? → run with 150 s timeout. Every outcome is written to `sources_log`.
3. Results persisted with status, charges, source URL, retrieval time, validity, limitations.
4. On read, `compare.evaluateResult` converts each line to the comparison currency, checks coverage vs. the requested scope, flags expiry/age, computes confidence; `compare.recommend` ranks.

## Result status model
| Status | Firm? | Base confidence | Produced by |
|---|---|---|---|
| Verified Live Quotation | yes | 0.95 | Carrier/platform APIs with account credentials |
| Manual Quotation | yes | 0.90 | Staff/client entry with mandatory source reference |
| Indicative Online Price | no | 0.65 | Freightos estimator, published rates found by web research |
| Market Benchmark | no | 0.45 | Benchmark library, market articles, Xeneta |
| Historical Price | no | 0.30 | Old quotes, sources >12 months |
| AI Estimate | no | 0.20 | Reserved; never selected as firm |
| Price Unavailable – Request Required | — | 0 | RFQ directory |

Confidence is multiplied by 0.7 if not like-for-like, 0.5 if expired, 0.8 if >30 days old, and by an admin-entered provider reliability rating (rating requires a written basis).

## Comparison categories
freight, pickup, origin, destination, delivery, fuel, security, customs, insurance, documentation, other. Required set: freight always; door origin → pickup + origin; door destination → destination + delivery; air/express → fuel; + customs/insurance if requested.

## Database (SQLite, WAL)
| Table | Key columns |
|---|---|
| organizations | id, name, type (operator/client), active |
| users | org_id, email, scrypt hash, role (admin/staff/client_admin/client_user), lockout fields |
| sessions | sha256(token), user_id, csrf, expires_at |
| providers | slug, provider_type, website, regions/countries/modes/hubs (JSON), contact, online_quote, api_availability, oman_presence, reliability_rating+basis, evidence (JSON), last_verified |
| provider_routes | provider_id, origin, dest, mode, **evidence_url (required)** |
| integrations | key, enabled, last_success, last_error, call counters |
| searches | ref, org_id, user_id, status, request/derived/missing/advisories/sources_log (JSON) |
| results | search_id, org_id, provider, source_key, status, mode, scope, route, transit, currency, charges (JSON), validity, source_name/url, retrieved_at, limitations, rfq |
| saved_quotes | org_id, search_id, result_id (nullable), immutable snapshot |
| benchmarks | lane, mode, size band, charges, transit, source, as_of |
| fx_rates | code, per_usd, source, as_of |
| conversations / messages | assistant history per user, active search_id |
| share_links | sha256(token), search_id, expiry, revoked |
| audit_log, settings, request_metrics | |

## Security model
- Passwords: scrypt (N=16384). Sessions: 256-bit random token, stored hashed; HttpOnly, SameSite=Strict, `Secure` when `COOKIE_SECURE=true`.
- CSRF: per-session token required in `X-CSRF-Token` on every mutating request.
- Tenancy: every search/result/saved/conversation query is scoped by `org_id` unless the user is operator staff; foreign IDs return **404** (no existence leak).
- RBAC: admin (everything), staff (operate all clients, no user/settings changes), client_admin (own org + team), client_user (own org).
- Secrets only in environment variables; never serialised to the API (tested). CSP `script-src 'self'`, no inline scripts; security headers on every response; 2 MB body limit; login lockout (5 failures → 15 min).
- Share links are opt-in, expiring (1–90 days) and revocable.

## AI agent
- `agent/anthropic.js`: Messages API client (handles `pause_turn` for server tools); key server-side only.
- **Web research adapter**: Claude + `web_search` tool, strict JSON schema; provenance guard keeps an offer only if its `source_url` was among the URLs the search tool returned in that run; publication date >12 months → Historical.
- **Assistant**: tool-use loop (create/update/rerun search, list/compare results, find providers, landed cost, set weights, web search). System prompt enforces the status vocabulary and the no-invention rules. Conversation keeps `search_id` so follow-ups need no re-entry.
- **Fallback** (no key): deterministic parser for origin/destination/weight/volume/container/scope and intents (cheapest, fastest, compare top N, explain, alternatives to X, providers, recheck, landed cost).
