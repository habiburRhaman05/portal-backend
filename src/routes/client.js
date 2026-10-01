const express = require('express');
const { summarize, design } = require('../lib/summary');

// Read-only views for the client dashboard. All data is the signed-in client's own.
function clientRouter({ contacts, auth }) {
  const router = express.Router();

  router.get('/overview', auth.requireAuth, async (req, res) => {
    try {
      const { prefill, requests } = await contacts.load(req.profile, { create: true });
      const pending = requests.filter(r => r.status === 'pending').length;
      res.json({
        profile: { id: req.profile.id, email: req.userEmail, role: req.profile.role, createdAt: req.profile.created_at },
        summary: summarize(req.profile, prefill, pending),
        design: design(prefill.sel),
      });
    } catch (err) {
      console.error('Overview error:', err.message);
      res.status(500).json({ error: 'Could not load your account' });
    }
  });

  router.get('/details', auth.requireAuth, async (req, res) => {
    try {
      const { prefill } = await contacts.load(req.profile);
      res.json({ fields: prefill.fields, sel: prefill.sel, status: prefill.status, site: prefill.site, design: design(prefill.sel) });
    } catch (err) {
      console.error('Details error:', err.message);
      res.status(500).json({ error: 'Could not load your details' });
    }
  });

  router.get('/change-requests', auth.requireAuth, async (req, res) => {
    try {
      const { requests } = await contacts.load(req.profile);
      res.json({
        requests: requests.map(r => ({
          id: r.id, part: r.part, text: r.text, status: r.status,
          adminNote: r.admin_note || '', createdAt: r.created_at, decidedAt: r.decided_at || null,
        })),
      });
    } catch (err) {
      console.error('Requests error:', err.message);
      res.status(500).json({ error: 'Could not load your requests' });
    }
  });

  return router;
}

module.exports = { clientRouter };
