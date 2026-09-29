#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createGhlClient } = require('../src/ghl/client');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const FOLDERS = {
  'BDCap Portal – Your Information': [
    { name: 'Legal First Name', dataType: 'TEXT' },
    { name: 'Legal Last Name', dataType: 'TEXT' },
    { name: 'Additional Contacts', dataType: 'LARGE_TEXT' },
    { name: 'Business Name', dataType: 'TEXT' },
    { name: 'Business Name Backup 1', dataType: 'TEXT' },
    { name: 'Business Name Backup 2', dataType: 'TEXT' },
    { name: 'Business Theme', dataType: 'SINGLE_OPTIONS', options: [
      'Business Strategy & Operations Consulting',
      'Athlete Career Transition Consulting',
      'Management Consulting',
      'Leadership Development Consulting',
      'NIL Consulting',
      'Real Estate Consultancy',
    ]},
    { name: 'Business Purpose', dataType: 'LARGE_TEXT' },
    { name: 'NAICS Code', dataType: 'TEXT' },
    { name: 'SIC Code', dataType: 'TEXT' },
  ],
  'BDCap Portal – Your Website': [
    { name: 'Domain Choice', dataType: 'TEXT' },
    { name: 'Site Tagline', dataType: 'TEXT' },
    { name: 'Contact Button Wording', dataType: 'TEXT' },
    { name: 'Site Config', dataType: 'LARGE_TEXT' },
    { name: 'Site Preview URL', dataType: 'TEXT' },
  ],
  'BDCap Portal – Status': [
    { name: 'Client Number', dataType: 'TEXT' },
    { name: 'Portal Completed On', dataType: 'DATE' },
    { name: 'Changes Allowed Until', dataType: 'DATE' },
    { name: 'Locked On', dataType: 'DATE' },
    { name: 'Site Deployed On', dataType: 'DATE' },
    { name: 'Site URL', dataType: 'TEXT' },
  ],
};

const EXISTING_FIELDS = [
  { name: 'Preferred Contact Method', dataType: 'SINGLE_OPTIONS', options: [
    'Email', 'Phone', 'SMS/Text', 'In Person', 'Social Media', 'Zoom',
  ]},
  { name: 'Preferred Contact Time', dataType: 'MULTIPLE_OPTIONS', options: [
    'Morning', 'Evening', 'Night',
  ]},
];

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] Would provision these fields:' : 'Provisioning GHL custom fields...');
  const fieldIdMap = {};

  let client;
  const config = {
    GHL_API_BASE_URL: process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com',
    GHL_PRIVATE_TOKEN: process.env.GHL_PRIVATE_TOKEN || '',
    GHL_LOCATION_ID: process.env.GHL_LOCATION_ID || '',
  };

  if (!config.GHL_PRIVATE_TOKEN || !config.GHL_LOCATION_ID) {
    console.log('Note: GHL_PRIVATE_TOKEN or GHL_LOCATION_ID not set. Generating placeholder field IDs.');
    client = null;
  } else {
    client = createGhlClient(config);
  }

  let existingFields = [];
  if (client) {
    try {
      const resp = await client.listCustomFields();
      existingFields = (resp.customFields || []);
    } catch (e) {
      console.log('Could not list existing fields: ' + e.message);
    }
  }

  const existingByName = {};
  for (const f of existingFields) existingByName[f.name] = f;

  for (const [folder, fields] of Object.entries(FOLDERS)) {
    console.log(`\n  Folder: ${folder}`);
    for (const field of fields) {
      if (existingByName[field.name]) {
        console.log(`    [SKIP] ${field.name} (already exists: ${existingByName[field.name].id})`);
        fieldIdMap[field.name] = existingByName[field.name].id;
        continue;
      }

      if (DRY_RUN) {
        console.log(`    [WOULD CREATE] ${field.name} (${field.dataType})${field.options ? ' options: ' + field.options.join(', ') : ''}`);
        fieldIdMap[field.name] = `placeholder_${field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        continue;
      }

      if (!client) {
        console.log(`    [PLACEHOLDER] ${field.name}`);
        fieldIdMap[field.name] = `placeholder_${field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        continue;
      }

      try {
        const body = { name: field.name, dataType: field.dataType };
        if (field.options) body.options = field.options;
        const resp = await client.createCustomField(body);
        const id = resp.customField?.id || resp.id || 'unknown';
        fieldIdMap[field.name] = id;
        console.log(`    [CREATED] ${field.name} → ${id}`);
      } catch (e) {
        console.log(`    [ERROR] ${field.name}: ${e.message}`);
        fieldIdMap[field.name] = `error_${field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      }
    }
  }

  console.log('\n  Existing fields (verify options match):');
  for (const field of EXISTING_FIELDS) {
    if (existingByName[field.name]) {
      fieldIdMap[field.name] = existingByName[field.name].id;
      console.log(`    [EXISTS] ${field.name} → ${existingByName[field.name].id}`);
    } else {
      fieldIdMap[field.name] = `placeholder_${field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      console.log(`    [NOT FOUND] ${field.name} — verify it exists with correct options: ${field.options.join(', ')}`);
    }
  }

  const outPath = path.join(__dirname, '..', 'config', 'ghl-field-ids.json');
  if (!DRY_RUN) {
    fs.writeFileSync(outPath, JSON.stringify(fieldIdMap, null, 2));
    console.log(`\nField IDs written to ${outPath}`);
  } else {
    console.log('\n[DRY RUN] Would write field IDs to ' + outPath);
    console.log(JSON.stringify(fieldIdMap, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
