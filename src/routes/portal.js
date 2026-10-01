const express = require('express');
const rateLimit = require('express-rate-limit');
const { portalPayloadToGhl, stripForbiddenFields, fieldIds, realId } = require('../ghl/field-map');
const { isLocked } = require('../lib/dates');
const { postWebhook } = require('../lib/webhook');

const PARTS = ['website', 'team', 'you', 'business'];
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function portalRouter({ config, ghl, db, contacts, auth }) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'RATE_LIMITED' } });
  const today = () => new Date().toLocaleDateString();

  // Identity is the session's profile only; nothing in the body or URL picks the contact.
  router.get('/prefill', auth.requireAuth, async (req, res) => {
    try {
      const { prefill } = await contacts.load(req.profile);
      res.json(prefill);
    } catch (err) {
      console.error('Prefill error:', err.message);
      res.status(500).json({ error: 'Could not load your data' });
    }
  });

  function validPayload(body) {
    return isObject(body) && (body.fields === undefined || isObject(body.fields)) && (body.sel === undefined || isObject(body.sel));
  }

  router.post('/save', auth.requireAuth, limiter, async (req, res) => {
    try {
      if (!validPayload(req.body)) return res.status(400).json({ error: 'Invalid payload' });

      const { contact, prefill, requests } = await contacts.load(req.profile, { create: true });
      if (isLocked(prefill.status)) return res.status(423).json({ error: 'LOCKED', message: 'Portal is locked' });

      const clean = stripForbiddenFields(req.body);
      if (contacts.sameAnswers(prefill, clean)) return res.json({ ok: true, unchanged: true });
      clean.sel = contacts.buildSel(prefill.sel, clean.sel, prefill.status, requests);

      await contacts.writeDetails(contact, clean);
      await contacts.note(contact, `Client updated their details in the portal on ${today()}.`);
      await postWebhook(config.GHL_INBOUND_WEBHOOK_URL,
        { email: req.userEmail, fields: clean.fields || {}, sel: clean.sel }, config.GHL_INBOUND_WEBHOOK_SECRET);

      res.json({ ok: true });
    } catch (err) {
      console.error('Save error:', err.message);
      res.status(500).json({ error: 'Could not save' });
    }
  });

  router.post('/submit', auth.requireAuth, limiter, async (req, res) => {
    try {
      if (!validPayload(req.body)) return res.status(400).json({ error: 'Invalid payload' });

      const { contact, prefill, requests } = await contacts.load(req.profile, { create: true });
      if (isLocked(prefill.status)) return res.status(423).json({ error: 'LOCKED', message: 'Portal is already locked' });

      // The server sets the timestamps; whatever the client sent is discarded.
      const now = new Date().toISOString();
      const status = { completedOn: now, lockedOn: now, changesUntil: '' };
      const clean = stripForbiddenFields(req.body);
      clean.sel = contacts.buildSel(prefill.sel, clean.sel, status, requests);

      const mapped = portalPayloadToGhl(clean);
      const statusFields = [
        ['Portal Completed On', now],
        ['Locked On', now],
        ['Changes Allowed Until', ''],
      ].filter(([name]) => realId(name)).map(([name, value]) => ({ id: fieldIds[name], value }));

      await ghl.updateContact(contact.id, {
        ...mapped.contact,
        customFields: [...mapped.customFields, ...statusFields],
      });
      await contacts.note(contact, `Client submitted their portal on ${today()}. Portal Completed On and Locked On set to ${now}.`);
      await postWebhook(config.GHL_INBOUND_WEBHOOK_URL,
        { email: req.userEmail, type: 'submit', fields: clean.fields || {}, sel: clean.sel }, config.GHL_INBOUND_WEBHOOK_SECRET);
      await db.addAudit({ actorId: req.profile.id, action: 'portal.submit', clientId: req.profile.id });

      res.json({ ok: true, completedOn: now, lockedOn: now });
    } catch (err) {
      console.error('Submit error:', err.message);
      res.status(500).json({ error: 'Could not submit' });
    }
  });

  router.post('/change-request', auth.requireAuth, limiter, async (req, res) => {
    try {
      const { type, part, text } = req.body || {};
      if (type !== 'change_request') return res.status(400).json({ error: 'Invalid type' });
      if (!PARTS.includes(part)) return res.status(400).json({ error: 'Invalid part' });
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
        return res.status(400).json({ error: 'Text is required (max 2000 chars)' });
      }

      const { contact, prefill, requests } = await contacts.load(req.profile, { create: true });
      const row = await db.createChangeRequest({
        clientId: req.profile.id, ghlContactId: contact.id, part, text: text.trim(),
      });
      const all = [row, ...requests];

      // The request never changes a field or the lock; it only extends the Site Config list.
      await contacts.writeSiteConfig(contact, contacts.buildSel(prefill.sel, {}, prefill.status, all));
      await contacts.note(contact, `Change request (${part}): ${row.text}`);

      if (config.CSM_USER_ID) {
        try {
          await ghl.createTask(contact.id, {
            title: `Change request from ${contact.firstName || req.userEmail}: ${part}`,
            body: row.text,
            assignedTo: config.CSM_USER_ID,
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        } catch (err) {
          console.error('CSM task failed:', err.message);
        }
      }

      await postWebhook(config.GHL_CHANGE_REQUEST_WEBHOOK_URL || config.GHL_INBOUND_WEBHOOK_URL, {
        email: req.userEmail, type: 'change_request', requestId: row.id, part, text: row.text,
        at: row.created_at, status: 'pending',
      }, config.GHL_INBOUND_WEBHOOK_SECRET);
      await db.addAudit({ actorId: req.profile.id, action: 'request.created', clientId: req.profile.id, meta: { requestId: row.id, part } });

      res.json({ ok: true, request: { id: row.id, part, text: row.text, status: row.status, at: row.created_at } });
    } catch (err) {
      console.error('Change request error:', err.message);
      res.status(500).json({ error: 'Could not process change request' });
    }
  });

  return router;
}

module.exports = { portalRouter };
