'use strict';
// Minimal, dependency-free HTTP toolkit: routing, JSON bodies, cookies, static files,
// security headers, error handling and per-route metrics.
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://script.google.com https://*.googleusercontent.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const h = { ...SECURITY_HEADERS, ...headers };
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.writeHead(status, h); res.end(body); return;
  }
  h['Content-Type'] = 'application/json; charset=utf-8';
  h['Cache-Control'] = 'no-store';
  res.writeHead(status, h);
  res.end(JSON.stringify(body));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(root, req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || !path.extname(p)) p = '/index.html'; // SPA fallback
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(path.normalize(root))) { send(res, 403, 'Forbidden'); return true; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file);
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
  return true;
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '\\/?$');
    this.routes.push({ method, pattern, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { route: r, params }; }
    }
    return null;
  }
}

function recordMetric(route, ms, isError) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    db.get().prepare(`INSERT INTO request_metrics(day, route, count, errors, total_ms) VALUES (?,?,1,?,?)
      ON CONFLICT(day, route) DO UPDATE SET count=count+1, errors=errors+excluded.errors, total_ms=total_ms+excluded.total_ms`)
      .run(day, route, isError ? 1 : 0, Math.round(ms));
  } catch { /* metrics are best-effort */ }
}

function createHandler(router, { staticRoot, before = [] }) {
  return async (req, res) => {
    const started = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), cookies: parseCookies(req.headers.cookie), params: {}, body: null, user: null, ip: req.socket.remoteAddress };
    let routeLabel = 'static';
    let isError = false;
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/share/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, 'Not found');
        routeLabel = `${req.method} ${m.route.pattern}`;
        ctx.params = m.params;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const raw = await readBody(req);
          const ct = req.headers['content-type'] || '';
          if (raw.length && ct.includes('application/json')) {
            try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body'); }
          } else ctx.body = {};
        }
        for (const mw of before) await mw(ctx);
        for (const h of m.route.handlers) {
          const out = await h(ctx);
          if (res.headersSent) break;
          if (out !== undefined) { send(res, 200, out); break; }
        }
        if (!res.headersSent) send(res, 204, '');
      } else if (req.method === 'GET') {
        if (!serveStatic(staticRoot, req, res)) send(res, 404, 'Not found');
      } else throw new HttpError(405, 'Method not allowed');
    } catch (err) {
      isError = true;
      const status = err.status || 500;
      if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`, err);
      send(res, status, { error: status >= 500 ? 'Internal server error' : err.message, details: err.details });
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (routeLabel !== 'static') recordMetric(routeLabel, ms, isError);
    }
  };
}

module.exports = { Router, HttpError, send, createHandler };
