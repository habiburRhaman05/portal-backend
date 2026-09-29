# Operations Runbook

## Starting the backend

### Development
```bash
cd portal-backend
npm install
node scripts/prepare-portal.js   # generates public/clients/portal/index.html
npm run dev                       # starts on localhost:3000
```

### Production (Vercel)
The backend deploys automatically via Vercel. All routes are handled by `api/index.js` via the `vercel.json` rewrite.

## Environment variables
See `.env.example` for the complete list. All variables must be set in the Vercel dashboard (or `.env` locally).

Critical variables:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — auth
- `GHL_API_BASE_URL`, `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID` — GHL API
- `GHL_INBOUND_WEBHOOK_URL` — webhook for saves/submits
- `SESSION_SECRET` — must be 64+ chars, random
- `PORTAL_ORIGIN`, `SITE_ORIGIN` — CORS origins

## Logs
- No PII in logs (no passwords, tokens, or full payloads)
- Error messages include the operation name and a generic description
- Structured: `console.error('Save error:', err.message)`

## Health check
```
GET /api/health → { "ok": true, "timestamp": "..." }
```

## Rotating secrets

### Session secret
1. Generate new secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
2. Update `SESSION_SECRET` in Vercel env vars
3. Redeploy — all existing sessions will be invalidated (clients must re-sign-in)

### GHL token
1. Generate new token in GHL
2. Update `GHL_PRIVATE_TOKEN` in Vercel env vars
3. Redeploy

### Webhook secrets
1. Update in both GHL workflow settings and Vercel env vars
2. Redeploy

## Re-running a failed generation
```bash
# 1. Get the contact's data
node -e "
  const {createGhlClient} = require('./src/ghl/client');
  const {loadConfig} = require('./lib/config');
  const ghl = createGhlClient(loadConfig());
  ghl.getContact('CONTACT_ID').then(r => console.log(JSON.stringify(r, null, 2)));
"

# 2. Build spec
node -e "
  const {buildSpecFromContact} = require('./src/generator/build-spec');
  const contact = require('./contact-dump.json').contact;
  console.log(JSON.stringify(buildSpecFromContact(contact), null, 2));
" > specs/client-name.json

# 3. Run generator (from template-review-kit directory)
cd ../frontend-portal/template-review-kit
python3 generate.py ../../portal-backend/specs/client-name.json ../../portal-backend/sites/client-name

# 4. Write staging URL
node scripts/mark-deployed.js CONTACT_ID https://staging.example.com/client-name
```

## Common issues

### "Session expired" errors
The Supabase access token has a 1-hour lifetime. The client must re-sign-in.

### Webhook not reaching GHL
- Check `GHL_INBOUND_WEBHOOK_URL` is correct
- Check `GHL_INBOUND_WEBHOOK_SECRET` matches the workflow
- Check GHL workflow is active (not paused)

### Portal shows stale data
- Server prefill always overrides localStorage
- If GHL data is correct but portal shows old values, hard-refresh the page
