'use strict';
const http = require('node:http');
const path = require('node:path');
const config = require('./src/config');
const db = require('./src/db');
const seed = require('./src/seed');
const fx = require('./src/fx');
const auth = require('./src/auth');
const { createHandler } = require('./src/http');

function createServer({ dbFile, autoFx = true } = {}) {
  db.open(dbFile);
  const s = seed.run();
  if (s.providers || s.benchmarks) console.log(`[seed] providers +${s.providers}, benchmarks +${s.benchmarks}`);
  // Expire stale sessions hourly.
  setInterval(() => db.get().prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()), 3600000).unref();
  if (autoFx) fx.startAutoRefresh();
  require('./src/services/searchService').resumePending();
  const router = require('./src/routes');
  return http.createServer(createHandler(router, { staticRoot: path.join(__dirname, 'public'), before: [auth.attachUser] }));
}

if (require.main === module) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`FreightIQ listening on http://${config.host}:${config.port}`);
    if (config.authDisabled) console.log('⚠ TEST MODE (AUTH_DISABLED=true): no login required — every visitor is an administrator. Do not use with real client data.');
    const n = db.get().prepare('SELECT COUNT(*) c FROM users').get().c;
    if (!n && !config.authDisabled) console.log('No users yet — create the first administrator:  npm run create-admin -- admin@example.com "StrongPass123" "Your Name"');
    if (!config.anthropicApiKey) console.log('ANTHROPIC_API_KEY not set — AI web research disabled; assistant runs in rule-based mode.');
  });
  const stop = () => { console.log('Shutting down…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

module.exports = { createServer };
