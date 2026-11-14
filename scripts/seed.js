'use strict';
// Seeds reference data. With --demo also creates two demo client organisations and users
// (for evaluation only — remove before production).
const db = require('../src/db');
const seed = require('../src/seed');
const auth = require('../src/auth');
db.open();
console.log('Seed:', seed.run());
if (process.argv.includes('--demo')) {
  const d = db.get();
  const mk = (name) => { const e = d.prepare('SELECT id FROM organizations WHERE name=?').get(name); return e ? e.id : Number(d.prepare("INSERT INTO organizations(name, type, country) VALUES (?, 'client', 'OM')").run(name).lastInsertRowid); };
  const users = [
    ['ops@demo-operator.test', 'Operations Staff', 'staff', seed.ensureOperator().id],
    ['buyer@client-a.test', 'Client A Buyer', 'client_admin', mk('Demo Client A LLC')],
    ['buyer@client-b.test', 'Client B Buyer', 'client_user', mk('Demo Client B SAOC')],
  ];
  for (const [email, name, role, org] of users) {
    if (!d.prepare('SELECT 1 FROM users WHERE email=?').get(email)) d.prepare('INSERT INTO users(org_id,email,name,password_hash,role) VALUES (?,?,?,?,?)').run(org, email, name, auth.hashPassword('DemoPass2026'), role);
  }
  console.log('Demo users created (password DemoPass2026):', users.map((u) => u[0]).join(', '));
}
