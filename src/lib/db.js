// Thin data layer over Supabase Postgres (service-role client). Routes depend on
// this interface only, so tests can swap in an in-memory implementation.
function createDb(sb) {
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    // ── profiles ──────────────────────────────────────────────
    async getProfile(id) {
      return must(await sb.from('profiles').select('*').eq('id', id).maybeSingle());
    },
    async getProfileByEmail(email) {
      return must(await sb.from('profiles').select('*').ilike('email', email).maybeSingle());
    },
    async upsertProfile(p) {
      return must(await sb.from('profiles').upsert(p, { onConflict: 'id' }).select().single());
    },
    async setGhlContact(id, ghlContactId) {
      must(await sb.from('profiles').update({ ghl_contact_id: ghlContactId }).eq('id', id).select());
    },
    async listProfiles(role = 'client') {
      return must(await sb.from('profiles').select('*').eq('role', role).order('created_at', { ascending: false }));
    },

    // ── invites ───────────────────────────────────────────────
    async findInvite(email) {
      return must(await sb.from('invites').select('*').ilike('email', email)
        .in('status', ['sent', 'accepted']).order('created_at', { ascending: false }).limit(1).maybeSingle());
    },
    async createInvite({ email, invitedBy }) {
      return must(await sb.from('invites').insert({ email, invited_by: invitedBy }).select().single());
    },
    async listInvites() {
      return must(await sb.from('invites').select('*').order('created_at', { ascending: false }).limit(200));
    },
    async getInvite(id) {
      return must(await sb.from('invites').select('*').eq('id', id).maybeSingle());
    },
    async markInviteAccepted(email) {
      must(await sb.from('invites').update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .ilike('email', email).eq('status', 'sent').select());
    },
    async revokeInvite(id) {
      return must(await sb.from('invites').update({ status: 'revoked' }).eq('id', id).eq('status', 'sent').select().maybeSingle());
    },

    // ── change requests ───────────────────────────────────────
    async createChangeRequest({ clientId, ghlContactId, part, text }) {
      return must(await sb.from('change_requests')
        .insert({ client_id: clientId, ghl_contact_id: ghlContactId, part, text }).select().single());
    },
    async listChangeRequests({ clientId, status, limit = 200 } = {}) {
      let q = sb.from('change_requests').select('*').order('created_at', { ascending: false }).limit(limit);
      if (clientId) q = q.eq('client_id', clientId);
      if (status) q = q.eq('status', status);
      return must(await q);
    },
    async getChangeRequest(id) {
      return must(await sb.from('change_requests').select('*').eq('id', id).maybeSingle());
    },
    // Only a pending request can be decided; null means it was already decided.
    async decideChangeRequest(id, { status, note, by }) {
      return must(await sb.from('change_requests')
        .update({ status, admin_note: note || null, decided_by: by, decided_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'pending').select().maybeSingle());
    },
    async pendingCountsByClient() {
      const rows = must(await sb.from('change_requests').select('client_id').eq('status', 'pending'));
      const counts = {};
      for (const r of rows) counts[r.client_id] = (counts[r.client_id] || 0) + 1;
      return counts;
    },

    // ── signup requests (public "request access") ─────────────
    async createSignupRequest({ email, fullName, company, phone, message }) {
      return must(await sb.from('signup_requests')
        .insert({ email, full_name: fullName || null, company: company || null, phone: phone || null, message: message || null })
        .select().single());
    },
    async findOpenSignupRequest(email) {
      return must(await sb.from('signup_requests').select('*').ilike('email', email).eq('status', 'pending').maybeSingle());
    },
    async listSignupRequests({ status, limit = 200 } = {}) {
      let q = sb.from('signup_requests').select('*').order('created_at', { ascending: false }).limit(limit);
      if (status) q = q.eq('status', status);
      return must(await q);
    },
    async getSignupRequest(id) {
      return must(await sb.from('signup_requests').select('*').eq('id', id).maybeSingle());
    },
    async decideSignupRequest(id, { status, note, by }) {
      return must(await sb.from('signup_requests')
        .update({ status, admin_note: note || null, decided_by: by, decided_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'pending').select().maybeSingle());
    },

    // ── audit ─────────────────────────────────────────────────
    async addAudit({ actorId, action, clientId = null, meta = {} }) {
      try {
        must(await sb.from('audit_log').insert({ actor_id: actorId, action, client_id: clientId, meta }));
      } catch (err) {
        console.error('Audit write failed:', err.message);
      }
    },
    async listAudit({ clientId, limit = 100 }) {
      return must(await sb.from('audit_log').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(limit));
    },
  };
}

module.exports = { createDb };
