const assert = require('assert');
const http = require('http');
const { createApp } = require('../src/app');
const { createContactService } = require('../src/lib/contacts');
const { createAuth } = require('../src/auth/middleware');
const { fieldIds } = require('../src/ghl/field-map');

const { fakeGhl, fakeDb } = require('./fakes');

// ── harness ───────────────────────────────────────────────────────────
async function setup() {
  const ghl = fakeGhl();
  const db = fakeDb();
  const tokens = {}; // token -> auth user
  const authUsers = [];
  const sentInvites = [];
  const deletedUsers = [];
  const hookBodies = [];

  const hook = http.createServer((req, res) => {
    let d = ''; req.on('data', c => { d += c; });
    req.on('end', () => { hookBodies.push(JSON.parse(d)); res.end('ok'); });
  });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));

  const signUps = [], resends = [];
  const unverified = new Set(['unverified@x.com']);
  const supabaseAnon = { auth: {
    async signUp(args) { signUps.push(args); return { data: { user: { id: 'su' } }, error: null }; },
    async resend(args) { resends.push(args); return { data: {}, error: null }; },
    async signInWithPassword({ email }) {
      if (unverified.has(email)) return { data: {}, error: { code: 'email_not_confirmed', message: 'Email not confirmed' } };
      return { data: { session: null }, error: { message: 'Invalid login credentials' } };
    },
    async getUser(token) { const u = tokens[token]; return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'bad' } }; },
    async refreshSession({ refresh_token }) {
      return refresh_token === 'good-refresh'
        ? { data: { session: { access_token: 'new-a', refresh_token: 'new-r', expires_at: 123, expires_in: 3600, user: { email: 'x' } } }, error: null }
        : { data: { session: null }, error: { message: 'invalid' } };
    },
  } };
  const supabaseAdmin = { auth: { admin: {
    async inviteUserByEmail(email, opts) {
      if (authUsers.find(u => u.email === email)) return { error: { message: 'User already registered' } };
      const u = { id: 'auth-' + email, email }; authUsers.push(u); sentInvites.push({ email, ...opts }); return { data: { user: u }, error: null };
    },
    async listUsers() { return { data: { users: authUsers }, error: null }; },
    async deleteUser(id) { deletedUsers.push(id); return { error: null }; },
  } } };

  const config = {
    NODE_ENV: 'test', FRONTEND_URL: 'https://app.example.com', PORTAL_ORIGIN: '', SITE_ORIGIN: '',
    GHL_INBOUND_WEBHOOK_URL: '', GHL_INBOUND_WEBHOOK_SECRET: '',
    GHL_CHANGE_REQUEST_WEBHOOK_URL: `http://127.0.0.1:${hook.address().port}/hook`,
    CSM_USER_ID: 'csm-1', GENERATOR_WEBHOOK_SECRET: 'gen-secret',
  };
  const contacts = createContactService({ ghl, db });
  const auth = createAuth({ supabaseAnon, db, contacts });
  const app = createApp({ config, ghl, db, contacts, auth, supabaseAnon, supabaseAdmin });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    let json = null; try { json = await res.json(); } catch (_) {}
    return { status: res.status, body: json };
  };

  // sign up: admin invites (so the invite row exists), then the user's first call creates the profile
  const addUser = (id, email, extra = {}) => { tokens['t-' + id] = { id, email, ...extra }; return 't-' + id; };
  const makeAdmin = async (id, email) => { await db.upsertProfile({ id, email, role: 'admin' }); return addUser(id, email); };
  const makeClient = async (id, email) => {
    await db.createInvite({ email, invitedBy: 'u-admin' });
    const token = addUser(id, email);
    const r = await call('GET', '/api/auth/me', { token }); // first call creates profile + contact
    assert.strictEqual(r.status, 200);
    return token;
  };

  const close = async () => { server.close(); hook.close(); };
  return { ghl, db, call, addUser, makeAdmin, makeClient, sentInvites, deletedUsers, hookBodies, signUps, resends, close };
}

// ── tests ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(name, fn) {
  const t = await setup();
  try { await fn(t); console.log(`  [PASS] ${name}`); passed++; }
  catch (e) { console.error(`  [FAIL] ${name}: ${e.message}`); failed++; }
  finally { await t.close(); }
}

const FIELDS = {
  legalFirstName: 'Alice', legalLastName: 'Lee', personalEmail: 'alice@x.com', personalPhone: '5551112222',
  bizNameInput: 'Lee Advisory', themeSelect: 'NIL Consulting', domainInput: 'leeadvisory.com',
  team_name_1: 'Bob', team_role_1: 'CFO', preferredContact: 'Email', contactTimeMorning: true,
};
const SEL = { tpl: 'sidebar', fnt: 'Contemporary', pal: 'Oxblood', thm: 'NIL Consulting', variant: 2, nav0: 0, nav1: 3, nav2: 1, heroPg: ['sport-arena-09', 'fill:accent-dark', 'nohero'] };
const cfValue = (contact, name) => contact.customFields.find(f => f.id === fieldIds[name])?.value;

(async () => {
  console.log('\n=== Route Tests (real routers, fake GHL + DB) ===\n');

  await test('unauthenticated requests are rejected', async ({ call }) => {
    assert.strictEqual((await call('GET', '/api/portal/prefill')).status, 401);
    assert.strictEqual((await call('GET', '/api/admin/clients')).status, 401);
    assert.strictEqual((await call('GET', '/api/portal/prefill', { token: 'nope' })).status, 401);
  });

  await test('a Supabase user with an unverified email and no invite is refused (no profile created)', async ({ call, addUser, db }) => {
    const token = addUser('u-stranger', 'stranger@x.com');
    const r = await call('GET', '/api/auth/me', { token });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.error, 'EMAIL_NOT_VERIFIED');
    assert.strictEqual(db.profiles['u-stranger'], undefined);
  });

  await test('a self-signup user with a verified email gets a client profile + linked GHL contact', async ({ call, addUser, db, ghl }) => {
    const token = addUser('u-self', 'self@x.com', { email_confirmed_at: '2026-10-01T00:00:00Z' });
    const r = await call('GET', '/api/auth/me', { token });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.role, 'client');
    assert.ok(ghl.contacts[db.profiles['u-self'].ghl_contact_id]);
    assert.strictEqual(db.audit[0].meta.via, 'self');
  });

  await test('signup sends a verification email via Supabase with the right redirect; validates input', async ({ call, signUps }) => {
    const ok = await call('POST', '/api/auth/signup', { body: { email: ' New@Lead.com ', password: 'longenough1', fullName: 'New Lead' } });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(signUps.length, 1);
    assert.strictEqual(signUps[0].email, 'new@lead.com');
    assert.strictEqual(signUps[0].options.emailRedirectTo, 'https://app.example.com/client/login');
    assert.strictEqual(signUps[0].options.data.full_name, 'New Lead');
    assert.strictEqual((await call('POST', '/api/auth/signup', { body: { email: 'nope', password: 'longenough1', fullName: 'A' } })).body.error, 'INVALID_EMAIL');
    assert.strictEqual((await call('POST', '/api/auth/signup', { body: { email: 'a@b.co', password: 'short', fullName: 'A' } })).body.error, 'WEAK_PASSWORD');
    assert.strictEqual((await call('POST', '/api/auth/signup', { body: { email: 'a@b.co', password: 'longenough1' } })).body.error, 'NAME_REQUIRED');
    assert.strictEqual(signUps.length, 1);
  });

  await test('login: unverified email gets EMAIL_NOT_VERIFIED, wrong password stays INVALID_CREDENTIALS; resend always answers ok', async ({ call, resends }) => {
    const un = await call('POST', '/api/auth/login', { body: { email: 'Unverified@x.com', password: 'whatever1' } });
    assert.strictEqual(un.status, 403);
    assert.strictEqual(un.body.error, 'EMAIL_NOT_VERIFIED');
    const bad = await call('POST', '/api/auth/login', { body: { email: 'other@x.com', password: 'whatever1' } });
    assert.strictEqual(bad.status, 401);
    assert.strictEqual(bad.body.error, 'INVALID_CREDENTIALS');
    assert.strictEqual((await call('POST', '/api/auth/resend-verification', { body: { email: 'unverified@x.com' } })).status, 200);
    assert.strictEqual(resends[0].type, 'signup');
    assert.strictEqual((await call('POST', '/api/auth/resend-verification', { body: { email: 'junk' } })).status, 200);
    assert.strictEqual(resends.length, 1);
  });

  await test('client cannot reach admin routes', async ({ call, makeClient }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    for (const [m, p] of [['GET', '/api/admin/clients'], ['GET', '/api/admin/change-requests'], ['POST', '/api/admin/invites']]) {
      assert.strictEqual((await call(m, p, { token, body: { email: 'a@b.co' } })).status, 403, p);
    }
  });

  await test('admin sends an invite; duplicates and bad emails are rejected', async ({ call, makeAdmin, sentInvites }) => {
    const admin = await makeAdmin('u-admin', 'admin@x.com');
    const ok = await call('POST', '/api/admin/invites', { token: admin, body: { email: 'New@Client.com ' } });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(sentInvites[0].email, 'new@client.com');
    assert.strictEqual(sentInvites[0].redirectTo, 'https://app.example.com/set-password');
    assert.strictEqual((await call('POST', '/api/admin/invites', { token: admin, body: { email: 'new@client.com' } })).body.error, 'INVITE_PENDING');
    assert.strictEqual((await call('POST', '/api/admin/invites', { token: admin, body: { email: 'nope' } })).body.error, 'INVALID_EMAIL');
  });

  await test('a brand-new client is "not_started" even though their contact already has the account email', async ({ call, makeClient, makeAdmin }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    const o = (await call('GET', '/api/client/overview', { token })).body;
    assert.strictEqual(o.summary.state, 'not_started');
    assert.strictEqual(o.summary.progress.information.filled, 0);
    const admin = await makeAdmin('u-admin', 'admin@x.com');
    assert.strictEqual((await call('GET', '/api/admin/clients', { token: admin })).body.clients[0].state, 'not_started');
  });

  await test('invited client gets a profile + linked GHL contact on first call, invite becomes accepted', async ({ makeClient, db, ghl }) => {
    await makeClient('u-alice', 'alice@x.com');
    const p = db.profiles['u-alice'];
    assert.strictEqual(p.role, 'client');
    assert.ok(p.ghl_contact_id && ghl.contacts[p.ghl_contact_id]);
    assert.strictEqual(ghl.contacts[p.ghl_contact_id].email, 'alice@x.com');
    assert.strictEqual(db.invites[0].status, 'accepted');
  });

  await test('revoking an unused invite deletes the never-used auth account', async ({ call, makeAdmin, deletedUsers, db }) => {
    const admin = await makeAdmin('u-admin', 'admin@x.com');
    await call('POST', '/api/admin/invites', { token: admin, body: { email: 'gone@x.com' } });
    const r = await call('DELETE', `/api/admin/invites/${db.invites[0].id}`, { token: admin });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(deletedUsers, ['auth-gone@x.com']);
    assert.strictEqual(db.invites[0].status, 'revoked');
  });

  await test('save writes answers incl. secondary contact; GHL accepts them (no unknown top-level props)', async ({ call, makeClient, db, ghl }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    const r = await call('POST', '/api/portal/save', { token, body: { fields: FIELDS, sel: SEL } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const c = ghl.contacts[db.profiles['u-alice'].ghl_contact_id];
    assert.strictEqual(cfValue(c, 'Business Name'), 'Lee Advisory');
    assert.strictEqual(cfValue(c, 'Secondary Contact Name'), 'Bob');
    assert.deepStrictEqual(cfValue(c, 'Preferred Contact Time'), ['Morning']);
    assert.strictEqual(JSON.parse(cfValue(c, 'Site Config')).tpl, 'sidebar');
    const pre = (await call('GET', '/api/portal/prefill', { token })).body;
    assert.strictEqual(pre.fields.bizNameInput, 'Lee Advisory');
    assert.strictEqual(pre.fields.team_name_1, 'Bob');
    assert.strictEqual(pre.sel.tpl, 'sidebar');
  });

  await test('re-saving identical answers is a no-op: no GHL write, no extra Note', async ({ call, makeClient, ghl }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    const body = { fields: { ...FIELDS, contactTimeEvening: false, team_name_2: '' }, sel: { ...SEL, pg: 0 } };
    assert.strictEqual((await call('POST', '/api/portal/save', { token, body })).body.unchanged, undefined);
    const notes = ghl.notes.length;
    const again = await call('POST', '/api/portal/save', { token, body: { ...body, sel: { ...SEL, pg: 2 } } }); // pg is only the open tab
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.unchanged, true);
    assert.strictEqual(ghl.notes.length, notes);
    const changed = await call('POST', '/api/portal/save', { token, body: { ...body, fields: { ...body.fields, bizNameInput: 'Renamed' } } });
    assert.strictEqual(changed.body.unchanged, undefined);
    assert.strictEqual(ghl.notes.length, notes + 1);
  });

  await test('identity spoofing: body email / contact id are ignored, other clients are untouched', async ({ call, makeClient, db, ghl }) => {
    const alice = await makeClient('u-alice', 'alice@x.com');
    await makeClient('u-bob', 'bob@x.com');
    const bobContact = ghl.contacts[db.profiles['u-bob'].ghl_contact_id];
    await call('POST', '/api/portal/save', { token: alice, body: { email: 'bob@x.com', contactId: bobContact.id, id: bobContact.id, fields: { bizNameInput: 'Alice Co' }, sel: {} } });
    assert.strictEqual(cfValue(bobContact, 'Business Name'), undefined);
    const aliceContact = ghl.contacts[db.profiles['u-alice'].ghl_contact_id];
    assert.strictEqual(cfValue(aliceContact, 'Business Name'), 'Alice Co');
  });

  await test('two clients never see each other\'s data', async ({ call, makeClient }) => {
    const alice = await makeClient('u-alice', 'alice@x.com');
    const bob = await makeClient('u-bob', 'bob@x.com');
    await call('POST', '/api/portal/save', { token: alice, body: { fields: { bizNameInput: 'Alice Co' }, sel: { tpl: 'split' } } });
    const seen = (await call('GET', '/api/portal/prefill', { token: bob })).body;
    assert.strictEqual(seen.fields.bizNameInput, undefined);
    assert.strictEqual(seen.sel.tpl, undefined);
  });

  await test('client cannot set lock/system fields through a save', async ({ call, makeClient }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    await call('POST', '/api/portal/save', { token, body: { fields: { bizNameInput: 'A', lockedOn: '2020-01-01', clientNumber: 'XX9999' }, sel: { lockedOn: '2020-01-01', changesUntil: '2099-01-01', completedOn: '2020-01-01' } } });
    const pre = (await call('GET', '/api/portal/prefill', { token })).body;
    assert.strictEqual(pre.status.lockedOn, '');
    assert.strictEqual(pre.status.changesUntil, '');
    assert.strictEqual(pre.site.clientNumber, '');
  });

  await test('submit: server sets one instant for completed+locked, then writes are refused (423)', async ({ call, makeClient, db, ghl }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    const r = await call('POST', '/api/portal/submit', { token, body: { fields: FIELDS, sel: { ...SEL, lockedOn: null, completedOn: '1999-01-01' } } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.completedOn, r.body.lockedOn);
    const c = ghl.contacts[db.profiles['u-alice'].ghl_contact_id];
    assert.strictEqual(cfValue(c, 'Portal Completed On'), cfValue(c, 'Locked On'));
    assert.ok(ghl.notes.some(n => /submitted their portal/.test(n.body)));
    const pre = (await call('GET', '/api/portal/prefill', { token })).body;
    assert.strictEqual(pre.status.lockedOn, r.body.lockedOn, 'exact instant comes back from Site Config');
    assert.strictEqual(pre.status.completedOn, pre.status.lockedOn);
    assert.strictEqual((await call('POST', '/api/portal/save', { token, body: { fields: { bizNameInput: 'Hacked' }, sel: {} } })).status, 423);
    assert.strictEqual((await call('POST', '/api/portal/save', { token, body: { fields: { bizNameInput: 'Hacked', lockedOn: null }, sel: { lockedOn: null } } })).status, 423);
    assert.strictEqual((await call('POST', '/api/portal/submit', { token, body: { fields: {}, sel: {} } })).status, 423);
    assert.strictEqual(cfValue(c, 'Business Name'), 'Lee Advisory');
  });

  async function lockedClient(t, id = 'u-alice', email = 'alice@x.com') {
    const token = await t.makeClient(id, email);
    await t.call('POST', '/api/portal/submit', { token, body: { fields: FIELDS, sel: SEL } });
    return token;
  }

  await test('change request: stored as pending, GHL note + task + webhook, portal stays locked, no field changed', async (t) => {
    const token = await lockedClient(t);
    const r = await t.call('POST', '/api/portal/change-request', { token, body: { type: 'change_request', part: 'website', text: 'Please change my tagline' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.request.status, 'pending');
    const c = t.ghl.contacts[t.db.profiles['u-alice'].ghl_contact_id];
    assert.ok(t.ghl.notes.some(n => /Change request \(website\)/.test(n.body)));
    assert.strictEqual(t.ghl.tasks.length, 1);
    assert.strictEqual(t.ghl.tasks[0].assignedTo, 'csm-1');
    assert.strictEqual(t.hookBodies.length, 1);
    assert.strictEqual(t.hookBodies[0].type, 'change_request');
    assert.strictEqual(t.hookBodies[0].requestId, r.body.request.id);
    assert.strictEqual(cfValue(c, 'Business Name'), 'Lee Advisory');
    const pre = (await t.call('GET', '/api/portal/prefill', { token })).body;
    assert.ok(pre.status.lockedOn, 'still locked');
    assert.strictEqual(pre.sel.changeRequests.length, 1);
    assert.strictEqual(pre.sel.changeRequests[0].status, 'pending');
    assert.strictEqual((await t.call('POST', '/api/portal/change-request', { token, body: { type: 'change_request', part: 'nope', text: 'x' } })).status, 400);
    assert.strictEqual((await t.call('POST', '/api/portal/change-request', { token, body: { type: 'change_request', part: 'team', text: 'x'.repeat(2001) } })).status, 400);
  });

  await test('client sees their request statuses', async (t) => {
    const token = await lockedClient(t);
    await t.call('POST', '/api/portal/change-request', { token, body: { type: 'change_request', part: 'team', text: 'Add a member' } });
    const r = (await t.call('GET', '/api/client/change-requests', { token })).body;
    assert.strictEqual(r.requests.length, 1);
    assert.strictEqual(r.requests[0].status, 'pending');
  });

  await test('admin sees client info + selected design + state + pending count', async (t) => {
    const client = await lockedClient(t);
    await t.call('POST', '/api/portal/change-request', { token: client, body: { type: 'change_request', part: 'website', text: 'Tweak' } });
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    const list = (await t.call('GET', '/api/admin/clients', { token: admin })).body.clients;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].state, 'submitted');
    assert.strictEqual(list[0].pendingRequests, 1);
    assert.strictEqual(list[0].businessName, 'Lee Advisory');
    assert.strictEqual(list[0].template, 'sidebar');
    const d = (await t.call('GET', '/api/admin/clients/u-alice', { token: admin })).body;
    assert.strictEqual(d.fields.legalFirstName, 'Alice');
    assert.strictEqual(d.design.palette, 'Oxblood');
    assert.strictEqual(d.design.paletteHex, '#5C1F1F');
    assert.strictEqual(d.design.templateLabel, 'Sidebar');
    assert.strictEqual(d.design.fontPair, 'Space Grotesk + Manrope');
    assert.strictEqual(d.design.variantLabel, 'C');
    assert.deepStrictEqual(d.design.pageNames, ['Why We Exist', 'Our Focus', 'Get in Touch']);
    assert.deepStrictEqual(d.design.heroLabels, ['sport arena photo', 'Solid colour (accent dark)', 'No image']);
    assert.deepStrictEqual(d.design.heroImages, SEL.heroPg);
    assert.strictEqual(d.requests.length, 1);
    const pre = (await t.call('GET', '/api/admin/clients/u-alice/prefill', { token: admin })).body;
    assert.strictEqual(pre.sel.tpl, 'sidebar');
    assert.ok(pre.status.lockedOn);
    assert.strictEqual((await t.call('GET', '/api/admin/clients/nobody', { token: admin })).status, 404);
  });

  await test('approve: request approved, portal reopens (Locked On cleared, window set), client can edit and re-submit', async (t) => {
    const client = await lockedClient(t);
    const cr = (await t.call('POST', '/api/portal/change-request', { token: client, body: { type: 'change_request', part: 'website', text: 'Tweak' } })).body.request;
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    const r = await t.call('POST', `/api/admin/change-requests/${cr.id}/approve`, { token: admin, body: { note: 'Go ahead' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.request.status, 'approved');
    const pre = (await t.call('GET', '/api/portal/prefill', { token: client })).body;
    assert.strictEqual(pre.status.lockedOn, '');
    assert.ok(new Date(pre.status.changesUntil) > new Date(), 'window is open');
    assert.strictEqual(pre.sel.changeRequests[0].status, 'approved');
    assert.strictEqual(pre.sel.changeRequests[0].adminNote, 'Go ahead');
    assert.strictEqual((await t.call('POST', '/api/portal/save', { token: client, body: { fields: { taglineInput: 'New' }, sel: {} } })).status, 200);
    assert.strictEqual((await t.call('POST', '/api/portal/submit', { token: client, body: { fields: FIELDS, sel: SEL } })).status, 200);
    assert.strictEqual((await t.call('POST', '/api/portal/save', { token: client, body: { fields: {}, sel: {} } })).status, 423, 're-locked after confirm');
    assert.strictEqual((await t.call('POST', `/api/admin/change-requests/${cr.id}/approve`, { token: admin, body: {} })).status, 409);
  });

  await test('reject: portal stays locked, status + note recorded', async (t) => {
    const client = await lockedClient(t);
    const cr = (await t.call('POST', '/api/portal/change-request', { token: client, body: { type: 'change_request', part: 'you', text: 'Change my name' } })).body.request;
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    const r = await t.call('POST', `/api/admin/change-requests/${cr.id}/reject`, { token: admin, body: { note: 'Not possible' } });
    assert.strictEqual(r.status, 200);
    const pre = (await t.call('GET', '/api/portal/prefill', { token: client })).body;
    assert.ok(pre.status.lockedOn, 'still locked');
    assert.strictEqual(pre.sel.changeRequests[0].status, 'rejected');
    assert.strictEqual((await t.call('POST', '/api/portal/save', { token: client, body: { fields: {}, sel: {} } })).status, 423);
    const mine = (await t.call('GET', '/api/client/change-requests', { token: client })).body.requests[0];
    assert.strictEqual(mine.status, 'rejected');
    assert.strictEqual(mine.adminNote, 'Not possible');
  });

  await test('a client cannot approve their own request', async (t) => {
    const client = await lockedClient(t);
    const cr = (await t.call('POST', '/api/portal/change-request', { token: client, body: { type: 'change_request', part: 'website', text: 'x' } })).body.request;
    assert.strictEqual((await t.call('POST', `/api/admin/change-requests/${cr.id}/approve`, { token: client, body: {} })).status, 403);
    assert.strictEqual(t.db.requests[0].status, 'pending');
  });

  await test('admin edit works while locked but still cannot touch lock/system fields', async (t) => {
    await lockedClient(t);
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    const r = await t.call('PUT', '/api/admin/clients/u-alice/details', { token: admin, body: { fields: { taglineInput: 'Admin tagline', lockedOn: '', clientNumber: 'ZZ0001' }, sel: { pal: 'Navy', lockedOn: '' } } });
    assert.strictEqual(r.status, 200);
    const c = t.ghl.contacts[t.db.profiles['u-alice'].ghl_contact_id];
    assert.strictEqual(cfValue(c, 'Site Tagline'), 'Admin tagline');
    assert.strictEqual(cfValue(c, 'Client Number'), undefined);
    const d = (await t.call('GET', '/api/admin/clients/u-alice', { token: admin })).body;
    assert.strictEqual(d.design.palette, 'Navy');
    assert.strictEqual(d.design.template, 'sidebar', 'unrelated design choices preserved');
    assert.ok(d.status.lockedOn, 'still locked');
  });

  await test('admin reopen / lock', async (t) => {
    const token = await t.makeClient('u-alice', 'alice@x.com');
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    assert.strictEqual((await t.call('POST', '/api/admin/clients/u-alice/reopen', { token: admin, body: {} })).status, 409, 'not locked yet');
    assert.strictEqual((await t.call('POST', '/api/admin/clients/u-alice/lock', { token: admin })).status, 200);
    assert.strictEqual((await t.call('POST', '/api/portal/save', { token, body: { fields: {}, sel: {} } })).status, 423);
    assert.strictEqual((await t.call('POST', '/api/admin/clients/u-alice/lock', { token: admin })).status, 409);
    const re = await t.call('POST', '/api/admin/clients/u-alice/reopen', { token: admin, body: { hours: 48 } });
    assert.strictEqual(re.status, 200);
    assert.strictEqual((await t.call('POST', '/api/portal/save', { token, body: { fields: {}, sel: {} } })).status, 200);
    const list = (await t.call('GET', '/api/admin/clients', { token: admin })).body.clients;
    assert.strictEqual(list[0].state, 'reopened');
  });

  await test('token refresh proxies a valid refresh token and returns only the session fields', async ({ call }) => {
    const ok = await call('POST', '/api/auth/refresh', { body: { refresh_token: 'good-refresh' } });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(ok.body, { access_token: 'new-a', refresh_token: 'new-r', expires_at: 123, expires_in: 3600 });
    assert.strictEqual((await call('POST', '/api/auth/refresh', { body: { refresh_token: 'bad' } })).status, 401);
    assert.strictEqual((await call('POST', '/api/auth/refresh', { body: {} })).status, 400);
  });

  await test('admin prefill (used for the read-only portal view) names the client', async (t) => {
    await lockedClient(t);
    const admin = await t.makeAdmin('u-admin', 'admin@x.com');
    const r = (await t.call('GET', '/api/admin/clients/u-alice/prefill', { token: admin })).body;
    assert.deepStrictEqual(r.client, { id: 'u-alice', email: 'alice@x.com', name: 'Alice Lee' });
    assert.strictEqual(r.fields.bizNameInput, 'Lee Advisory');
    const client = await t.makeClient('u-bob', 'bob@x.com');
    assert.strictEqual((await t.call('GET', '/api/admin/clients/u-alice/prefill', { token: client })).status, 403);
  });

  await test('public signup request: creates pending row, dedupes silently, requires fields', async ({ call, db }) => {
    const ok = await call('POST', '/api/signup-request', { body: { email: 'New@Lead.com', fullName: 'New Lead', company: 'Acme', message: 'Hi' } });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(db.signupRequests.length, 1);
    assert.strictEqual(db.signupRequests[0].email, 'new@lead.com');
    assert.strictEqual(db.signupRequests[0].status, 'pending');

    // Duplicate while pending → silent 200, no new row (no enumeration).
    const dup = await call('POST', '/api/signup-request', { body: { email: 'new@lead.com', fullName: 'Dup' } });
    assert.strictEqual(dup.status, 200);
    assert.strictEqual(db.signupRequests.length, 1);

    // Already a profile → silent 200, no row.
    await db.upsertProfile({ id: 'u-x', email: 'exists@lead.com', role: 'client' });
    const existing = await call('POST', '/api/signup-request', { body: { email: 'exists@lead.com', fullName: 'Exists' } });
    assert.strictEqual(existing.status, 200);
    assert.strictEqual(db.signupRequests.length, 1);

    assert.strictEqual((await call('POST', '/api/signup-request', { body: { email: 'nope', fullName: 'X' } })).body.error, 'INVALID_EMAIL');
    assert.strictEqual((await call('POST', '/api/signup-request', { body: { email: 'ok@x.com' } })).body.error, 'NAME_REQUIRED');
  });

  await test('admin: list, approve (sends invite), reject signup requests', async ({ call, makeAdmin, db, sentInvites }) => {
    const admin = await makeAdmin('u-admin', 'admin@x.com');
    await call('POST', '/api/signup-request', { body: { email: 'a@lead.com', fullName: 'A Lead' } });
    await call('POST', '/api/signup-request', { body: { email: 'b@lead.com', fullName: 'B Lead' } });

    const list = (await call('GET', '/api/admin/signup-requests', { token: admin })).body;
    assert.strictEqual(list.requests.length, 2);
    assert.strictEqual(list.requests[0].status, 'pending');

    const sr1 = db.signupRequests.find(r => r.email === 'a@lead.com');
    const appr = await call('POST', `/api/admin/signup-requests/${sr1.id}/approve`, { token: admin, body: { note: 'Welcome' } });
    assert.strictEqual(appr.status, 200);
    assert.strictEqual(appr.body.request.status, 'approved');
    assert.strictEqual(sentInvites.length, 1);
    assert.strictEqual(sentInvites[0].email, 'a@lead.com');
    assert.strictEqual(db.invites.length, 1);

    const sr2 = db.signupRequests.find(r => r.email === 'b@lead.com');
    const rej = await call('POST', `/api/admin/signup-requests/${sr2.id}/reject`, { token: admin, body: { note: 'Not a fit' } });
    assert.strictEqual(rej.status, 200);
    assert.strictEqual(rej.body.request.status, 'rejected');
    assert.strictEqual(sentInvites.length, 1, 'reject does not send invite');

    // Deciding twice is refused.
    assert.strictEqual((await call('POST', `/api/admin/signup-requests/${sr1.id}/approve`, { token: admin, body: {} })).status, 409);
    assert.strictEqual((await call('POST', `/api/admin/signup-requests/${sr2.id}/reject`, { token: admin, body: {} })).status, 409);

    // Pending filter.
    const pending = (await call('GET', '/api/admin/signup-requests?status=pending', { token: admin })).body;
    assert.strictEqual(pending.requests.length, 0);
  });

  await test('signup-request endpoints: clients cannot reach the admin side', async ({ call, makeClient }) => {
    const token = await makeClient('u-alice', 'alice@x.com');
    assert.strictEqual((await call('GET', '/api/admin/signup-requests', { token })).status, 403);
    assert.strictEqual((await call('POST', '/api/admin/signup-requests/nope/approve', { token, body: {} })).status, 403);
  });

  await test('generator webhook requires its secret', async ({ call }) => {
    assert.strictEqual((await call('POST', '/api/generator/on-lock', { body: { contactId: 'x' } })).status, 401);
  });

  console.log(`\n=== Route results: ${passed} passed, ${failed} failed ===\n`);
  if (failed) process.exit(1);
})();
