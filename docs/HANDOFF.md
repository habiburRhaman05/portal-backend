# BDCap Client Portal: Handoff

## Architecture

```
Browser ──► portal-frontend (Vercel, static React app + the static portal page)
              │  /api/*  (Vercel rewrite = same-origin proxy, no CORS)
              ▼
            portal-backend (Vercel, Express, API only)
              ├─ Supabase Auth     who you are (email + password; invite-only)
              ├─ Supabase Postgres roles, invites, change-request workflow, audit log
              └─ GHL API           source of truth for client fields, design (Site Config) and lock dates
```

Roles: **admin** (BDCap staff) and **client**. Admins never create clients; they send a signup
link, the client sets their own password, fills in the portal, designs the site and submits
(which locks it). Changes after that go through a change request an admin approves or rejects.

## Who can do what

| Action | Client | Admin |
|---|---|---|
| Sign up | only via an admin's invite link | n/a (bootstrapped with `npm run make-admin`) |
| Fill in / design in the portal | until it is submitted (or while reopened) | no (read only via "view as client") |
| Submit (locks the portal) | yes, once | no |
| Send a change request | yes, when locked | no |
| Approve / reject a request | no | yes (approve reopens the portal for 24 h) |
| Edit a client's details or design | no | yes, any time; cannot touch lock dates or system fields |
| Reopen / lock a portal | no | yes |
| See every client's answers and chosen design | no, only their own | yes |

## Key files (backend)

| File | Purpose |
|---|---|
| `api/index.js` | Wires real Supabase + GHL into the app (Vercel entry) |
| `src/app.js` | Express app factory (everything injectable, so tests use fakes) |
| `src/routes/{auth,portal,client,admin,generator}.js` | The API |
| `src/auth/middleware.js` | Bearer-token auth, invite gate, admin guard |
| `src/lib/contacts.js` | The only place that reads/writes a client's GHL contact |
| `src/lib/db.js` | Supabase Postgres access (profiles, invites, change_requests, audit_log) |
| `src/lib/dates.js` | Lock / reopen rules |
| `src/ghl/field-map.js` | Portal fields <-> GHL fields (driven by FIELD-MAP.csv) |
| `patches/portal-pre.js`, `patches/portal-wiring.js` | The only changes made to the portal HTML, besides removing the prototype nav |
| `scripts/prepare-portal.js` | Builds the portal page into `portal-frontend/public/portal/` |
| `db/001_init.sql` | Database schema |

## API

Auth: every route except `/api/auth/refresh`, `/api/health` and `/api/generator/*` needs
`Authorization: Bearer <Supabase access token>`.

- **Client**: `GET /api/client/{overview,details,change-requests}`; portal: `GET /api/portal/prefill`, `POST /api/portal/{save,submit,change-request}`
- **Admin** (`/api/admin/*`): `GET clients`, `GET clients/:id`, `GET clients/:id/prefill`, `PUT clients/:id/details`, `POST clients/:id/{reopen,lock}`, `GET change-requests?status=`, `POST change-requests/:id/{approve,reject}`, `GET|POST invites`, `DELETE invites/:id`
- `POST /api/auth/refresh` exchanges a refresh token (used by the static portal page, which the SPA does not keep alive)

## Security rules the code enforces

1. Identity comes only from the verified token. A body/URL email or contact id is never used.
2. A valid Supabase account is not enough: the user needs a profile, created only when an admin invited that email.
3. Clients can never write: Locked On, Changes Allowed Until, Portal Completed On, Client Number, site status fields, contact first/last name. Admins cannot either.
4. Locked means writes are refused (HTTP 423) for clients; the server, not the page, decides.
5. Submit and change request are recorded on the server first; the page only locks / lists after the server says yes.
6. Timestamps are set by the server. GHL date fields keep only the day, so the exact instant is kept in Site Config.
7. Every admin action is written to `audit_log`.

## Environment variables

Backend: see `.env.example`. New: `FRONTEND_URL`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Tests

```bash
cd portal-backend
npm test            # field mapping + 23 route tests (real routers, fake GHL/DB)
npm run test:browser  # the real patched portal page in Chrome against a stub backend
```

## What is still manual

- Run `db/001_init.sql`, configure Supabase Auth, create the first admin (`docs/dashboard-setup.md`)
- GHL workflows (inbound webhook, change-request notifications, scheduled lock, outbound lock -> generator)
- DNS (`clients` CNAME to the frontend project), Vercel env vars
- Client Number, SharePoint folders, publishing the generated site (`docs/publish-runbook.md`)

## Known limits

- Rate limits are per serverless instance (no shared store).
- Page names and hero images can only be changed by the client in the portal (admins can change template, fonts, palette, copy variant).
- The site generator is not run by this backend; `/api/generator/on-lock` only validates and logs the request.
- The admin client list calls GHL once per client (5 at a time); fine for dozens of clients, add caching beyond a few hundred.
