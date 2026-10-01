#!/usr/bin/env node
// Usage: node scripts/seed-admin.js you@company.com 'your-password'
// Creates (or updates) a confirmed Supabase auth account with that password and upserts
// a profiles row with role = 'admin', so the email can sign in at /login immediately.
// Run db/001_init.sql in Supabase first.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../lib/supabase');

const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.argv[3] || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/seed-admin.js you@company.com 'your-password'");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters (Supabase minimum).');
  process.exit(1);
}

async function findUser() {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find(u => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

(async () => {
  let user = await findUser();
  let created = false;

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Create user failed: ' + error.message);
    user = data.user;
    created = true;
  } else {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error('Update password failed: ' + error.message);
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: user.id, email, role: 'admin' }, { onConflict: 'id' });
  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) {
      throw new Error('profiles table is missing. Run db/001_init.sql in the Supabase SQL editor first.');
    }
    throw new Error(error.message);
  }

  console.log(`${created ? 'Created' : 'Updated'} admin account: ${email}`);
  console.log('They can sign in at /login now.');
})().catch(e => { console.error(e.message); process.exit(1); });
