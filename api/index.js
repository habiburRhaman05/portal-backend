const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { supabaseAnon, supabaseAdmin } = require('../lib/supabase');
const { loadConfig } = require('../lib/config');
const { createGhlClient } = require('../src/ghl/client');
const {
  portalPayloadToGhl,
  ghlToPortalPrefill,
  stripForbiddenFields,
  FORBIDDEN_FIELDS,
} = require('../src/ghl/field-map');

const config = loadConfig();
const ghl = createGhlClient(config);
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

const allowedOrigins = [config.PORTAL_ORIGIN, config.SITE_ORIGIN].filter(Boolean);
if (config.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

console.log('[CORS] Allowed origins:', allowedOrigins);

app.use(cors({
  origin(origin, cb) {
    const isAllowed =
      !origin ||
      allowedOrigins.includes(origin) ||
      /^https:\/\/.*\.vercel\.app$/.test(origin);

    if (isAllowed) return cb(null, true);
    
    console.log('[CORS blocked]', { origin, allowedOrigins });
    return cb(new Error('CORS'));
  },
  credentials: true,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
});

// ─── Auth ───────────────────────────────────────────────────────────────[...]
// Stateless: the Supabase access token itself (a signed JWT Supabase issues
// and verifies) is held in an httpOnly cookie. There is no server-side
// session store, so this works identically on a long-running server and on
// Vercel serverless functions, which do not share memory across invocations.

const AUTH_COOKIE = 'bdcap_token';

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function setAuthCookie(res, accessToken) {
  res.cookie(AUTH_COOKIE, accessToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}

async function requireAuth(req, res, next) {
  const token = req.cookies[AUTH_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }

  req.user = data.user;
  req.userEmail = normalizeEmail(data.user.email);
  next();
}

// Same check as requireAuth, but redirects to the sign-in page instead of
// returning JSON — used for the portal HTML route, not the API.
async function requirePageAuth(req, res, next) {
  const token = req.cookies[AUTH_COOKIE];
  if (!token) return res.redirect('/clients');

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    clearAuthCookie(res);
    return res.redirect('/clients');
  }

  req.user = data.user;
  req.userEmail = normalizeEmail(data.user.email);
  next();
}

app.post('/api/auth/signin', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalized = normalizeEmail(email);

  const signIn = await supabaseAnon.auth.signInWithPassword({ email: normalized, password });
  if (!signIn.error) {
    setAuthCookie(res, signIn.data.session.access_token);
    return res.json({ user: { email: normalized } });
  }

  // First visit: create account. Same error for known/unknown to prevent enumeration.
  const created = await supabaseAdmin.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
  });

  if (created.error) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const freshSignIn = await supabaseAnon.auth.signInWithPassword({ email: normalized, password });
  if (freshSignIn.error) {
    return res.status(500).json({ error: 'Account created but sign-in failed' });
  }

  setAuthCookie(res, freshSignIn.data.session.access_token);
  return res.json({ user: { email: normalized }, firstVisit: true });
});

app.post('/api/auth/signout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { email: req.userEmail } });
});

// ─── Portal routes ───────────────────────────────────────────────────────

const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Rate limited' },
});

app.get('/api/portal/prefill', requireAuth, async (req, res) => {
  try {
    const contactResp = await ghl.getContactByEmail(req.userEmail);
    const contact = contactResp?.contact;
    if (!contact) {
      return res.json({ fields: {}, sel: {}, status: {} });
    }

    const prefill = ghlToPortalPrefill(contact);
    res.json(prefill);
  } catch (err) {
    console.error('Prefill error:', err.message);
    res.status(500).json({ error: 'Could not load your data' });
  }
});

app.post('/api/portal/save', requireAuth, portalLimiter, async (req, res) => {
  try {
    const email = req.userEmail;
    let payload = req.body;

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    payload = stripForbiddenFields(payload);

    // Check lock status
    const contactResp = await ghl.getContactByEmail(email);
    const contact = contactResp?.contact;
    if (contact) {
      const prefill = ghlToPortalPrefill(contact);
      if (prefill.status.lockedOn) {
        const changesUntil = prefill.status.changesUntil;
        if (!changesUntil || new Date(changesUntil) < new Date()) {
          return res.status(423).json({ error: 'LOCKED', message: 'Portal is locked' });
        }
      }
    }

    // Forward to GHL inbound webhook
    const webhookUrl = config.GHL_INBOUND_WEBHOOK_URL;
    if (webhookUrl) {
      const webhookPayload = {
        email,
        fields: payload.fields || {},
        sel: payload.sel || {},
      };

      try {
        const url = new URL(webhookUrl);
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const headers = { 'Content-Type': 'application/json' };
        if (config.GHL_INBOUND_WEBHOOK_SECRET) {
          headers['X-Webhook-Secret'] = config.GHL_INBOUND_WEBHOOK_SECRET;
        }

        await new Promise((resolve, reject) => {
          const req = mod.request({
            method: 'POST',
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers,
            timeout: 10000,
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
          req.write(JSON.stringify(webhookPayload));
          req.end();
        });
      } catch (webhookErr) {
        console.error('Webhook forward error:', webhookErr.message);
      }
    }

    // Also write directly to GHL as a fallback
    if (contact) {
      const ghlData = portalPayloadToGhl(payload);
      await ghl.updateContact(contact.id, {
        ...ghlData.contact,
        customFields: ghlData.customFields,
      });
      await ghl.createNote(contact.id, `Client updated their details in the portal on ${new Date().toLocaleDateString()}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: 'Could not save' });
  }
});

// ─── Submit (Phase 3) ────────────────────────────────────────────────────

app.post('/api/portal/submit', requireAuth, portalLimiter, async (req, res) => {
  try {
    const email = req.userEmail;
    let payload = req.body;

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    payload = stripForbiddenFields(payload);

    const contactResp = await ghl.getContactByEmail(email);
    const contact = contactResp?.contact;

    if (contact) {
      const prefill = ghlToPortalPrefill(contact);
      if (prefill.status.lockedOn) {
        const changesUntil = prefill.status.changesUntil;
        if (!changesUntil || new Date(changesUntil) < new Date()) {
          return res.status(423).json({ error: 'LOCKED', message: 'Portal is already locked' });
        }
      }
    }

    // Server sets timestamps
    const now = new Date().toISOString();
    const ghlData = portalPayloadToGhl(payload);

    const fieldIds = require('../config/ghl-field-ids.json');

    const submitFields = [
      ...ghlData.customFields,
      { id: fieldIds['Portal Completed On'], value: now },
      { id: fieldIds['Locked On'], value: now },
    ];

    // Store the sel with server timestamps
    if (payload.sel) {
      const sel = { ...payload.sel, completedOn: now, lockedOn: now, changesUntil: '' };
      const siteConfigId = fieldIds['Site Config'];
      const existing = submitFields.find(f => f.id === siteConfigId);
      if (existing) existing.value = JSON.stringify(sel);
      else submitFields.push({ id: siteConfigId, value: JSON.stringify(sel) });
    }

    if (contact) {
      await ghl.updateContact(contact.id, {
        ...ghlData.contact,
        customFields: submitFields,
      });
      await ghl.createNote(contact.id, `Client submitted their portal on ${new Date().toLocaleDateString()}. Portal Completed On and Locked On set to ${now}.`);
    }

    // Forward to webhook
    const webhookUrl = config.GHL_INBOUND_WEBHOOK_URL;
    if (webhookUrl) {
      const webhookPayload = {
        email,
        type: 'submit',
        fields: payload.fields || {},
        sel: { ...(payload.sel || {}), completedOn: now, lockedOn: now, changesUntil: '' },
      };
      try {
        const url = new URL(webhookUrl);
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const headers = { 'Content-Type': 'application/json' };
        if (config.GHL_INBOUND_WEBHOOK_SECRET) {
          headers['X-Webhook-Secret'] = config.GHL_INBOUND_WEBHOOK_SECRET;
        }
        await new Promise((resolve, reject) => {
          const r = mod.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers, timeout: 10000 }, (resp) => {
            let d = ''; resp.on('data', chunk => d += chunk); resp.on('end', () => resolve(d));
          });
          r.on('error', reject);
          r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
          r.write(JSON.stringify(webhookPayload));
          r.end();
        });
      } catch (_) {}
    }

    res.json({ ok: true, completedOn: now, lockedOn: now });
  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: 'Could not submit' });
  }
});

// ─── Change request (Phase 3) ────────────────────────────────────────────

app.post('/api/portal/change-request', requireAuth, portalLimiter, async (req, res) => {
  try {
    const email = req.userEmail;
    const { type, part, text, at } = req.body || {};

    if (type !== 'change_request') {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const validParts = ['website', 'team', 'you', 'business'];
    if (!validParts.includes(part)) {
      return res.status(400).json({ error: 'Invalid part' });
    }

    if (!text || typeof text !== 'string' || text.length > 2000) {
      return res.status(400).json({ error: 'Text is required (max 2000 chars)' });
    }

    const contactResp = await ghl.getContactByEmail(email);
    const contact = contactResp?.contact;
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Append to changeRequests in Site Config
    const prefill = ghlToPortalPrefill(contact);
    const sel = prefill.sel || {};
    const changeRequests = sel.changeRequests || [];
    changeRequests.push({ at: at || new Date().toISOString(), part, text, status: 'pending' });
    sel.changeRequests = changeRequests;

    const fieldIds = require('../config/ghl-field-ids.json');
    const siteConfigId = fieldIds['Site Config'];

    await ghl.updateContact(contact.id, {
      customFields: [{ id: siteConfigId, value: JSON.stringify(sel) }],
    });

    await ghl.createNote(contact.id, `Change request (${part}): ${text}`);

    // Create task for CSM
    if (config.CSM_USER_ID) {
      await ghl.createTask(contact.id, {
        title: `Change request from ${contact.firstName || email}: ${part}`,
        body: text,
        assignedTo: config.CSM_USER_ID,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Forward to change request webhook
    const webhookUrl = config.GHL_CHANGE_REQUEST_WEBHOOK_URL || config.GHL_INBOUND_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const url = new URL(webhookUrl);
        const mod = url.protocol === 'https:' ? require('https') : require('http');
        const headers = { 'Content-Type': 'application/json' };
        if (config.GHL_INBOUND_WEBHOOK_SECRET) {
          headers['X-Webhook-Secret'] = config.GHL_INBOUND_WEBHOOK_SECRET;
        }
        await new Promise((resolve, reject) => {
          const r = mod.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers, timeout: 10000 }, (resp) => {
            let d = ''; resp.on('data', chunk => d += chunk); resp.on('end', () => resolve(d));
          });
          r.on('error', reject);
          r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
          r.write(JSON.stringify({ email, type: 'change_request', part, text, at: at || new Date().toISOString() }));
          r.end();
        });
      } catch (_) {}
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Change request error:', err.message);
    res.status(500).json({ error: 'Could not process change request' });
  }
});

// ─── Generator webhook (Phase 4) ─────────────────────────────────────────

app.post('/api/generator/on-lock', async (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.headers['x-generator-secret'];
  if (!config.GENERATOR_WEBHOOK_SECRET || secret !== config.GENERATOR_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { contactId } = req.body || {};
  if (!contactId) {
    return res.status(400).json({ error: 'contactId required' });
  }

  try {
    const contactResp = await ghl.getContact(contactId);
    const contact = contactResp?.contact;
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const prefill = ghlToPortalPrefill(contact);
    if (!prefill.status.lockedOn) {
      return res.status(400).json({ error: 'Contact is not locked' });
    }

    // Queue generation job (in production this would be a job queue)
    console.log(`[Generator] Job queued for contact ${contactId}`);

    res.status(202).json({ ok: true, message: 'Generation job queued', contactId });
  } catch (err) {
    console.error('Generator webhook error:', err.message);
    res.status(500).json({ error: 'Could not process' });
  }
});

// ─── Static portal serving ──────────────────────────────────────────────

app.get('/clients/portal', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'clients', 'portal', 'index.html'));
});

app.get('/clients/portal/', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'clients', 'portal', 'index.html'));
});

async function redirectIfSignedIn(req, res, next) {
  const token = req.cookies[AUTH_COOKIE];
  if (token) {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (!error && data.user) return res.redirect('/clients/portal');
  }
  next();
}

app.get('/clients', redirectIfSignedIn, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'clients', 'index.html'));
});

app.get('/clients/', redirectIfSignedIn, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'clients', 'index.html'));
});

// Serve static files from public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

module.exports = app;
