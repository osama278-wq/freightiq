'use strict';
// Standard provider-integration contract. Every adapter exports an object with:
//   key, name, kind ('benchmark'|'rfq'|'web'|'carrier_api'|'platform_api'|'manual'),
//   providerSlug?, modes[], docsUrl, requiredEnv[], dataClass (status it produces),
//   limitations, isConfigured(), supports(request, derived) -> bool|string(reason),
//   search(ctx) -> Promise<Result[]>
// Results must follow makeResult(). Adapters must NEVER fabricate prices: if the remote
// system returns nothing, return [] (the orchestrator then records "no offer returned").

function makeResult(o) {
  const now = new Date().toISOString();
  if (!o.status) throw new Error('result.status required');
  if (!o.provider_name) throw new Error('result.provider_name required');
  if (!o.mode) throw new Error('result.mode required');
  if (o.status !== 'UNAVAILABLE_RFQ' && o.status !== 'MANUAL_QUOTE' && !o.source_url && !o.source_name) throw new Error('priced results need a source');
  return {
    provider_slug: o.provider_slug || null, provider_name: o.provider_name, provider_type: o.provider_type || null,
    status: o.status, mode: o.mode, service_type: o.service_type || null, scope: o.scope || null,
    route: o.route || {}, transit_min: o.transit_min ?? null, transit_max: o.transit_max ?? null,
    currency: o.currency || null, charges: o.charges || [], validity_from: o.validity_from || null, validity_to: o.validity_to || null,
    source_name: o.source_name || null, source_url: o.source_url || null, retrieved_at: o.retrieved_at || now,
    limitations: o.limitations || null, notes: o.notes || null, rfq: o.rfq || null, raw: o.raw || null,
  };
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${new URL(url).host}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`); e.status = r.status; throw e; }
  return body;
}

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));

module.exports = { makeResult, fetchJson, isoDate };
