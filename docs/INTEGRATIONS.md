# Provider integrations

All adapters implement one contract (`src/integrations/base.js`):

```js
{ key, name, kind, providerSlug, modes[], docsUrl, requiredEnv[], dataClass, limitations,
  isConfigured(), supports(request, derived) -> true | "reason", async search(ctx) -> Result[] }
```
`makeResult()` enforces status, provider, mode and a source for every priced result. Register a new adapter in `src/integrations/registry.js`; it appears automatically in Administration → API integrations with its credential checklist.

**Rules for adapters:** return `[]` when the remote system returns nothing; never synthesise prices; map unknown charge components to `unknown`, not zero; set `validity_to` when the provider states it.

## Status of each integration

| Key | Provider | Data class | Credentials | Implementation |
|---|---|---|---|---|
| `benchmark_library` | Lane benchmarks (paper + admin) | Market Benchmark | none | ✅ live |
| `provider_rfq` | Provider directory | Price Unavailable – Request Required | none | ✅ live |
| `manual_entry` | Received quotes | Manual Quotation | none | ✅ live |
| `dhl_express_mydhl` | DHL Express MyDHL `/rates` | Verified Live | `DHL_EXPRESS_USERNAME/PASSWORD/ACCOUNT` | ✅ implemented; mock-tested on documented response |
| `aramex_rate_calculator` | Aramex Rate Calculator | Verified Live | `ARAMEX_*` (6 vars) | ✅ implemented; validate in sandbox |
| `maersk_spot_offers` | Maersk Offers API | Verified Live | `MAERSK_CONSUMER_KEY/CLIENT_SECRET/CUSTOMER_CODE` | ✅ implemented; validate query param names in Maersk onboarding |
| `freightos_estimator` | Freightos Rate Estimator | Indicative | `FREIGHTOS_API_KEY` | ✅ implemented; validate response field names |
| `web_research` | Claude + web search | Indicative / Benchmark / Historical | `ANTHROPIC_API_KEY` | ✅ implemented; provenance guard tested |
| `searates_logistics_explorer` | SeaRates | Indicative | `SEARATES_API_KEY`, `SEARATES_BASE_URL` | 🟡 activation module |
| `xeneta_market` | Xeneta | Market Benchmark | `XENETA_API_KEY`, `XENETA_BASE_URL` | 🟡 activation module |
| `hapag_quick_quotes` | Hapag-Lloyd | Verified Live | `HLAG_CLIENT_ID/SECRET/BASE_URL` | 🟡 activation module |
| `cargoone_offers` | cargo.one | Verified Live (forwarders only) | `CARGOONE_API_KEY/BASE_URL` | 🟡 activation module |
| `freightify_rates` | Freightify | Verified Live | `FREIGHTIFY_API_KEY/BASE_URL` | 🟡 activation module |
| `webcargo_rates` | WebCargo | Verified Live | `WEBCARGO_API_KEY/BASE_URL` | 🟡 activation module |

## Activation procedure (any adapter)
1. Obtain sandbox credentials from the vendor (links in Administration → API integrations → docs).
2. Put them in `.env` / secret manager; restart. Status changes from *credentials missing* to *ready*.
3. Run a test search on a lane the vendor serves. Check Sources searched: `ok` with results, or `error` with the vendor message.
4. For 🟡 modules: implement `search()` in `src/integrations/platformApis.js` using the vendor's sandbox contract — build the request from `request`/`derived`, map the response to `makeResult()` charge lines. Add a mock test in `tests/run-tests.js` (see the DHL mock).
5. Switch base URL to production.

## Vendor notes
- **DHL Express**: account rates; duties & taxes only with DTP. Pallet surcharges may need value-added service codes.
- **Aramex**: courier products; Aramex *Freight* cargo is priced separately — keep >100 kg on RFQ.
- **Maersk**: Spot only (dry 20/40/40HC/45HC), dynamic pricing without validity guarantee. API terms forbid showing offers without the customer's own credentials → each client must supply their own Maersk account for production use (or use it only for your own company's bookings).
- **Freightos estimator**: min–max ranges; coverage not itemised → always shown as *not like-for-like*.
- **cargo.one / WebCargo / airline rates**: forwarder-only. Enable *"operator is forwarder"* in Settings only if your company holds forwarder status.
- **Websites without APIs**: not scraped. Use RFQs or authorised browser automation agreed with the provider.
- **Email RFQs**: generated drafts open in the user's mail client (`mailto:`). Add SMTP by extending `rfq.js` if outbound automation is authorised.
