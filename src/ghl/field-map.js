const fs = require('fs');
const path = require('path');

let fieldIds = {};
try {
  fieldIds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/ghl-field-ids.json'), 'utf8'));
} catch (_) {}

const FORBIDDEN_FIELDS = new Set([
  'lockedOn', 'changesUntil', 'completedOn', 'clientNumber',
  'sitePreviewUrl', 'siteDeployedOn', 'siteUrl',
  'contactFirstName', 'contactLastName',
]);

const THEMES = [
  'Business Strategy & Operations Consulting',
  'Athlete Career Transition Consulting',
  'Management Consulting',
  'Leadership Development Consulting',
  'NIL Consulting',
  'Real Estate Consultancy',
];

const CONTACT_METHODS = ['Email', 'Phone', 'SMS/Text', 'In Person', 'Social Media', 'Zoom'];
const CONTACT_TIMES = ['Morning', 'Evening', 'Night'];

const FIELD_MAP = {
  legalFirstName:   { ghlField: 'Legal First Name',        folder: 'BDCap Portal – Your Information' },
  legalLastName:    { ghlField: 'Legal Last Name',         folder: 'BDCap Portal – Your Information' },
  dateOfBirth:      { ghlField: 'date_of_birth',           folder: 'General Info', existing: true },
  personalEmail:    { ghlField: 'email',                   folder: 'Contact', existing: true },
  personalPhone:    { ghlField: 'phone',                   folder: 'Contact', existing: true },
  mailingStreet:    { ghlField: 'address1',                folder: 'General Info', existing: true },
  mailingCity:      { ghlField: 'city',                    folder: 'General Info', existing: true },
  mailingState:     { ghlField: 'state',                   folder: 'General Info', existing: true },
  mailingZip:       { ghlField: 'postalCode',              folder: 'General Info', existing: true },
  preferredContact: { ghlField: 'Preferred Contact Method', folder: 'Contact', existing: true },
  bizNameInput:     { ghlField: 'Business Name',           folder: 'BDCap Portal – Your Information' },
  backupName1:      { ghlField: 'Business Name Backup 1',  folder: 'BDCap Portal – Your Information' },
  backupName2:      { ghlField: 'Business Name Backup 2',  folder: 'BDCap Portal – Your Information' },
  themeSelect:      { ghlField: 'Business Theme',          folder: 'BDCap Portal – Your Information' },
  purposeText:      { ghlField: 'Business Purpose',        folder: 'BDCap Portal – Your Information' },
  naicsField:       { ghlField: 'NAICS Code',              folder: 'BDCap Portal – Your Information' },
  sicField:         { ghlField: 'SIC Code',                folder: 'BDCap Portal – Your Information' },
  domainInput:      { ghlField: 'Domain Choice',           folder: 'BDCap Portal – Your Website' },
  taglineInput:     { ghlField: 'Site Tagline',            folder: 'BDCap Portal – Your Website' },
  ctaSel:           { ghlField: 'Contact Button Wording',  folder: 'BDCap Portal – Your Website' },
};

const TEAM_ROW_1_MAP = {
  team_name_1:         { ghlField: 'Secondary Contact Name',            existing: true },
  team_role_1:         { ghlField: 'Secondary Contact Title/Relation',  existing: true },
  team_relationship_1: { ghlField: 'Secondary Contact Title/Relation',  existing: true, mergeWith: 'team_role_1' },
  team_phone_1:        { ghlField: 'Secondary Contact Phone',           existing: true },
  team_email_1:        { ghlField: 'Secondary Contact Email',           existing: true },
};

function stripForbiddenFields(payload) {
  const clean = { ...payload };
  if (clean.fields) {
    clean.fields = { ...clean.fields };
    for (const key of FORBIDDEN_FIELDS) {
      delete clean.fields[key];
    }
  }
  if (clean.sel) {
    clean.sel = { ...clean.sel };
    delete clean.sel.completedOn;
    delete clean.sel.lockedOn;
    delete clean.sel.changesUntil;
  }
  return clean;
}

function buildContactTimeMultiSelect(fields) {
  const times = [];
  if (fields.contactTimeMorning) times.push('Morning');
  if (fields.contactTimeEvening) times.push('Evening');
  if (fields.contactTimeNight)   times.push('Night');
  return times;
}

function extractTeamRows2to5(fields) {
  const rows = [];
  for (let i = 2; i <= 5; i++) {
    const row = {
      name:         fields[`team_name_${i}`] || '',
      role:         fields[`team_role_${i}`] || '',
      relationship: fields[`team_relationship_${i}`] || '',
      phone:        fields[`team_phone_${i}`] || '',
      email:        fields[`team_email_${i}`] || '',
    };
    if (row.name || row.role || row.relationship || row.phone || row.email) {
      rows.push(row);
    }
  }
  return rows;
}

function portalPayloadToGhl(payload) {
  const { fields = {}, sel = {} } = payload;
  const ghl = { customFields: [], contact: {} };

  for (const [portalKey, mapping] of Object.entries(FIELD_MAP)) {
    const value = fields[portalKey];
    if (value === undefined) continue;

    if (mapping.existing) {
      if (mapping.ghlField === 'email') ghl.contact.email = value;
      else if (mapping.ghlField === 'phone') ghl.contact.phone = value;
      else if (mapping.ghlField === 'address1') ghl.contact.address1 = value;
      else if (mapping.ghlField === 'city') ghl.contact.city = value;
      else if (mapping.ghlField === 'state') ghl.contact.state = value;
      else if (mapping.ghlField === 'postalCode') { ghl.contact.postalCode = value; ghl.contact.country = 'US'; }
      else if (mapping.ghlField === 'date_of_birth') ghl.contact.dateOfBirth = value;
      else if (mapping.ghlField === 'Preferred Contact Method') {
        const id = fieldIds['Preferred Contact Method'];
        if (id) ghl.customFields.push({ id, value });
      }
    } else {
      const id = fieldIds[mapping.ghlField];
      if (id) ghl.customFields.push({ id, value });
    }
  }

  const contactTimes = buildContactTimeMultiSelect(fields);
  if (contactTimes.length) {
    const id = fieldIds['Preferred Contact Time'];
    if (id) ghl.customFields.push({ id, value: contactTimes });
  }

  for (const [portalKey, mapping] of Object.entries(TEAM_ROW_1_MAP)) {
    if (mapping.mergeWith) continue;
    const value = fields[portalKey];
    if (value === undefined) continue;
    if (mapping.ghlField === 'Secondary Contact Name')           ghl.contact.secondaryContactName = value;
    else if (mapping.ghlField === 'Secondary Contact Title/Relation') {
      ghl.contact.secondaryContactTitle = fields.team_role_1 || fields.team_relationship_1 || '';
    }
    else if (mapping.ghlField === 'Secondary Contact Phone')     ghl.contact.secondaryContactPhone = value;
    else if (mapping.ghlField === 'Secondary Contact Email')     ghl.contact.secondaryContactEmail = value;
  }

  const additionalContacts = extractTeamRows2to5(fields);
  if (additionalContacts.length) {
    const id = fieldIds['Additional Contacts'];
    if (id) ghl.customFields.push({ id, value: JSON.stringify(additionalContacts) });
  }

  if (sel && Object.keys(sel).length) {
    const id = fieldIds['Site Config'];
    if (id) ghl.customFields.push({ id, value: JSON.stringify(sel) });
  }

  return ghl;
}

function ghlToPortalPrefill(contact) {
  const fields = {};
  const customFieldMap = {};

  if (contact.customFields) {
    for (const cf of contact.customFields) {
      customFieldMap[cf.id] = cf.value;
    }
  }

  const reverseFieldIds = {};
  for (const [name, id] of Object.entries(fieldIds)) {
    reverseFieldIds[id] = name;
  }

  if (contact.firstName) fields._contactFirstName = contact.firstName;
  if (contact.lastName)  fields._contactLastName = contact.lastName;

  fields.personalEmail = contact.email || '';
  fields.personalPhone = contact.phone || '';
  fields.mailingStreet  = contact.address1 || '';
  fields.mailingCity    = contact.city || '';
  fields.mailingState   = contact.state || '';
  fields.mailingZip     = contact.postalCode || '';
  fields.dateOfBirth    = contact.dateOfBirth || '';

  fields.team_name_1  = contact.secondaryContactName || '';
  fields.team_role_1  = contact.secondaryContactTitle || '';
  fields.team_phone_1 = contact.secondaryContactPhone || '';
  fields.team_email_1 = contact.secondaryContactEmail || '';

  const nameToPortalKey = {};
  for (const [portalKey, mapping] of Object.entries(FIELD_MAP)) {
    if (!mapping.existing) nameToPortalKey[mapping.ghlField] = portalKey;
  }

  for (const [cfId, cfValue] of Object.entries(customFieldMap)) {
    const fieldName = reverseFieldIds[cfId];
    if (!fieldName) continue;

    if (fieldName === 'Preferred Contact Method') {
      fields.preferredContact = cfValue;
    } else if (fieldName === 'Preferred Contact Time') {
      const times = Array.isArray(cfValue) ? cfValue : (cfValue || '').split(',').map(s => s.trim());
      fields.contactTimeMorning = times.includes('Morning');
      fields.contactTimeEvening = times.includes('Evening');
      fields.contactTimeNight   = times.includes('Night');
    } else if (fieldName === 'Additional Contacts') {
      try {
        const rows = JSON.parse(cfValue || '[]');
        rows.forEach((row, i) => {
          const idx = i + 2;
          if (idx > 5) return;
          fields[`team_name_${idx}`]         = row.name || '';
          fields[`team_role_${idx}`]         = row.role || '';
          fields[`team_relationship_${idx}`] = row.relationship || '';
          fields[`team_phone_${idx}`]        = row.phone || '';
          fields[`team_email_${idx}`]        = row.email || '';
        });
      } catch (_) {}
    } else if (fieldName === 'Site Config') {
      // handled separately as sel
    } else {
      const portalKey = nameToPortalKey[fieldName];
      if (portalKey) fields[portalKey] = cfValue;
    }
  }

  let sel = {};
  const siteConfigId = fieldIds['Site Config'];
  if (siteConfigId && customFieldMap[siteConfigId]) {
    try { sel = JSON.parse(customFieldMap[siteConfigId]); } catch (_) {}
  }

  let status = {};
  const completedOnId = fieldIds['Portal Completed On'];
  const changesUntilId = fieldIds['Changes Allowed Until'];
  const lockedOnId = fieldIds['Locked On'];
  if (completedOnId) status.completedOn = customFieldMap[completedOnId] || '';
  if (changesUntilId) status.changesUntil = customFieldMap[changesUntilId] || '';
  if (lockedOnId) status.lockedOn = customFieldMap[lockedOnId] || '';

  return { fields, sel, status };
}

module.exports = {
  FIELD_MAP,
  TEAM_ROW_1_MAP,
  THEMES,
  CONTACT_METHODS,
  CONTACT_TIMES,
  FORBIDDEN_FIELDS,
  portalPayloadToGhl,
  ghlToPortalPrefill,
  stripForbiddenFields,
  buildContactTimeMultiSelect,
  extractTeamRows2to5,
};
