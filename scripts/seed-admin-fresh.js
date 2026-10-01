#!/usr/bin/env node
// Usage: node scripts/seed-admin-fresh.js you@company.com 'your-password'
// Like seed-admin.js, but never calls listUsers() — use this when an earlier
// broken row in auth.users makes listUsers() fail with "Database error finding users".
// Only call this for an email that does NOT already exist in auth.users.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../lib/supabase');

const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.argv[3] || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/seed-admin-fresh.js you@company.com 'your-password'");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

(async () => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      throw new Error(`${email} already exists in auth.users. Pick a different email, or clean it up first.`);
    }
    throw new Error('Create user failed: ' + error.message);
  }
  const user = data.user;

  const { error: perr } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: user.id, email, role: 'admin' }, { onConflict: 'id' });
  if (perr) throw new Error('Profile upsert failed: ' + perr.message);

  console.log(`Created admin account: ${email}`);
  console.log('Sign in at /admin/login in the SPA.');
})().catch((e) => { console.error(e.message); process.exit(1); });
