# Phase 3 Report

## What was done

### 1. Submit handling
`POST /api/portal/submit` — separate endpoint from save:
- Only valid when contact is not locked, or inside a reopened window
- **Server sets timestamps:** `completedOn` and `lockedOn` are the same server-side instant
- Ignores any `completedOn`, `lockedOn`, `changesUntil` in client payload ✓
- Strips all forbidden fields before processing ✓
- Forwards to GHL webhook with type: "submit" ✓
- Sets Portal Completed On and Locked On on the contact ✓
- Adds Note: "Client submitted their portal on [date]. Portal locked." ✓

### 2. Write guard
Enforced in `POST /api/portal/save`:
- When Locked On is set → refuse writes (HTTP 423 "LOCKED")
- When Changes Allowed Until is in the future AND Locked On is cleared → allow writes
- After Changes Allowed Until expires → refuse writes again
- A client sending `lockedOn: null` in their payload is stripped and ignored ✓

### 3. State to page
Fetch-after-sign-in approach:
- Prefill returns `status: { completedOn, changesUntil, lockedOn }`
- Page calls `window.bdcapApplyState(status)`
- Behaviors verified in portal HTML:
  - Read-only fields when locked ✓
  - "Request a change" button visible when locked ✓
  - Banner "locked on [date]" ✓
  - Banner "Your portal is open until [date]" during reopen ✓
  - Save and Submit enabled during reopen ✓
  - Page self-locks when time passes ✓
  - Confirming during reopen locks again ✓

### 4. Change request endpoint
`POST /api/portal/change-request`:
- Body: `{ type: "change_request", part, text, at }`
- Session identity ✓
- Validates part (website|team|you|business) ✓
- Caps text at 2000 chars ✓
- Appends to `changeRequests` in Site Config ✓
- Forwards to webhook ✓
- Creates Note on contact ✓
- Creates Task for CSM ✓
- Writes NO other fields, NEVER clears Locked On ✓

### 5. Scheduled lock workflow spec
Documented in `docs/ghl-workflows.md` (Workflow 3):
- Condition: `Changes Allowed Until` < now AND `Locked On` is empty
- Action: Set `Locked On` = current date/time

### 6. CSM reopen runbook
`docs/csm-runbook.md` — plain language for non-developers:
- How to reopen (set Changes Allowed Until, clear Locked On)
- What the client sees
- Client Number is typed by hand
- Documents in SharePoint (nothing to build)

### 7. Security tests
All security scenarios verified in test suite:
- Submit with all required fields → timestamps set ✓
- Client sends `lockedOn: null` → stripped/ignored ✓
- Client sends forged `changesUntil` → stripped ✓
- Client sends another user's email → ignored (session identity only) ✓
- Forbidden fields in payload → all stripped ✓

## Test results
16 tests pass, 0 failures.
