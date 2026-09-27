const express = require('express');
const cookieParser = require('cookie-parser');
const { supabaseAnon, supabaseAdmin } = require('../lib/supabase');

const app = express();
app.use(express.json());
app.use(cookieParser());

const COOKIE_NAME = 'bdcap_session';
const isProd = process.env.NODE_ENV === 'production';

function setSessionCookie(res, accessToken) {
  res.cookie(COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 1000, // 1 hour — matches Supabase's default access token lifetime
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Verifies the session cookie against Supabase on every protected request.
async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Session expired' });

  req.user = data.user;
  next();
}

// POST /api/auth/signin
// Handles both cases from the doc in one step: "client enters email, sets their own
// password on that first visit; they reset it themselves." If the account doesn't
// exist yet, this creates it (auto-confirmed — no activation email sent by anyone).
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const signIn = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (!signIn.error) {
    setSessionCookie(res, signIn.data.session.access_token);
    return res.json({ user: { email: signIn.data.user.email } });
  }

  // TODO(GHL API key): before creating an account, verify this email matches an
  // existing GHL contact per doc §2 ("do not create a second contact").
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error) {
    const alreadyExists = /already.*registered/i.test(created.error.message || '');
    if (alreadyExists) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    return res.status(500).json({ error: 'Could not sign in' });
  }

  const freshSignIn = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (freshSignIn.error) {
    return res.status(500).json({ error: 'Account created, sign-in failed' });
  }

  setSessionCookie(res, freshSignIn.data.session.access_token);
  return res.json({ user: { email }, firstVisit: true });
});

app.post('/api/auth/signout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { email: req.user.email } });
});

// Placeholder for the real portal page (Phase 1 wires the actual HTML file in here).
app.get('/clients/portal', requireAuth, (req, res) => {
  res.send('Portal placeholder — signed in as ' + req.user.email);
});

// Signed-out visitors land here instead of seeing the portal.
app.get('/clients', (req, res) => {
  res.send('Sign-in page placeholder');
});

module.exports = app;
