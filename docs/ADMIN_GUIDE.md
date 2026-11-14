# Administrator guide

## Roles
| Role | Organisation | Can do |
|---|---|---|
| admin | Operator | Everything: users, clients, settings, integrations, FX, providers, benchmarks |
| staff | Operator | Search for any client, enter quotes, edit providers & benchmarks, view all history |
| client_admin | Client | Own organisation's searches, quotes, reports; add team members |
| client_user | Client | Own organisation's searches, quotes, reports |

## Onboarding a client
1. Administration → Users & clients → **Add client organisation**.
2. **Create user** in that organisation with role client_admin; send them the initial password and ask them to change it (Account page).
3. The client admin can add colleagues. Their data is visible only to their organisation and to operator staff.

## Integrations
Administration → API integrations shows each source, the credentials present (✓/✗), the data class it produces, last success/error and call counts. Enable/disable a source without removing credentials. Disabled sources appear in every search log as *disabled — not searched*.

## Settings
- **Comparison currency** default (users can switch per search).
- **Hormuz advisory** — routes Oman ocean cargo via Sohar/Salalah and warns about Jebel Ali/Khalifa. Switch off when the disruption ends.
- **Operator is forwarder** — includes airline carriers and forwarder-only platforms in searches.
- **Default weights** for price/speed/reliability.
- **FX**: refresh from live source or set a manual rate (logged in the audit trail). GCC pegs are exact; anything marked *fallback:approximate* must be refreshed or set before commercial use.

## Provider database
Shipping Companies → open a record → **Edit**. Keep `provider_type` accurate (carrier vs forwarder vs NVOCC vs platform). Add **evidence** lines (`claim | URL`). Add **evidenced lanes** only with a URL. A **reliability rating** (0–5) requires a written basis (e.g. internal on-time KPI) — it then influences confidence and recommendations.

## Benchmarks (data sources)
Administration → Data sources. Add lane benchmarks from market reports or your own historical invoices (status Market Benchmark or Historical Price). Always fill `source_name`, `as_of` and the size band — the engine never applies a benchmark outside it.

## Audit & performance
Audit log records logins, failed logins, searches, quotes, exports, share links, setting/provider/user changes. System performance shows route latency, errors, search duration and integration health.
