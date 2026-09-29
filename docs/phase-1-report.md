# Phase 1 Report

## What was done

### 1. Understanding
Read the Engineer Instructions docx, FIELD-MAP.csv, generate.py, CLAUDE.md in the kit, and the existing backend code. Questions and open decisions documented in `docs/questions.md`.

### 2. Auth review and hardening
Full review in `docs/AUTH_REVIEW.md`. Applied fixes for all HIGH and MEDIUM findings:
- Server-side sessions (express-session) replacing raw cookie tokens
- Session regeneration on login
- Uniform error messages (no account enumeration)
- Rate limiting on auth endpoints (20/15min)
- CORS locked to portal and site origins
- Helmet security headers
- Email normalization (trim + lowercase)
- Body size limit (256kb)

### 3. GHL client
`src/ghl/client.js` — typed wrapper for:
- `getContactByEmail(email)` — search by email
- `getContact(id)` — get by ID
- `updateContact(id, data)` — update fields
- `searchContacts(query)` — search
- `createNote(contactId, body)` — add note
- `createTask(contactId, task)` — add task
- `listCustomFields()` — list all custom fields
- `createCustomField(field)` — create a field

Retry with exponential backoff on 429/5xx, 15s timeout, no tokens in logs.

### 4. Field provisioning
`scripts/provision-fields.js` — idempotent, supports `--dry-run`. Creates all fields from FIELD-MAP.csv in the correct folders with correct types and options. Generates `config/ghl-field-ids.json`.

Dropdown options match the portal exactly:
- Preferred Contact Method: Email, Phone, SMS/Text, In Person, Social Media, Zoom
- Preferred Contact Time: Morning, Evening, Night (multi-select)
- Business Theme: 6 themes extracted from portal HTML

### 5. Field mapping
`src/ghl/field-map.js` implements:
- `portalPayloadToGhl(payload)` — portal fields+sel to GHL writes
- `ghlToPortalPrefill(contact)` — GHL contact to portal prefill
- `stripForbiddenFields(payload)` — removes all forbidden fields
- Team row 1 → Secondary Contact fields; rows 2-5 → Additional Contacts JSON
- contactTimeMorning/Evening/Night → multi-select
- sel → Site Config JSON string

Write rules enforced:
- Contact First/Last Name: NEVER written ✓
- Preferred Contact Method/Time, DOB, Address: always overwritten ✓
- Email, Phone, Secondary Contact: overwritten ✓

### 6. Config
`.env.example` lists every variable from §2. `lib/config.js` fails fast with readable messages.

### 7. Mock GHL server
`tests/mock-ghl-server.js` — in-memory mock for all GHL endpoints used.

## Test results
```
16 passed, 0 failed
```

## Field map verification
Portal element IDs verified against FIELD-MAP.csv:
- `legalFirstName`, `legalLastName`, `dateOfBirth`, `personalEmail`, `personalPhone` ✓
- `mailingStreet`, `mailingCity`, `mailingState`, `mailingZip` ✓
- `preferredContact`, `contactTimeMorning/Evening/Night` ✓
- `team_name_1` through `team_*_5` ✓
- `bizNameInput`, `backupName1`, `backupName2` ✓
- `themeSelect`, `purposeText`, `naicsField`, `sicField` ✓
- `domainInput`, `taglineInput`, `ctaSel` ✓
- `sel` (JSON object with tpl, fnt, pal, thm, variant, nav0-2, heroPg, etc.) ✓
- `bizNameMirror`, `siteThemeSelect` — mirrors, not stored ✓

No mismatches found.
