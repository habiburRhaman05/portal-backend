# Auth Review — BDCap Client Portal

**Reviewed:** 2026-09-29 (revised 2026-09-29 for Vercel deploy readiness)
**Existing auth:** `api/index.js` + `lib/supabase.js` (Supabase Auth)

## Revision note — why there's no server-side session store

An earlier pass of this review moved to `express-session` with the default in-memory store. That was reverted: Vercel serverless functions are stateless between invocations (no shared memory, no guarantee two requests hit the same instance), so an in-memory session store silently loses sessions in production — a user would get logged out at random.

The current design is a **stateless, verified-token cookie**: the Supabase access token (itself a signed, tamper-evident JWT that Supabase issues and validates) is held directly in an httpOnly cookie. Every request re-verifies it against Supabase (`supabaseAnon.auth.getUser(token)`) rather than trusting a session ID looked up in server memory. This has the same security properties as before — the client cannot forge or read the token, and identity is always confirmed server-side — but works identically on a long-running process and on serverless.

## Findings

### HIGH — Session stored in plain cookie, not verified server-side
**Evidence:** original `api/index.js:12-19` — access token stored directly in `res.cookie()`, never re-checked against Supabase per request
**Risk:** a stale or forged cookie value would be trusted without verification
**Fix applied:** the cookie is now re-verified against Supabase on every request via `requireAuth`/`requirePageAuth`. Cookie is HttpOnly, Secure (in production), SameSite=lax.

### HIGH — No fresh token issued on login
**Evidence:** `api/index.js` sign-in handler  
**Risk:** session fixation attack  
**Fix applied:** every successful sign-in calls Supabase's `signInWithPassword`, which issues a brand-new access token; the cookie is overwritten with that new token on every login, so an attacker-supplied prior cookie value is never reused.

### MEDIUM — Account enumeration via different error messages
**Evidence:** `api/index.js:63-66` — "Incorrect password" vs "Could not sign in" reveals whether an email is registered  
**Fix applied:** Uniform error "Invalid email or password" for all auth failures.

### MEDIUM — No rate limiting on auth endpoints
**Evidence:** No rate limiter on `/api/auth/signin`  
**Risk:** Brute-force password attacks  
**Fix applied:** `express-rate-limit` added: 20 attempts per 15-minute window on auth routes.

### MEDIUM — No CORS restriction
**Evidence:** No CORS middleware  
**Risk:** Any origin can make credentialed requests  
**Fix applied:** CORS locked to `PORTAL_ORIGIN` and `SITE_ORIGIN` with `credentials: true`.

### MEDIUM — No CSRF protection
**Evidence:** No CSRF token or SameSite enforcement  
**Fix applied:** Auth cookie uses `SameSite=lax` which prevents CSRF on state-changing POST requests from cross-origin forms. Combined with CORS restriction, this is sufficient.

### MEDIUM — Rate limiter uses in-memory store
**Risk:** `express-rate-limit`'s default store is also per-instance, so on Vercel the 20-attempts/15-min and 30-req/min limits are enforced per warm function instance, not globally. This is a known, accepted limitation for now — it still blocks unsophisticated brute-force from a single warm instance, but a distributed attack across many cold starts could evade it. If this needs to be airtight, the fix is a shared store (e.g. Redis) for the rate limiter, which is out of scope until traffic warrants it.

### LOW — No helmet security headers
**Fix applied:** `helmet()` middleware added for security headers (X-Frame-Options, X-Content-Type-Options, etc.)

### LOW — Email not normalized
**Evidence:** `api/index.js:43-44` — email used as-is from request body  
**Risk:** `User@Test.com` and `user@test.com` could create separate accounts  
**Fix applied:** `normalizeEmail()` (trim + lowercase) applied to all email inputs.

### LOW — No request body size limit
**Fix applied:** `express.json({ limit: '256kb' })` added.

## Security invariants verified
- Identity comes from server session only (never URL, body, or client-controlled headers)
- Forbidden fields stripped from all write payloads
- Lock enforcement on all write paths
- No PII in console logs (error messages only, no tokens/passwords/payloads)
- Session cookie: HttpOnly ✓, Secure (in production) ✓, SameSite=lax ✓
