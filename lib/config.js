const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
];

const optional = {
  GHL_API_BASE_URL: 'https://services.leadconnectorhq.com',
  GHL_PRIVATE_TOKEN: '',
  GHL_LOCATION_ID: '',
  GHL_INBOUND_WEBHOOK_URL: '',
  GHL_INBOUND_WEBHOOK_SECRET: '',
  GHL_CHANGE_REQUEST_WEBHOOK_URL: '',
  CSM_USER_ID: '',
  CSM_EMAIL: '',
  PORTAL_ORIGIN: 'https://clients.browndiamondcapital.com',
  SITE_ORIGIN: 'https://browndiamondcapital.com',
  FRONTEND_URL: 'http://localhost:5173',
  SESSION_SECRET: 'dev-session-secret-change-in-production-64chars-minimum-placeholder-value',
  GENERATOR_WEBHOOK_SECRET: '',
  STAGING_BASE_URL: '',
  NODE_ENV: 'development',
};

function loadConfig() {
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing required env vars: ' + missing.join(', '));
  }

  const config = {};
  for (const k of required) config[k] = process.env[k];
  for (const [k, fallback] of Object.entries(optional)) {
    config[k] = process.env[k] || fallback;
  }
  return config;
}

module.exports = { loadConfig };
