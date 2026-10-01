const { ghlToPortalPrefill, portalPayloadToGhl, fieldIds, realId, FIELD_MAP } = require('../ghl/field-map');

// A save that changes nothing the server stores must not write to GHL or add a Note.
const PERSISTED_EXTRA = /^(team_(name|role|relationship|phone|email)_[1-5]|contactTime(Morning|Evening|Night))$/;
const VOLATILE_SEL = new Set(['pg', 'changeRequests', 'completedOn', 'lockedOn', 'changesUntil']);
const norm = (v) => (v === undefined || v === null || v === false ? '' : String(v));

function sameAnswers(prefill, incoming) {
  for (const [k, v] of Object.entries(incoming.fields || {})) {
    if ((k in FIELD_MAP || PERSISTED_EXTRA.test(k)) && norm(prefill.fields[k]) !== norm(v)) return false;
  }
  for (const [k, v] of Object.entries(incoming.sel || {})) {
    if (!VOLATILE_SEL.has(k) && JSON.stringify(v) !== JSON.stringify(prefill.sel[k])) return false;
  }
  return true;
}

const STATUS_FIELD = {
  completedOn: 'Portal Completed On',
  lockedOn: 'Locked On',
  changesUntil: 'Changes Allowed Until',
};

function emptyPrefill() {
  return {
    fields: {},
    sel: {},
    status: { completedOn: '', changesUntil: '', lockedOn: '' },
    site: { previewUrl: '', deployedOn: '', url: '', clientNumber: '' },
  };
}

// The Site Config copy of the change requests, built from the database (source of truth).
function mirrorOf(rows) {
  return [...rows].reverse().map(r => ({
    id: r.id,
    at: r.created_at,
    part: r.part,
    text: r.text,
    status: r.status,
    ...(r.admin_note ? { adminNote: r.admin_note } : {}),
  }));
}

function createContactService({ ghl, db }) {
  const usable = (c) => (c && !c.deleted ? c : null);

  async function find(profile) {
    if (profile.ghl_contact_id) {
      try {
        const c = usable((await ghl.getContact(profile.ghl_contact_id))?.contact);
        if (c) return c;
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }
    }
    const c = usable((await ghl.getContactByEmail(profile.email))?.contact);
    if (c && c.id !== profile.ghl_contact_id) {
      await db.setGhlContact(profile.id, c.id);
      profile.ghl_contact_id = c.id;
    }
    return c || null;
  }

  async function ensure(profile) {
    const existing = await find(profile);
    if (existing) return existing;
    let created;
    try {
      created = (await ghl.createContact({ email: profile.email }))?.contact;
    } catch (err) {
      // GHL refuses duplicates and tells us which contact already exists.
      const dupId = err.body?.meta?.contactId;
      if (!dupId) throw err;
      created = (await ghl.getContact(dupId))?.contact;
    }
    if (!created) throw new Error('Could not create GHL contact');
    await db.setGhlContact(profile.id, created.id);
    profile.ghl_contact_id = created.id;
    return created;
  }

  async function load(profile, { create = false } = {}) {
    const contact = create ? await ensure(profile) : await find(profile);
    const prefill = contact ? ghlToPortalPrefill(contact) : emptyPrefill();
    const requests = await db.listChangeRequests({ clientId: profile.id });
    prefill.sel.changeRequests = mirrorOf(requests);
    return { contact, prefill, requests };
  }

  // Merge the incoming design/answers with the authoritative status + request mirror,
  // so a save can never overwrite lock state or request statuses held on the server.
  function buildSel(existingSel, incomingSel, status, requests) {
    return {
      ...(existingSel || {}),
      ...(incomingSel || {}),
      completedOn: status.completedOn || '',
      lockedOn: status.lockedOn || '',
      changesUntil: status.changesUntil || '',
      changeRequests: mirrorOf(requests),
    };
  }

  async function writeDetails(contact, payload) {
    const mapped = portalPayloadToGhl(payload);
    await ghl.updateContact(contact.id, { ...mapped.contact, customFields: mapped.customFields });
  }

  // patch values: ISO string to set, '' to clear. Keeps Site Config in step.
  async function setStatus(contact, prefill, requests, patch) {
    const status = { ...prefill.status, ...patch };
    const customFields = [];
    for (const [key, name] of Object.entries(STATUS_FIELD)) {
      if (key in patch && realId(name)) customFields.push({ id: fieldIds[name], value: patch[key] });
    }
    const sel = buildSel(prefill.sel, {}, status, requests);
    if (realId('Site Config')) customFields.push({ id: fieldIds['Site Config'], value: JSON.stringify(sel) });
    await ghl.updateContact(contact.id, { customFields });
    return { status, sel };
  }

  async function writeSiteConfig(contact, sel) {
    if (!realId('Site Config')) return;
    await ghl.updateContact(contact.id, { customFields: [{ id: fieldIds['Site Config'], value: JSON.stringify(sel) }] });
  }

  async function note(contact, text) {
    try {
      await ghl.createNote(contact.id, text);
    } catch (err) {
      console.error('GHL note failed:', err.message);
    }
  }

  return { find, ensure, load, buildSel, writeDetails, setStatus, writeSiteConfig, note, mirrorOf, emptyPrefill, sameAnswers };
}

module.exports = { createContactService, mirrorOf, emptyPrefill, sameAnswers, STATUS_FIELD };
