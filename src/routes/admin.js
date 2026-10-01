const express = require('express');
const { stripForbiddenFields, ghlToPortalPrefill } = require('../ghl/field-map');
const { isLocked } = require('../lib/dates');
const { normalizeEmail } = require('../auth/middleware');
const { summarize, design, displayName } = require('../lib/summary');
const { emptyPrefill } = require('../lib/contacts');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function adminRouter({ config, db, contacts, auth, supabaseAdmin }) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  const reply = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

  async function clientOr404(req, res) {
    const profile = await db.getProfile(req.params.id);
    if (!profile || profile.role !== 'client') {
      reply(res, 404, 'CLIENT_NOT_FOUND');
      return null;
    }
    return profile;
  }

  const publicRequest = (r) => ({
    id: r.id, clientId: r.client_id, part: r.part, text: r.text, status: r.status,
    adminNote: r.admin_note || '', createdAt: r.created_at, decidedAt: r.decided_at || null,
  });

  // ── clients ─────────────────────────────────────────────────
  router.get('/clients', async (req, res) => {
    try {
      const [profiles, pending] = await Promise.all([db.listProfiles('client'), db.pendingCountsByClient()]);
      const rows = await mapLimit(profiles, 5, async (profile) => {
        try {
          const contact = await contacts.find(profile);
          const prefill = contact ? ghlToPortalPrefill(contact) : emptyPrefill();
          return summarize(profile, prefill, pending[profile.id] || 0);
        } catch (err) {
          console.error('Client summary failed:', err.message);
          return { ...summarize(profile, emptyPrefill(), pending[profile.id] || 0), loadError: true };
        }
      });
      res.json({ clients: rows });
    } catch (err) {
      console.error('List clients error:', err.message);
      reply(res, 500, 'Could not load clients');
    }
  });

  router.get('/clients/:id', async (req, res) => {
    try {
      const profile = await clientOr404(req, res);
      if (!profile) return;
      const { prefill, requests } = await contacts.load(profile);
      const audit = await db.listAudit({ clientId: profile.id });
      res.json({
        summary: summarize(profile, prefill, requests.filter(r => r.status === 'pending').length),
        fields: prefill.fields,
        sel: prefill.sel,
        design: design(prefill.sel),
        status: prefill.status,
        site: prefill.site,
        requests: requests.map(publicRequest),
        audit,
      });
    } catch (err) {
      console.error('Client detail error:', err.message);
      reply(res, 500, 'Could not load client');
    }
  });

  // Same shape as /api/portal/prefill, so the portal page can render a client read-only.
  router.get('/clients/:id/prefill', async (req, res) => {
    try {
      const profile = await clientOr404(req, res);
      if (!profile) return;
      const { prefill } = await contacts.load(profile);
      res.json({ ...prefill, client: { id: profile.id, email: profile.email, name: displayName(profile, prefill.fields) } });
    } catch (err) {
      console.error('Client prefill error:', err.message);
      reply(res, 500, 'Could not load client');
    }
  });

  // Admin edits ignore the lock but are still stripped of status/system fields.
  router.put('/clients/:id/details', async (req, res) => {
    try {
      const profile = await clientOr404(req, res);
      if (!profile) return;
      const body = req.body;
      if (!isObject(body) || (body.fields !== undefined && !isObject(body.fields)) || (body.sel !== undefined && !isObject(body.sel))) {
        return reply(res, 400, 'Invalid payload');
      }

      const { contact, prefill, requests } = await contacts.load(profile, { create: true });
      const clean = stripForbiddenFields(body);
      clean.sel = contacts.buildSel(prefill.sel, clean.sel, prefill.status, requests);

      await contacts.writeDetails(contact, clean);
      await contacts.note(contact, `Details updated by admin ${req.userEmail} on ${new Date().toLocaleDateString()}.`);
      await db.addAudit({
        actorId: req.profile.id, action: 'admin.edit_details', clientId: profile.id,
        meta: { fields: Object.keys(clean.fields || {}), designChanged: !!body.sel },
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Admin edit error:', err.message);
      reply(res, 500, 'Could not save changes');
    }
  });

  router.post('/clients/:id/reopen', async (req, res) => {
    try {
      const profile = await clientOr404(req, res);
      if (!profile) return;
      const hours = Math.min(Math.max(Number(req.body && req.body.hours) || 24, 1), 168);

      const { contact, prefill, requests } = await contacts.load(profile, { create: true });
      if (!isLocked(prefill.status)) return reply(res, 409, 'NOT_LOCKED');

      const changesUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      await contacts.setStatus(contact, prefill, requests, { lockedOn: '', changesUntil });
      await contacts.note(contact, `Portal reopened by admin ${req.userEmail} until ${changesUntil}.`);
      await db.addAudit({ actorId: req.profile.id, action: 'admin.reopen', clientId: profile.id, meta: { hours, changesUntil } });
      res.json({ ok: true, changesUntil });
    } catch (err) {
      console.error('Reopen error:', err.message);
      reply(res, 500, 'Could not reopen the portal');
    }
  });

  router.post('/clients/:id/lock', async (req, res) => {
    try {
      const profile = await clientOr404(req, res);
      if (!profile) return;

      const { contact, prefill, requests } = await contacts.load(profile, { create: true });
      if (isLocked(prefill.status)) return reply(res, 409, 'ALREADY_LOCKED');

      const lockedOn = new Date().toISOString();
      await contacts.setStatus(contact, prefill, requests, { lockedOn, changesUntil: '' });
      await contacts.note(contact, `Portal locked by admin ${req.userEmail}.`);
      await db.addAudit({ actorId: req.profile.id, action: 'admin.lock', clientId: profile.id });
      res.json({ ok: true, lockedOn });
    } catch (err) {
      console.error('Lock error:', err.message);
      reply(res, 500, 'Could not lock the portal');
    }
  });

  // ── change requests ─────────────────────────────────────────
  router.get('/change-requests', async (req, res) => {
    try {
      const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
      const [rows, profiles] = await Promise.all([db.listChangeRequests({ status }), db.listProfiles('client')]);
      const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
      res.json({
        requests: rows.map(r => ({ ...publicRequest(r), clientEmail: (byId[r.client_id] || {}).email || '' })),
      });
    } catch (err) {
      console.error('List requests error:', err.message);
      reply(res, 500, 'Could not load requests');
    }
  });

  async function decide(req, res, outcome) {
    try {
      const cr = await db.getChangeRequest(req.params.id);
      if (!cr) return reply(res, 404, 'REQUEST_NOT_FOUND');
      if (cr.status !== 'pending') return reply(res, 409, 'ALREADY_DECIDED');

      const profile = await db.getProfile(cr.client_id);
      if (!profile) return reply(res, 404, 'CLIENT_NOT_FOUND');

      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
      const { contact, prefill, requests } = await contacts.load(profile, { create: true });
      const decidedLocal = { ...cr, status: outcome, admin_note: note || null };
      const updated = requests.map(r => (r.id === cr.id ? decidedLocal : r));

      let changesUntil = null;
      if (outcome === 'approved') {
        changesUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        await contacts.setStatus(contact, prefill, updated, { lockedOn: '', changesUntil });
      } else {
        await contacts.writeSiteConfig(contact, contacts.buildSel(prefill.sel, {}, prefill.status, updated));
      }
      await contacts.note(contact,
        `Change request (${cr.part}) ${outcome} by admin ${req.userEmail}.${note ? ' Note: ' + note : ''}`);

      const decided = await db.decideChangeRequest(cr.id, { status: outcome, note, by: req.profile.id });
      if (!decided) return reply(res, 409, 'ALREADY_DECIDED');

      await db.addAudit({
        actorId: req.profile.id, action: `request.${outcome}`, clientId: profile.id,
        meta: { requestId: cr.id, part: cr.part, ...(changesUntil ? { changesUntil } : {}) },
      });
      res.json({ ok: true, request: publicRequest(decided), changesUntil });
    } catch (err) {
      console.error('Decide request error:', err.message);
      reply(res, 500, 'Could not update the request');
    }
  }
  router.post('/change-requests/:id/approve', (req, res) => decide(req, res, 'approved'));
  router.post('/change-requests/:id/reject', (req, res) => decide(req, res, 'rejected'));

  // ── invites (signup links) ──────────────────────────────────
  async function findAuthUser(email) {
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const hit = data.users.find(u => normalizeEmail(u.email) === email);
      if (hit) return hit;
      if (data.users.length < 200) break;
    }
    return null;
  }

  router.get('/invites', async (req, res) => {
    try {
      res.json({ invites: await db.listInvites() });
    } catch (err) {
      console.error('List invites error:', err.message);
      reply(res, 500, 'Could not load invites');
    }
  });

  router.post('/invites', async (req, res) => {
    try {
      const email = normalizeEmail(req.body && req.body.email);
      if (!EMAIL_RE.test(email)) return reply(res, 400, 'INVALID_EMAIL');

      if (await db.getProfileByEmail(email)) return reply(res, 409, 'ALREADY_REGISTERED');
      const open = await db.findInvite(email);
      if (open && open.status === 'sent') return reply(res, 409, 'INVITE_PENDING');

      const invite = await db.createInvite({ email, invitedBy: req.profile.id });
      const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${config.FRONTEND_URL.replace(/\/$/, '')}/set-password`,
      });
      if (error) {
        await db.revokeInvite(invite.id);
        const exists = /already|registered|exists/i.test(error.message || '');
        console.error('Invite email failed:', error.message);
        return reply(res, exists ? 409 : 502, exists ? 'ALREADY_REGISTERED' : 'INVITE_EMAIL_FAILED');
      }

      await db.addAudit({ actorId: req.profile.id, action: 'invite.sent', meta: { email } });
      res.status(201).json({ ok: true, invite });
    } catch (err) {
      console.error('Invite error:', err.message);
      reply(res, 500, 'Could not send the invite');
    }
  });

  // ── signup requests (public form submissions) ──────────────
  const publicSignup = (r) => ({
    id: r.id, email: r.email, fullName: r.full_name || '', company: r.company || '',
    phone: r.phone || '', message: r.message || '', status: r.status,
    adminNote: r.admin_note || '', createdAt: r.created_at, decidedAt: r.decided_at || null,
  });

  router.get('/signup-requests', async (req, res) => {
    try {
      const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
      const rows = await db.listSignupRequests({ status });
      res.json({ requests: rows.map(publicSignup) });
    } catch (err) {
      console.error('List signup requests error:', err.message);
      reply(res, 500, 'Could not load signup requests');
    }
  });

  // Approve = create an invite row + send the Supabase signup email. The client then
  // sets a password through the standard /set-password flow, same as an admin-sent invite.
  router.post('/signup-requests/:id/approve', async (req, res) => {
    try {
      const sr = await db.getSignupRequest(req.params.id);
      if (!sr) return reply(res, 404, 'REQUEST_NOT_FOUND');
      if (sr.status !== 'pending') return reply(res, 409, 'ALREADY_DECIDED');

      const email = normalizeEmail(sr.email);
      if (await db.getProfileByEmail(email)) {
        await db.decideSignupRequest(sr.id, { status: 'approved', note: 'Already registered', by: req.profile.id });
        return reply(res, 409, 'ALREADY_REGISTERED');
      }

      const existingInvite = await db.findInvite(email);
      if (!existingInvite || existingInvite.status !== 'sent') {
        const invite = await db.createInvite({ email, invitedBy: req.profile.id });
        const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${config.FRONTEND_URL.replace(/\/$/, '')}/set-password`,
        });
        if (error) {
          await db.revokeInvite(invite.id);
          console.error('Signup approval invite email failed:', error.message);
          return reply(res, 502, 'INVITE_EMAIL_FAILED');
        }
      }

      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
      const decided = await db.decideSignupRequest(sr.id, { status: 'approved', note, by: req.profile.id });
      if (!decided) return reply(res, 409, 'ALREADY_DECIDED');

      await db.addAudit({ actorId: req.profile.id, action: 'signup.approved', meta: { email, requestId: sr.id } });
      res.json({ ok: true, request: publicSignup(decided) });
    } catch (err) {
      console.error('Approve signup request error:', err.message);
      reply(res, 500, 'Could not approve the request');
    }
  });

  router.post('/signup-requests/:id/reject', async (req, res) => {
    try {
      const sr = await db.getSignupRequest(req.params.id);
      if (!sr) return reply(res, 404, 'REQUEST_NOT_FOUND');
      if (sr.status !== 'pending') return reply(res, 409, 'ALREADY_DECIDED');

      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
      const decided = await db.decideSignupRequest(sr.id, { status: 'rejected', note, by: req.profile.id });
      if (!decided) return reply(res, 409, 'ALREADY_DECIDED');

      await db.addAudit({ actorId: req.profile.id, action: 'signup.rejected', meta: { email: sr.email, requestId: sr.id } });
      res.json({ ok: true, request: publicSignup(decided) });
    } catch (err) {
      console.error('Reject signup request error:', err.message);
      reply(res, 500, 'Could not reject the request');
    }
  });

  router.delete('/invites/:id', async (req, res) => {
    try {
      const invite = await db.getInvite(req.params.id);
      if (!invite) return reply(res, 404, 'INVITE_NOT_FOUND');
      if (invite.status !== 'sent') return reply(res, 409, 'INVITE_NOT_OPEN');

      await db.revokeInvite(invite.id);
      // Drop the never-used auth account so the emailed link stops working.
      const user = await findAuthUser(normalizeEmail(invite.email));
      if (user && !user.last_sign_in_at && !(await db.getProfile(user.id))) {
        await supabaseAdmin.auth.admin.deleteUser(user.id);
      }
      await db.addAudit({ actorId: req.profile.id, action: 'invite.revoked', meta: { email: invite.email } });
      res.json({ ok: true });
    } catch (err) {
      console.error('Revoke invite error:', err.message);
      reply(res, 500, 'Could not revoke the invite');
    }
  });

  return router;
}

module.exports = { adminRouter };
