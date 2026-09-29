#!/usr/bin/env node
const { createGhlClient } = require('../src/ghl/client');
const { loadConfig } = require('../lib/config');

const contactId = process.argv[2];
const siteUrl = process.argv[3];

if (!contactId || !siteUrl) {
  console.error('Usage: node scripts/mark-deployed.js <contactId> <siteUrl>');
  process.exit(1);
}

async function main() {
  const config = loadConfig();
  const ghl = createGhlClient(config);
  const fieldIds = require('../config/ghl-field-ids.json');

  const now = new Date().toISOString();

  await ghl.updateContact(contactId, {
    customFields: [
      { id: fieldIds['Site Deployed On'], value: now },
      { id: fieldIds['Site URL'], value: siteUrl },
    ],
  });

  console.log(`Marked contact ${contactId} as deployed:`);
  console.log(`  Site Deployed On: ${now}`);
  console.log(`  Site URL: ${siteUrl}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
