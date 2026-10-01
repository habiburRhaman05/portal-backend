const normalizeEmail = (email) => (email || '').trim().toLowerCase();

// Identity always comes from a Supabase-verified token sent as `Authorization: Bearer`,
// never from the body or URL. A valid token alone is not enough: the user must already
// have a profile, an invite from an admin, or a verified email (self-signup). An
// unverified self-signup never gets a profile.
function createAuth({ supabaseAnon, db, contacts }) {
  const tokenFrom = (req) => {
    const h = req.headers.authorization || '';
    return /^Bearer /i.test(h) ? h.slice(7).trim() : null;
  };

  async function ensureProfile(user) {
    const email = normalizeEmail(user.email);
    let profile = await db.getProfile(user.id);
    if (profile) return profile;

    const invite = await db.findInvite(email);
    if (!invite && !user.email_confirmed_at) return null;

    profile = await db.upsertProfile({ id: user.id, email, role: 'client' });
    if (invite) await db.markInviteAccepted(email);
    await db.addAudit({ actorId: user.id, action: 'client.signup', clientId: user.id, meta: { email, via: invite ? 'invite' : 'self' } });
    try {
      await contacts.ensure(profile);
    } catch (err) {
      console.error('GHL contact link failed at signup:', err.message);
    }
    return profile;
  }

  async function authenticate(req) {
    const token = tokenFrom(req);
    if (!token) return { status: 401, code: 'NOT_SIGNED_IN' };

    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (error || !data || !data.user) return { status: 401, code: 'SESSION_EXPIRED' };

    const profile = await ensureProfile(data.user);
    if (!profile) return { status: 403, code: 'EMAIL_NOT_VERIFIED' };
    return { user: data.user, profile, email: normalizeEmail(data.user.email), token };
  }

  async function requireAuth(req, res, next) {
    try {
      const r = await authenticate(req);
      if (r.code) return res.status(r.status).json({ error: r.code });
      req.user = r.user;
      req.profile = r.profile;
      req.userEmail = r.email;
      req.token = r.token;
      next();
    } catch (err) {
      console.error('Auth error:', err.message);
      res.status(500).json({ error: 'AUTH_FAILED' });
    }
  }

  async function requireAdmin(req, res, next) {
    return requireAuth(req, res, () => {
      if (req.profile.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN' });
      next();
    });
  }

  return { requireAuth, requireAdmin, authenticate };
}

module.exports = { createAuth, normalizeEmail };
