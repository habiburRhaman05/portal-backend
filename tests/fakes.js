// In-memory stand-ins for GHL and the Supabase database. They mimic the real behaviour that
// matters (GHL 422s on unknown top-level props, DATE fields keep only the day).
const { fieldIds } = require('../src/ghl/field-map');

const DATE_FIELDS = new Set(['Portal Completed On', 'Changes Allowed Until', 'Locked On', 'Site Deployed On'].map(n => fieldIds[n]));
const GHL_TOP_LEVEL = new Set(['email', 'phone', 'address1', 'city', 'state', 'postalCode', 'country', 'dateOfBirth', 'firstName', 'lastName', 'customFields']);

function fakeGhl() {
  const contacts = {};
  const notes = [];
  const tasks = [];
  let n = 0;
  const err = (statusCode, message) => Object.assign(new Error(message), { statusCode, body: { message } });
  return {
    contacts, notes, tasks,
    async getContact(id) { if (!contacts[id]) throw err(404, 'not found'); return { contact: contacts[id] }; },
    async getContactByEmail(email) {
      return { contact: Object.values(contacts).find(c => c.email === email.toLowerCase()) || null };
    },
    async createContact(data) {
      const id = 'c' + (++n);
      contacts[id] = { id, email: (data.email || '').toLowerCase(), customFields: [], ...data, deleted: false };
      contacts[id].email = (data.email || '').toLowerCase();
      return { contact: contacts[id] };
    },
    async updateContact(id, data) {
      const c = contacts[id];
      if (!c) throw err(404, 'not found');
      for (const k of Object.keys(data)) if (!GHL_TOP_LEVEL.has(k)) throw err(422, `property ${k} should not exist`);
      for (const [k, v] of Object.entries(data)) if (k !== 'customFields') c[k] = v;
      for (const cf of data.customFields || []) {
        let value = cf.value;
        if (DATE_FIELDS.has(cf.id) && typeof value === 'string') value = value.slice(0, 10); // real GHL keeps only the day
        c.customFields = c.customFields.filter(x => x.id !== cf.id);
        if (value !== '' && value !== undefined) c.customFields.push({ id: cf.id, value });
      }
      return { contact: c };
    },
    async createNote(id, body) { notes.push({ id, body }); return {}; },
    async createTask(id, task) { tasks.push({ id, ...task }); return {}; },
  };
}

function fakeDb() {
  const profiles = {}, invites = [], requests = [], signupRequests = [], audit = [];
  let seq = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, ++seq)).toISOString();
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return {
    profiles, invites, requests, signupRequests, audit,
    async getProfile(id) { return profiles[id] || null; },
    async getProfileByEmail(email) { return Object.values(profiles).find(p => eq(p.email, email)) || null; },
    async upsertProfile(p) { profiles[p.id] = { ghl_contact_id: null, created_at: stamp(), ...profiles[p.id], ...p }; return profiles[p.id]; },
    async setGhlContact(id, cid) { profiles[id].ghl_contact_id = cid; },
    async listProfiles(role = 'client') { return Object.values(profiles).filter(p => p.role === role); },
    async findInvite(email) { return [...invites].reverse().find(i => eq(i.email, email) && ['sent', 'accepted'].includes(i.status)) || null; },
    async createInvite({ email, invitedBy }) { const i = { id: 'i' + (++seq), email, invited_by: invitedBy, status: 'sent', created_at: stamp() }; invites.push(i); return i; },
    async listInvites() { return [...invites].reverse(); },
    async getInvite(id) { return invites.find(i => i.id === id) || null; },
    async markInviteAccepted(email) { invites.filter(i => eq(i.email, email) && i.status === 'sent').forEach(i => { i.status = 'accepted'; }); },
    async revokeInvite(id) { const i = invites.find(x => x.id === id && x.status === 'sent'); if (i) i.status = 'revoked'; return i || null; },
    async createChangeRequest({ clientId, ghlContactId, part, text }) {
      const r = { id: 'r' + (++seq), client_id: clientId, ghl_contact_id: ghlContactId, part, text, status: 'pending', admin_note: null, created_at: stamp(), decided_at: null };
      requests.push(r); return r;
    },
    async listChangeRequests({ clientId, status } = {}) {
      return requests.filter(r => (!clientId || r.client_id === clientId) && (!status || r.status === status)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getChangeRequest(id) { return requests.find(r => r.id === id) || null; },
    async decideChangeRequest(id, { status, note, by }) {
      const r = requests.find(x => x.id === id && x.status === 'pending');
      if (!r) return null;
      Object.assign(r, { status, admin_note: note || null, decided_by: by, decided_at: stamp() });
      return r;
    },
    async pendingCountsByClient() { const c = {}; requests.filter(r => r.status === 'pending').forEach(r => { c[r.client_id] = (c[r.client_id] || 0) + 1; }); return c; },
    async createSignupRequest({ email, fullName, company, phone, message }) {
      const r = { id: 's' + (++seq), email, full_name: fullName || null, company: company || null, phone: phone || null, message: message || null, status: 'pending', admin_note: null, decided_by: null, decided_at: null, created_at: stamp() };
      signupRequests.push(r); return r;
    },
    async findOpenSignupRequest(email) { return signupRequests.find(r => eq(r.email, email) && r.status === 'pending') || null; },
    async listSignupRequests({ status } = {}) {
      return [...signupRequests].filter(r => !status || r.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getSignupRequest(id) { return signupRequests.find(r => r.id === id) || null; },
    async decideSignupRequest(id, { status, note, by }) {
      const r = signupRequests.find(x => x.id === id && x.status === 'pending');
      if (!r) return null;
      Object.assign(r, { status, admin_note: note || null, decided_by: by, decided_at: stamp() });
      return r;
    },
    async addAudit(a) { audit.push(a); },
    async listAudit({ clientId }) { return audit.filter(a => a.clientId === clientId); },
  };
}


module.exports = { fakeGhl, fakeDb };
