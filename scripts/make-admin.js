#!/usr/bin/env node
// Usage: node scripts/make-admin.js you@company.com
// Makes that email an admin. If it has no Supabase account yet, an invite email
// (set-password link) is sent. Run db/001_init.sql in Supabase first.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../lib/supabase');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/make-admin.js you@company.com');
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
  let invited = false;
  if (!user) {
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: `${frontend}/set-password` });
    if (error) throw new Error('Invite failed: ' + error.message);
    user = data.user;
    invited = true;
  }

  const { error } = await supabaseAdmin.from('profiles')
    .upsert({ id: user.id, email, role: 'admin' }, { onConflict: 'id' });
  if (error) {
    if (/relation .* does not exist|schema cache/i.test(error.message)) {
      throw new Error('profiles table is missing. Run db/001_init.sql in the Supabase SQL editor first.');
    }
    throw new Error(error.message);
  }

  console.log(`${email} is now an admin.`);
  if (invited) console.log('No account existed, so an invite email was sent. Open it to set a password.');
})().catch(e => { console.error(e.message); process.exit(1); });
