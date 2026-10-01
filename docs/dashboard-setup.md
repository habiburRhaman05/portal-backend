# Dashboards: one-time setup

The client dashboard and admin dashboard live in the separate `portal-frontend` project. The
backend in this repo is now API-only (the old `/clients` HTML routes stay until the frontend is live).

Do these in order. Steps 1-3 are things only you can do (they need your Supabase / Vercel logins).

## 1. Create the database tables (Supabase)

Supabase Dashboard -> **SQL Editor** -> New query -> paste all of `db/001_init.sql` -> **Run**.
Safe to run twice. It creates `profiles`, `invites`, `change_requests`, `audit_log` with row-level
security on and no policies, so the browser key cannot read or write them.

## 2. Lock down Supabase Auth

Supabase Dashboard -> **Authentication**:

| Setting | Value | Why |
|---|---|---|
| Sign In / Providers -> Email -> **Allow new users to sign up** | **Off** | Admins invite clients; the browser key must not be able to self-register. The API also refuses uninvited users, this is the second lock. |
| URL Configuration -> **Site URL** | your frontend URL (e.g. `https://clients.browndiamondcapital.com`) | |
| URL Configuration -> **Redirect URLs** | add `<frontend>/set-password` (and `http://localhost:5173/set-password` for local dev) | Invite and reset emails send people here. |
| Emails / SMTP | configure a custom SMTP provider | Supabase's built-in email is limited to a few messages per hour. Fine for testing, not for real invites. |

(Optional) Authentication -> Emails -> **Invite user** template: change the wording to match the welcome email.

## 3. Create the first admin

```bash
cd portal-backend
npm run make-admin -- you@yourcompany.com
```

If that email has no Supabase account yet, an invite email is sent; open it and choose a password.
If it already has one, it simply becomes an admin.

## 4. Run everything locally

```bash
# terminal 1: API on :3000
cd portal-backend && npm run dev

# terminal 2: frontend on :5173 (proxies /api to :3000)
cd portal-frontend && npm install && npm run dev
```

Open http://localhost:5173 and sign in as the admin. Invite a client from **Invites**.

The portal page is generated from the original HTML. Re-run it whenever the source HTML or
`patches/*.js` change, then commit the output in `portal-frontend`:

```bash
cd portal-backend && npm run prepare-portal     # writes ../portal-frontend/public/portal/index.html
```

## 5. Deploy

Two Vercel projects, same GitHub account:

**Backend** (`portal-backend`, already deployed): add `FRONTEND_URL` (the frontend's public URL).
No other new variables.

**Frontend** (`portal-frontend`): Import the repo, framework preset **Vite**. No environment
variables are needed — the browser only calls the backend, and the Supabase keys stay on the backend.

`vercel.json` in the frontend proxies `/api/*` to the backend (currently
`https://portal-backend-livid.vercel.app`; change it if the backend URL changes). Because the
browser only ever talks to the frontend's own domain, there is no CORS and no cross-site cookie.

Finally point `clients.browndiamondcapital.com` (CNAME) at the **frontend** project and set
`FRONTEND_URL`, `PORTAL_ORIGIN` on the backend to that address.

## 6. Retire the old backend-served pages

Once the frontend is live and tested, delete from the backend: the `/clients*` routes in
`src/app.js`, `public/`, and the legacy `POST /api/auth/signin` cookie route in `src/routes/auth.js`.
(Nothing else depends on them.)
