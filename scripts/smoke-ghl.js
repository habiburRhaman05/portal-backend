#!/usr/bin/env node
const { createGhlClient } = require('../src/ghl/client');
const { loadConfig } = require('../lib/config');

async function main() {
  console.log('Smoke test: GHL API connectivity\n');
  const config = loadConfig();
  const ghl = createGhlClient(config);

  const tests = [
    {
      name: 'List custom fields',
      fn: () => ghl.listCustomFields(),
      check: (r) => Array.isArray(r.customFields),
    },
    {
      name: 'Get custom field folders',
      fn: () => ghl.getCustomFieldFolders(),
      check: () => true,
    },
  ];

  let passed = 0;
  for (const t of tests) {
    try {
      const result = await t.fn();
      if (t.check(result)) {
        console.log(`  [OK]   ${t.name}`);
        passed++;
      } else {
        console.log(`  [FAIL] ${t.name}: unexpected response`);
      }
    } catch (e) {
      console.log(`  [FAIL] ${t.name}: ${e.message}`);
    }
  }

  console.log(`\n${passed}/${tests.length} passed`);
  if (passed < tests.length) process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
