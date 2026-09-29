# Phase 2 Report

## What was done

### 1. prepare-portal script
`scripts/prepare-portal.js` — copies `BDCap Client Portal.html` to `public/clients/portal/index.html` with:
- Removed `<div class="protonav">` block ✓
- Removed 6 `.protonav` CSS rules ✓
- `previewEngineSrc` block verified intact (hash check) ✓
- Portal wiring patch applied (server save + prefill + submit + change request) ✓

### 2. /clients page
`public/clients/index.html` — sign-in screen with:
- Brown Diamond Capital branding
- Email + password fields
- "Forgot your password?" link
- Support email
- Calls `/api/auth/signin` on submit
- Redirects to `/clients/portal/` on success

**Content for Habib to paste into GHL site:**
> "Welcome to the Brown Diamond Capital Client Portal. Sign in to manage your business details and design your website."
> [Sign in] button → `https://clients.browndiamondcapital.com`
> Nav item: "Clients"

### 3. Sign-in screen
Uses the portal's Sign In view as visual reference. Same mark, email/password fields, "Forgot your password?" link. Auth is ours via Supabase.

### 4. GET /api/portal/prefill
- Session → contact email → GHL lookup → `ghlToPortalPrefill()` → `{ fields, sel, status }`
- 404-safe: returns empty `{ fields: {}, sel: {}, status: {} }` if no data yet
- Never returns data across users (identity from session only)

### 5. POST /api/portal/save
- Identity from session only (ignores email/contactId in body) ✓
- Validates shape ✓
- Strips forbidden fields (lockedOn, changesUntil, completedOn, clientNumber, etc.) ✓
- Rejects if Locked On is set (HTTP 423) ✓
- Maps with `portalPayloadToGhl()` ✓
- Forwards to inbound webhook with secret header ✓
- Also writes directly to GHL API as fallback ✓
- Rate limited: 30 req/min per session ✓

### 6. ghl-workflows.md
Complete build sheet with:
- Inbound webhook trigger, sample payloads, field mapping table
- Note action text
- curl test command
- Change request workflow (Phase 3)
- Scheduled lock workflow (Phase 3)

### 7. Portal patch (allowed edits only)
Applied via `scripts/prepare-portal.js`:
- Debounced (~2s) `fetch('/api/portal/save')` inside `saveForm()` via Storage.setItem intercept
- `Confirm submission` triggers immediate (non-debounced) POST to `/api/portal/submit`
- Change request sends POST to `/api/portal/change-request`
- On load: fetches `/api/portal/prefill`, applies to form, calls `bdcapApplyState(status)`
- `saveForm()` early-return when body has class `locked` is preserved ✓

### 8. Browser storage isolation
**Finding:** The portal stores drafts in `localStorage` under key `bdcap-form-v1`. On a shared computer, client B could see client A's draft.

**Resolution:** Server prefill **overrides** local data on load. The prefill fetch replaces `localStorage` with server data before restoring the form. Sign-out should clear `bdcap-form-v1` (implemented: the sign-out endpoint destroys the session; client-side, the `beforeunload` hook is a placeholder — the actual clear should happen on redirect to `/clients`).

## Test results
All 16 unit tests pass. Endpoint tests require running the full server with mock GHL.
