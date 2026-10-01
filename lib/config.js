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
  PORTAL_ORIGIN: '',
  SITE_ORIGIN: '',
  // Extra browser origins allowed by CORS, comma-separated (the three origins above are always allowed).
  CORS_ORIGINS: '',
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

  // Signup, verification and reset emails link to FRONTEND_URL, so a wrong value breaks every
  // email. Only local dev gets a fallback; production must say where the frontend lives.
  config.FRONTEND_URL = process.env.FRONTEND_URL || '';
  if (!config.FRONTEND_URL) {
    if (config.NODE_ENV === 'production') {
      throw new Error('Missing required env var in production: FRONTEND_URL (e.g. https://clients.example.com)');
    }
    config.FRONTEND_URL = 'http://localhost:5173';
  }
  return config;
}

module.exports = { loadConfig };
