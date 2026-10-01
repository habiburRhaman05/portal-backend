const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

const { authRouter } = require('./routes/auth');
const { portalRouter } = require('./routes/portal');
const { clientRouter } = require('./routes/client');
const { adminRouter } = require('./routes/admin');
const { generatorRouter } = require('./routes/generator');
const { signupRouter } = require('./routes/signup');

// All collaborators are injected so tests can run the real routes against fakes.
function createApp(deps) {
  const { config, auth } = deps;
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const extraOrigins = String(config.CORS_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const allowedOrigins = [config.PORTAL_ORIGIN, config.SITE_ORIGIN, config.FRONTEND_URL, ...extraOrigins]
    .filter(Boolean).map(o => o.replace(/\/$/, ''));
  if (config.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173');
  }
  app.use(cors({
    origin(origin, cb) {
      const ok = !origin || allowedOrigins.includes(origin) || /^https:\/\/.*\.vercel\.app$/.test(origin);
      if (ok) return cb(null, true);
      console.log('[CORS blocked]', origin);
      return cb(null, false);
    },
    credentials: true,
  }));

  app.use('/api/auth', authRouter(deps));
  app.use('/api/signup-request', signupRouter(deps));
  app.use('/api/portal', portalRouter(deps));
  app.use('/api/client', clientRouter(deps));
  app.use('/api/admin', adminRouter(deps));
  app.use('/api/generator', generatorRouter(deps));

  app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

  return app;
}

module.exports = { createApp };
