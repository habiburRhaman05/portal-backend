const express = require('express');
const rateLimit = require('express-rate-limit');
const { normalizeEmail } = require('../auth/middleware');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Public "request access" endpoint. The browser POSTs here with no session;
// the request lands as a `pending` row for an admin to approve or reject.
function signupRouter({ db }) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1h
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'TOO_MANY_ATTEMPTS' },
  });

  router.post('/', limiter, async (req, res) => {
    try {
      const body = req.body || {};
      const email = normalizeEmail(body.email);
      const fullName = trim(body.fullName || body.full_name, 120);
      const company = trim(body.company, 160);
      const phone = trim(body.phone, 40);
      const message = trim(body.message, 2000);

      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL' });
      if (!fullName) return res.status(400).json({ error: 'NAME_REQUIRED' });

      // Collapse "already in the system" cases into one friendly response so this cannot
      // be used to enumerate who has an account. Still store nothing when it would be a dup.
      if (await db.getProfileByEmail(email)) return res.json({ ok: true });
      if (await db.findOpenSignupRequest(email)) return res.json({ ok: true });

      const request = await db.createSignupRequest({ email, fullName, company, phone, message });
      await db.addAudit({ actorId: null, action: 'signup.requested', meta: { email, requestId: request.id } });
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Signup request error:', err.message);
      res.status(500).json({ error: 'SIGNUP_FAILED' });
    }
  });

  return router;
}

module.exports = { signupRouter };
