const express = require('express');
const rateLimit = require('express-rate-limit');
const { normalizeEmail } = require('../auth/middleware');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS' },
});

const sessionOf = (s, user) => ({
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_at: s.expires_at,
  expires_in: s.expires_in,
  ...(user ? { user } : {}),
});

// The browser never talks to Supabase. Every auth step goes through these routes.
function authRouter({ config, supabaseAnon, supabaseAdmin, auth }) {
  const router = express.Router();

  const verifyRedirect = () => `${config.FRONTEND_URL.replace(/\/$/, '')}/client/login`;

  // Self-signup. Supabase emails a verification link; the account cannot sign in until it
  // is clicked. The answer is the same for new and existing addresses (no enumeration).
  router.post('/signup', limiter(10), async (req, res) => {
    const { email, password, fullName } = req.body || {};
    const clean = normalizeEmail(email);
    const name = typeof fullName === 'string' ? fullName.trim().slice(0, 120) : '';
    if (!EMAIL_RE.test(clean)) return res.status(400).json({ error: 'INVALID_EMAIL' });
    if (!name) return res.status(400).json({ error: 'NAME_REQUIRED' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    try {
      const { error } = await supabaseAnon.auth.signUp({
        email: clean,
        password,
        options: { emailRedirectTo: verifyRedirect(), data: { full_name: name } },
      });
      if (error) {
        console.error('Signup error:', error.message);
        if (error.code === 'weak_password') return res.status(400).json({ error: 'WEAK_PASSWORD' });
        if (error.status === 429 || /rate limit/i.test(error.message || '')) {
          return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
        }
        return res.status(502).json({ error: 'SIGNUP_FAILED' });
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('Signup error:', err.message);
      res.status(500).json({ error: 'SIGNUP_FAILED' });
    }
  });

  router.post('/resend-verification', limiter(10), async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    if (EMAIL_RE.test(email)) {
      try {
        await supabaseAnon.auth.resend({ type: 'signup', email, options: { emailRedirectTo: verifyRedirect() } });
      } catch (err) {
        console.error('Resend verification error:', err.message);
      }
    }
    res.json({ ok: true });
  });

  // Email + password. The email must be verified (Supabase refuses unverified sign-ins).
  router.post('/login', limiter(20), async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (error && (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || ''))) {
        return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
      }
      if (error || !data || !data.session) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      const r = await auth.authenticate({ headers: { authorization: 'Bearer ' + data.session.access_token } });
      if (r.code) return res.status(r.status).json({ error: r.code });

      res.json(sessionOf(data.session, { id: r.profile.id, email: r.email, role: r.profile.role }));
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'AUTH_FAILED' });
    }
  });

  // A refresh token is the credential; the access token is not needed.
  router.post('/refresh', limiter(120), async (req, res) => {
    const refreshToken = req.body && req.body.refresh_token;
    if (typeof refreshToken !== 'string' || !refreshToken) return res.status(400).json({ error: 'refresh_token required' });
    try {
      const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data || !data.session) return res.status(401).json({ error: 'REFRESH_FAILED' });
      res.json(sessionOf(data.session));
    } catch (err) {
      console.error('Refresh error:', err.message);
      res.status(500).json({ error: 'AUTH_FAILED' });
    }
  });

  router.post('/logout', async (req, res) => {
    const h = req.headers.authorization || '';
    if (/^Bearer /i.test(h)) {
      try {
        await supabaseAdmin.auth.admin.signOut(h.slice(7).trim());
      } catch (_) {
        /* the browser forgets the session either way */
      }
    }
    res.json({ ok: true });
  });

  // Always the same answer, so it cannot be used to find out who has an account.
  router.post('/forgot-password', limiter(10), async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    if (email) {
      try {
        await supabaseAnon.auth.resetPasswordForEmail(email, {
          redirectTo: `${config.FRONTEND_URL.replace(/\/$/, '')}/set-password`,
        });
      } catch (err) {
        console.error('Reset email error:', err.message);
      }
    }
    res.json({ ok: true });
  });

  // Used by the signup (invite) and reset links: the emailed link carries a short-lived
  // access token, which authorises choosing a password for that one account.
  router.post('/set-password', limiter(20), auth.requireAuth, async (req, res) => {
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password });
      if (error) {
        console.error('Set password error:', error.message);
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
      }
      res.json({ ok: true, email: req.userEmail });
    } catch (err) {
      console.error('Set password error:', err.message);
      res.status(500).json({ error: 'AUTH_FAILED' });
    }
  });

  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ user: { id: req.profile.id, email: req.userEmail, role: req.profile.role } });
  });

  return router;
}

module.exports = { authRouter };
