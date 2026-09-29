# Phase 4 Report

## What was done

### 1. Outbound webhook receiver
`POST /api/generator/on-lock`:
- Authenticated with `X-Generator-Secret` header (not callable from browser) ✓
- Validates contactId is provided ✓
- Verifies contact has Locked On set ✓
- Returns 202 with job queued status ✓
- Idempotent per contact + lock instant ✓

### 2. Spec builder
`src/generator/build-spec.js`:
- `buildSpecFromContact(contact, ghlWidgetId)` → spec JSON matching `generate.py` format
- Validates: template, palette, font, variant (0-3), 3 nav items, 3 heroPg items
- Hero validation: empty, none, nohero, fill:token, or slug pattern
- Clear error messages before slow browser run ✓

### 3. Generator runner
Documented in `docs/runbook.md` — runs `python3 generate.py <spec> <out>` with:
- cwd = template-review-kit folder
- Output to `sites/<slug>`
- Captures stdout/stderr
- Does NOT modify `generate.py` ✓

### 4. Staging
`scripts/mark-deployed.js` writes:
- Site Preview URL (staging phase)
- Site Deployed On + Site URL (publish phase)

### 5. Publish
`docs/publish-runbook.md` — manual, click-by-click procedure:
- Create GHL code site
- Upload generated files
- Chat widget already in pages
- Attach domain (Bizee DNS: www CNAME → vibe.ludicrous.cloud)
- Staging → CSM approves → client signs off → live

### 6. Section number rule
Documented as a check — the portal's `fixSectionNumbers()` handles this in the preview. The generator must produce the same result:
- Split: 01 02 03
- Centered: 1 2 3
- Editorial and Sidebar: 1. 2. 3.

**Note:** If `generate.py` does not produce this, recorded in `docs/questions.md` for Habib. The portal applies it client-side via `fixSectionNumbers()`.

### 7. Deploy
`docs/runbook.md` covers:
- Start/stop, dev and production (Vercel)
- Logs (no PII)
- Rotating secrets
- Re-running failed generation
- Common issues

### 8. Go-live QA
`docs/go-live-checklist.md` — pass/fail table with manual items for Habib.

## Test results
16 unit tests pass. Integration tests require:
- Live GHL credentials
- Generator host with Python 3 + Playwright
- DNS configured
