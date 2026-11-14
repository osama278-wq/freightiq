'use strict';
// Thin Anthropic Messages API client (server-side only; the key never reaches the browser).
const config = require('../config');

function isConfigured() { return !!config.anthropicApiKey; }

async function createMessage(body, timeoutMs = 120000) {
  if (!isConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured');
  const r = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 4096, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
  return j;
}

// Run a conversation turn, continuing automatically when the server pauses a long
// server-tool turn (stop_reason "pause_turn").
async function runWithServerTools(body, maxContinuations = 3) {
  let messages = body.messages.slice();
  let resp; const all = [];
  for (let i = 0; i <= maxContinuations; i++) {
    resp = await createMessage({ ...body, messages });
    all.push(...resp.content);
    if (resp.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: resp.content }];
  }
  return { resp, content: all };
}

// Collect every URL that the web_search tool actually returned, for provenance checks.
function searchedUrls(content) {
  const urls = new Map();
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
      for (const r of b.content) if (r.url) urls.set(normalizeUrl(r.url), { url: r.url, title: r.title, page_age: r.page_age });
  }
  return urls;
}
function searchQueries(content) { return content.filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').map((b) => b.input && b.input.query).filter(Boolean); }
function normalizeUrl(u) { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).toLowerCase(); } catch { return String(u).toLowerCase(); } }
function textOf(content) { return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); }

const WEB_SEARCH_TOOL = (maxUses) => ({ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses });

module.exports = { isConfigured, createMessage, runWithServerTools, searchedUrls, searchQueries, normalizeUrl, textOf, WEB_SEARCH_TOOL };
