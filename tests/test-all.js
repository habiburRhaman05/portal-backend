const assert = require('assert');
const { createMockGhlServer } = require('./mock-ghl-server');
const {
  portalPayloadToGhl,
  ghlToPortalPrefill,
  stripForbiddenFields,
  buildContactTimeMultiSelect,
  extractTeamRows2to5,
  FORBIDDEN_FIELDS,
  THEMES,
  CONTACT_METHODS,
  CONTACT_TIMES,
} = require('../src/ghl/field-map');

// Read whatever field IDs are currently provisioned (placeholders or real
// GHL ids) so these tests stay correct after provision-fields.js runs.
const fieldIds = require('../config/ghl-field-ids.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== Field Map Tests ===\n');

test('THEMES has 6 entries', () => {
  assert.strictEqual(THEMES.length, 6);
  assert.ok(THEMES.includes('Business Strategy & Operations Consulting'));
  assert.ok(THEMES.includes('Athlete Career Transition Consulting'));
  assert.ok(THEMES.includes('Management Consulting'));
  assert.ok(THEMES.includes('Leadership Development Consulting'));
  assert.ok(THEMES.includes('NIL Consulting'));
  assert.ok(THEMES.includes('Real Estate Consultancy'));
});

test('CONTACT_METHODS matches spec', () => {
  assert.deepStrictEqual(CONTACT_METHODS, ['Email', 'Phone', 'SMS/Text', 'In Person', 'Social Media', 'Zoom']);
});

test('CONTACT_TIMES matches spec', () => {
  assert.deepStrictEqual(CONTACT_TIMES, ['Morning', 'Evening', 'Night']);
});

test('stripForbiddenFields removes all forbidden keys', () => {
  const payload = {
    fields: { bizNameInput: 'Test Corp', lockedOn: '2024-01-01', changesUntil: '2024-02-01', clientNumber: 'BE0001', sitePreviewUrl: 'x', siteDeployedOn: 'y', siteUrl: 'z', contactFirstName: 'a', contactLastName: 'b' },
    sel: { tpl: 'editorial', completedOn: '2024-01-01', lockedOn: '2024-01-01', changesUntil: '' },
  };
  const clean = stripForbiddenFields(payload);
  assert.strictEqual(clean.fields.bizNameInput, 'Test Corp');
  assert.strictEqual(clean.fields.lockedOn, undefined);
  assert.strictEqual(clean.fields.changesUntil, undefined);
  assert.strictEqual(clean.fields.clientNumber, undefined);
  assert.strictEqual(clean.fields.sitePreviewUrl, undefined);
  assert.strictEqual(clean.fields.contactFirstName, undefined);
  assert.strictEqual(clean.sel.completedOn, undefined);
  assert.strictEqual(clean.sel.lockedOn, undefined);
  assert.strictEqual(clean.sel.tpl, 'editorial');
});

test('buildContactTimeMultiSelect works', () => {
  assert.deepStrictEqual(buildContactTimeMultiSelect({ contactTimeMorning: true, contactTimeNight: true }), ['Morning', 'Night']);
  assert.deepStrictEqual(buildContactTimeMultiSelect({}), []);
  assert.deepStrictEqual(buildContactTimeMultiSelect({ contactTimeEvening: true }), ['Evening']);
});

test('extractTeamRows2to5 extracts rows', () => {
  const fields = {
    team_name_2: 'Alice', team_role_2: 'CFO', team_phone_2: '555-1234', team_email_2: 'alice@test.com',
    team_name_3: 'Bob', team_role_3: 'CTO',
  };
  const rows = extractTeamRows2to5(fields);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Alice');
  assert.strictEqual(rows[1].name, 'Bob');
});

test('portalPayloadToGhl maps basic fields', () => {
  const payload = {
    fields: {
      bizNameInput: 'Test Corp',
      legalFirstName: 'John',
      personalEmail: 'john@test.com',
      personalPhone: '555-0000',
      mailingStreet: '123 Main',
      mailingCity: 'Springfield',
      mailingState: 'IL',
      mailingZip: '62704',
      preferredContact: 'Email',
      contactTimeMorning: true,
      contactTimeEvening: true,
    },
    sel: { tpl: 'editorial', fnt: 'Classic' },
  };
  const ghl = portalPayloadToGhl(payload);
  assert.strictEqual(ghl.contact.email, 'john@test.com');
  assert.strictEqual(ghl.contact.phone, '555-0000');
  assert.strictEqual(ghl.contact.address1, '123 Main');
  assert.strictEqual(ghl.contact.city, 'Springfield');
  assert.strictEqual(ghl.contact.country, 'US');
  assert.ok(ghl.customFields.length > 0);
});

test('portalPayloadToGhl maps team row 1 to secondary contact', () => {
  const payload = {
    fields: {
      team_name_1: 'Jane', team_role_1: 'CFO', team_phone_1: '555-1111', team_email_1: 'jane@test.com',
    },
    sel: {},
  };
  const ghl = portalPayloadToGhl(payload);
  const cf = (name) => ghl.customFields.find(f => f.id === fieldIds[name])?.value;
  assert.strictEqual(cf('Secondary Contact Name'), 'Jane');
  assert.strictEqual(cf('Secondary Contact Title/Relation'), 'CFO');
  assert.strictEqual(cf('Secondary Contact Phone'), '555-1111');
  assert.strictEqual(cf('Secondary Contact Email'), 'jane@test.com');
  // GHL rejects unknown top-level contact props with a 422
  assert.strictEqual(ghl.contact.secondaryContactName, undefined);
});

test('portalPayloadToGhl never sends unprovisioned (placeholder) field ids', () => {
  const ghl = portalPayloadToGhl({ fields: { bizNameInput: 'X', preferredContact: 'Email' }, sel: { tpl: 'split' } });
  for (const f of ghl.customFields) {
    assert.ok(!String(f.id).startsWith('placeholder_'), 'placeholder id leaked: ' + f.id);
  }
});

test('contact time is overwritten even when every slot is unticked', () => {
  const ghl = portalPayloadToGhl({ fields: { contactTimeMorning: false, contactTimeEvening: false, contactTimeNight: false }, sel: {} });
  const f = ghl.customFields.find(x => x.id === fieldIds['Preferred Contact Time']);
  assert.ok(f, 'Preferred Contact Time should be written');
  assert.deepStrictEqual(f.value, []);
});

test('prefill reads the exact instant from Site Config when GHL only has the date', () => {
  const contact = { customFields: [
    { id: fieldIds['Locked On'], value: '2026-10-01' },
    { id: fieldIds['Site Config'], value: JSON.stringify({ tpl: 'split', lockedOn: '2026-10-01T03:50:23.928Z' }) },
  ] };
  const p = ghlToPortalPrefill(contact);
  assert.strictEqual(p.status.lockedOn, '2026-10-01T03:50:23.928Z');
  assert.strictEqual(p.sel.lockedOn, p.status.lockedOn);
});

test('prefill: cleared GHL status wins over a stale Site Config copy', () => {
  const contact = { customFields: [
    { id: fieldIds['Site Config'], value: JSON.stringify({ lockedOn: '2026-10-01T03:50:23.928Z' }) },
  ] };
  const p = ghlToPortalPrefill(contact);
  assert.strictEqual(p.status.lockedOn, '');
  assert.strictEqual(p.sel.lockedOn, '');
});

test('portalPayloadToGhl maps team rows 2-5 as JSON', () => {
  const payload = {
    fields: { team_name_2: 'Alice', team_role_2: 'VP', team_name_3: 'Bob' },
    sel: {},
  };
  const ghl = portalPayloadToGhl(payload);
  const additionalCf = ghl.customFields.find(f => f.id === fieldIds['Additional Contacts']);
  assert.ok(additionalCf);
  const parsed = JSON.parse(additionalCf.value);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].name, 'Alice');
});

test('round-trip: payload → GHL → prefill', () => {
  const originalPayload = {
    fields: {
      legalFirstName: 'John',
      legalLastName: 'Doe',
      bizNameInput: 'Test Corp',
      backupName1: 'TestCo',
      themeSelect: 'NIL Consulting',
      purposeText: 'Help athletes',
      personalEmail: 'john@test.com',
      personalPhone: '555-0000',
      mailingStreet: '123 Main',
      mailingCity: 'Springfield',
      mailingState: 'IL',
      mailingZip: '62704',
      team_name_1: 'Jane',
      team_role_1: 'CFO',
      team_phone_1: '555-1111',
      team_email_1: 'jane@test.com',
      team_name_2: 'Alice',
      team_role_2: 'VP',
      contactTimeMorning: true,
      contactTimeNight: true,
    },
    sel: { tpl: 'sidebar', fnt: 'Contemporary', pal: 'Oxblood', thm: 'NIL Consulting', variant: 2 },
  };

  const ghlData = portalPayloadToGhl(originalPayload);

  // Simulate what GHL would store
  const mockContact = {
    email: 'john@test.com',
    phone: '555-0000',
    address1: '123 Main',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704',
    dateOfBirth: '',
    secondaryContactName: 'Jane',
    secondaryContactTitle: 'CFO',
    secondaryContactPhone: '555-1111',
    secondaryContactEmail: 'jane@test.com',
    customFields: ghlData.customFields,
  };

  const prefill = ghlToPortalPrefill(mockContact);

  assert.strictEqual(prefill.fields.personalEmail, 'john@test.com');
  assert.strictEqual(prefill.fields.personalPhone, '555-0000');
  assert.strictEqual(prefill.fields.mailingStreet, '123 Main');
  assert.strictEqual(prefill.fields.team_name_1, 'Jane');
  assert.strictEqual(prefill.fields.team_role_1, 'CFO');

  const legalFirstCf = ghlData.customFields.find(f => f.id === fieldIds['Legal First Name']);
  assert.ok(legalFirstCf);
  assert.strictEqual(legalFirstCf.value, 'John');

  assert.ok(prefill.sel);
  assert.strictEqual(prefill.sel.tpl, 'sidebar');
});

console.log('\n=== Mock GHL Server Tests ===\n');

test('mock server: addContact + getContact', () => {
  const mock = createMockGhlServer();
  const c = mock.addContact({ email: 'test@test.com', firstName: 'Test' });
  assert.ok(c.id);
  const all = mock.getContacts();
  assert.ok(all[c.id]);
  assert.strictEqual(all[c.id].email, 'test@test.com');
});

test('mock server: reset clears data', () => {
  const mock = createMockGhlServer();
  mock.addContact({ email: 'test@test.com' });
  mock.reset();
  assert.strictEqual(Object.keys(mock.getContacts()).length, 0);
});

console.log('\n=== Security Tests ===\n');

test('forbidden fields list is complete', () => {
  assert.ok(FORBIDDEN_FIELDS.has('lockedOn'));
  assert.ok(FORBIDDEN_FIELDS.has('changesUntil'));
  assert.ok(FORBIDDEN_FIELDS.has('completedOn'));
  assert.ok(FORBIDDEN_FIELDS.has('clientNumber'));
  assert.ok(FORBIDDEN_FIELDS.has('sitePreviewUrl'));
  assert.ok(FORBIDDEN_FIELDS.has('siteDeployedOn'));
  assert.ok(FORBIDDEN_FIELDS.has('siteUrl'));
  assert.ok(FORBIDDEN_FIELDS.has('contactFirstName'));
  assert.ok(FORBIDDEN_FIELDS.has('contactLastName'));
});

test('portalPayloadToGhl never writes Contact First/Last Name', () => {
  const payload = {
    fields: { contactFirstName: 'Evil', contactLastName: 'Hacker' },
    sel: {},
  };
  // The field map doesnt have entries for contactFirstName/contactLastName
  const ghl = portalPayloadToGhl(payload);
  assert.strictEqual(ghl.contact.firstName, undefined);
  assert.strictEqual(ghl.contact.lastName, undefined);
});

test('client cannot set lockedOn via save payload', () => {
  const payload = {
    fields: { lockedOn: '2024-01-01' },
    sel: { lockedOn: '2024-01-01' },
  };
  const clean = stripForbiddenFields(payload);
  assert.strictEqual(clean.fields.lockedOn, undefined);
  assert.strictEqual(clean.sel.lockedOn, undefined);
});

test('client cannot set changesUntil via save payload', () => {
  const payload = {
    fields: { changesUntil: '2030-01-01' },
    sel: { changesUntil: '2030-01-01' },
  };
  const clean = stripForbiddenFields(payload);
  assert.strictEqual(clean.fields.changesUntil, undefined);
  assert.strictEqual(clean.sel.changesUntil, undefined);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed) process.exit(1);
