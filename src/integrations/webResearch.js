'use strict';
// Live web research adapter. Uses Claude with the server-side web_search tool to find
// PUBLICLY published freight prices for the lane (provider rate pages, published
// calculators, market reports). Provenance guard: every returned offer must cite a URL that
// the web_search tool actually returned in this run — otherwise it is discarded.
const config = require('../config');
const geo = require('../data/geo');
const ai = require('../agent/anthropic');
const { makeResult } = require('./base');

const SYSTEM = `You are a freight market research analyst. You search the public web for PUBLISHED freight prices for one specific shipment lane.
Rules — strictly enforced:
- Report ONLY prices you actually read on a page returned by web_search. Never invent, average, or estimate numbers yourself.
- Every item must include the exact source_url you read it on.
- Classify price_type as: "provider_published_rate" (a forwarder/carrier publishes this rate), "online_calculator" (instant calculator result shown publicly), or "market_article" (article/report/benchmark range).
- State exactly what the price covers (charge categories) — use inclusion "excluded"/"unknown" where the page does not say.
- Respect access restrictions: do not attempt to bypass logins or paywalls.
- If you find nothing reliable, return an empty array.
Return your final answer as a single JSON code block: {"offers":[...],"notes":"..."}.
Offer schema: {"provider_name","provider_type":"forwarder|ocean_carrier|air_carrier|integrator|platform|publisher","mode":"air|express|sea_lcl|sea_fcl|road","service_type","scope":"door_to_door|port_to_port|airport_to_airport|door_to_port|port_to_door","currency","charges":[{"category":"freight|pickup|origin|destination|delivery|fuel|security|customs|insurance|documentation|other","label","basis":"fixed|per_kg_chargeable|per_kg|per_rt|per_cbm|per_container","amount_min","amount_max","inclusion":"amount|included|excluded|unknown"}],"transit_min","transit_max","price_type","published_date":"YYYY-MM-DD or null","source_url","notes"}`;

function buildPrompt(request, derived, modes) {
  const o = geo.byIso[request.origin_country], d = geo.byIso[request.dest_country];
  return `Find publicly published freight prices for:
Origin: ${request.origin_city || ''} ${o ? o.name : request.origin_country} ${request.origin_port || ''}
Destination: ${request.dest_city || ''} ${d ? d.name : request.dest_country} ${request.dest_port || ''}
Modes to research: ${modes.join(', ')}
Gross weight ${derived.gross_weight_kg ?? 'unknown'} kg; volume ${derived.volume_cbm ?? 'unknown'} m³; air chargeable ${derived.air_chargeable_kg ?? '?'} kg; LCL ${derived.lcl_revenue_tons ?? '?'} RT; ${modes.includes('sea_fcl') ? 'container ' + (request.container_type || derived.suggested_container || '20GP') : ''}
Scope requested: ${request.scope || 'not specified'}. Today is ${new Date().toISOString().slice(0, 10)}.
Prefer recent (last 6 months) sources and prices per kg / per CBM / per container that can be applied to this shipment.`;
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*"offers"[\s\S]*\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

module.exports = {
  key: 'web_research', name: 'AI web research (Claude + web search)', kind: 'web', modes: ['air', 'express', 'sea_lcl', 'sea_fcl', 'road'],
  docsUrl: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool', requiredEnv: ['ANTHROPIC_API_KEY'], dataClass: 'INDICATIVE_ONLINE / MARKET_BENCHMARK',
  limitations: 'Finds publicly published prices only — never bookable quotations. Results are rejected unless their source URL was actually returned by the search tool in the same run.',
  isConfigured: () => ai.isConfigured(),
  supports: (request) => (request.origin_country && request.dest_country ? true : 'origin/destination required'),
  async search({ request, derived, modes, log }) {
    const { content } = await ai.runWithServerTools({ system: SYSTEM, max_tokens: 6000, tools: [ai.WEB_SEARCH_TOOL(config.webResearchMaxSearches)], messages: [{ role: 'user', content: buildPrompt(request, derived, modes) }] });
    const seen = ai.searchedUrls(content);
    const queries = ai.searchQueries(content);
    const parsed = extractJson(ai.textOf(content)) || { offers: [] };
    const out = []; let rejected = 0;
    for (const o of parsed.offers || []) {
      const ok = o.source_url && seen.has(ai.normalizeUrl(o.source_url));
      if (!ok || !Array.isArray(o.charges) || !o.charges.some((c) => c.inclusion === 'amount' && c.amount_min != null)) { rejected++; continue; }
      if (!modes.includes(o.mode)) { rejected++; continue; }
      const pub = o.published_date ? new Date(o.published_date) : null;
      const old = pub && (Date.now() - pub) / 86400000 > 365;
      const status = old ? 'HISTORICAL' : o.price_type === 'market_article' ? 'MARKET_BENCHMARK' : 'INDICATIVE_ONLINE';
      const meta = seen.get(ai.normalizeUrl(o.source_url));
      out.push(makeResult({
        provider_name: o.provider_name || meta.title || 'Published source', provider_type: o.provider_type === 'publisher' ? 'publisher' : o.provider_type, status, mode: o.mode,
        service_type: o.service_type, scope: o.scope, currency: o.currency || 'USD',
        charges: o.charges.map((c) => ({ category: c.category || 'other', label: c.label || c.category, basis: c.basis || 'fixed', amount_min: c.amount_min ?? null, amount_max: c.amount_max ?? c.amount_min ?? null, currency: o.currency || 'USD', inclusion: c.inclusion || 'amount' })),
        transit_min: o.transit_min ?? null, transit_max: o.transit_max ?? null,
        route: { origin_country: request.origin_country, dest_country: request.dest_country },
        source_name: meta.title || o.provider_name, source_url: o.source_url,
        limitations: `Publicly published ${o.price_type === 'market_article' ? 'market range' : 'price'}${o.published_date ? ' dated ' + o.published_date : ' (publication date not stated)'}; not a quotation for this shipment. ${o.notes || ''}`.trim(),
        raw: { price_type: o.price_type, published_date: o.published_date, page_age: meta.page_age },
      }));
    }
    log({ queries, sources_seen: seen.size, offers_accepted: out.length, offers_rejected: rejected, notes: parsed.notes || null });
    return out;
  },
};
