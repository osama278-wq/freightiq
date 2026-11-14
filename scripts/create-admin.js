'use strict';
// Usage: npm run create-admin -- <email> <password> [name]
const db = require('../src/db');
const seed = require('../src/seed');
const [email, password, ...nameParts] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-admin -- <email> <password> [name]'); process.exit(1); }
db.open();
seed.run();
try {
  const r = seed.ensureAdmin(email, password, nameParts.join(' ') || 'Administrator');
  console.log(r.created ? `Administrator ${email} created.` : `User ${email} already exists — nothing changed.`);
} catch (e) { console.error('Error:', e.message); process.exit(1); }
