const { supabaseAnon, supabaseAdmin } = require('../lib/supabase');
const { loadConfig } = require('../lib/config');
const { createGhlClient } = require('../src/ghl/client');
const { createDb } = require('../src/lib/db');
const { createContactService } = require('../src/lib/contacts');
const { createAuth } = require('../src/auth/middleware');
const { createApp } = require('../src/app');

const config = loadConfig();
const ghl = createGhlClient(config);
const db = createDb(supabaseAdmin);
const contacts = createContactService({ ghl, db });
const auth = createAuth({ supabaseAnon, db, contacts });

module.exports = createApp({ config, ghl, db, contacts, auth, supabaseAnon, supabaseAdmin });
