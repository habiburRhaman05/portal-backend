# Questions for Habib

## Open Decisions (from plan §3)

### 1. First-visit password set
**Recommendation:** The current implementation auto-creates a Supabase auth account on first sign-in. This means anyone who knows a client's email can claim the account first. 

**Recommended fix:** Before creating an account, verify the email exists as a GHL contact. This requires the GHL API token to be active. Once it is, the sign-in flow will: (1) check if email matches an existing GHL contact, (2) only then allow account creation.

**Status:** Implemented with a TODO comment — the GHL contact check will activate once `GHL_PRIVATE_TOKEN` is provided.

### 2. State injection
**Recommendation:** Fetch-after-sign-in. The portal loads, fetches `/api/portal/prefill`, and calls `window.bdcapApplyState(status)`.

**Status:** Implemented this way.

### 3. Who forwards to GHL
**Recommendation:** Both. The backend forwards to the inbound webhook (for CSM-visible Notes and workflow behavior) AND writes directly via GHL API as a fallback. This ensures data is saved even if the webhook is temporarily down.

**Status:** Implemented — save endpoint forwards to webhook AND writes to GHL API.

### 4. `ghlWidgetId`
**Question:** Where does each client's GHL chat widget ID come from? Is it stored on the contact as a custom field, or is it the same for all clients?

**Status:** The spec builder accepts it as a parameter. Needs Habib's answer before generator can include it.

### 5. GHL code site API
**Question:** Does an API exist to create/update a GHL code site? If yes, we can automate publish in Phase 4.

**Status:** Assumed no for now — a manual publish runbook is provided.
