# Blockers — unresolved placeholders and items only Habib can do

| Placeholder | Phase | Why needed | Status |
|---|---|---|---|
| `GHL_API_BASE_URL` | P1 | GHL API v2 base URL | **Resolved** — real value in `.env` |
| `GHL_PRIVATE_TOKEN` | P1 | GHL private integration token | **Resolved** — real value in `.env`, custom fields provisioned |
| `GHL_LOCATION_ID` | P1 | GHL sub-account id | **Resolved** — real value in `.env` |
| `GHL_INBOUND_WEBHOOK_URL` | P2 | Inbound webhook workflow URL | Not set — save/submit currently write directly to GHL API instead |
| `GHL_INBOUND_WEBHOOK_SECRET` | P2 | Shared secret for webhook | Not set (only needed once `GHL_INBOUND_WEBHOOK_URL` is) |
| `GHL_CHANGE_REQUEST_WEBHOOK_URL` | P3 | Change request webhook URL | **Resolved** — real value in `.env` (`.../webhook-trigger/643893f1-...`) |
| `CSM_USER_ID` | P3 | Capital Success Manager GHL user id | Using mock `csm_user_placeholder` |
| `CSM_EMAIL` | P3 | CSM email address | Using mock `csm@placeholder.com` |
| `PORTAL_ORIGIN` | P2 | Portal domain origin | Using `https://clients.browndiamondcapital.com` |
| `SITE_ORIGIN` | P2 | Main site origin | Using `https://browndiamondcapital.com` |
| `EMAIL_PROVIDER_API_KEY` | P1 | For password-reset emails | Using Supabase built-in |
| `EMAIL_FROM` | P1 | Sender email for resets | Using Supabase built-in |
| `GENERATOR_HOST_SSH_OR_URL` | P4 | Server for Python generator | Using localhost |
| `GENERATOR_WEBHOOK_SECRET` | P4 | Auth for lock webhook | Using mock `gen_secret_placeholder` |
| `STAGING_BASE_URL` | P4 | Staging output URL | Using `http://localhost:3000/staging` |
| `DEPLOY_TARGET` | P4 | Where backend runs | Using Vercel |
| `GHL_WIDGET_ID_SOURCE` | P4 | Where chat widget id comes from | Needs Habib's answer |

## Manual actions needed from Habib
- Build inbound-webhook workflow in GHL (Phase 2)
- Build change-request workflow in GHL (Phase 3)
- Build scheduled-lock workflow in GHL (Phase 3)
- Build outbound "Locked On set" webhook in GHL (Phase 4)
- Create DNS CNAME records (GoDaddy + Bizee)
- Create /clients page on GHL code site
- Add "Clients" to site navigation
- Run provision-fields script or follow manual checklist
- Real-browser and real-phone testing
