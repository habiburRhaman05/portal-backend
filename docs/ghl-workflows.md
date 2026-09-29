# GHL Workflow Build Sheets

## Workflow 1: Inbound Webhook — Portal Save / Submit

### Trigger
**Inbound Webhook** — receives POST from the backend at `{{GHL_INBOUND_WEBHOOK_URL}}`

### Authentication
Header `X-Webhook-Secret` must match `{{GHL_INBOUND_WEBHOOK_SECRET}}` (if configured).

### Sample payload (save)
```json
{
  "email": "bobby.evans@example.com",
  "fields": {
    "legalFirstName": "Bobby",
    "legalLastName": "Evans",
    "personalEmail": "bobby.evans@example.com",
    "personalPhone": "555-123-4567",
    "mailingStreet": "123 Main St",
    "mailingCity": "Austin",
    "mailingState": "TX",
    "mailingZip": "78701",
    "preferredContact": "Email",
    "contactTimeMorning": true,
    "contactTimeEvening": false,
    "contactTimeNight": true,
    "team_name_1": "Jane Smith",
    "team_role_1": "Business Manager",
    "team_phone_1": "555-987-6543",
    "team_email_1": "jane@example.com",
    "bizNameInput": "Bobby Evans Advisory",
    "backupName1": "Evans Advisory Group",
    "backupName2": "BE Advisory",
    "themeSelect": "NIL Consulting",
    "purposeText": "Helping athletes transition to business careers",
    "domainInput": "bobbyevansadvisory.com",
    "taglineInput": "Structure first",
    "ctaSel": "Schedule a call"
  },
  "sel": {
    "tpl": "sidebar",
    "fnt": "Contemporary",
    "pal": "Oxblood",
    "thm": "NIL Consulting",
    "variant": 2,
    "nav0": 0,
    "nav1": 3,
    "nav2": 1,
    "heroPg": ["sport-arena-09", "fill:accent-dark", "nohero"],
    "tagline": "Structure first",
    "cta": "Schedule a call",
    "entity": "Bobby Evans Advisory"
  }
}
```

### Sample payload (submit)
Same as save, plus:
```json
{
  "type": "submit",
  "sel": {
    "...same as above...",
    "completedOn": "2026-09-29T15:30:00.000Z",
    "lockedOn": "2026-09-29T15:30:00.000Z",
    "changesUntil": ""
  }
}
```

### Workflow actions

#### Action 1: Create/Update Contact
- **Match on:** `email` field from payload
- **Field mapping:**

| Payload key | GHL field | Rule |
|---|---|---|
| `fields.personalEmail` | Contact › Email | overwrite |
| `fields.personalPhone` | Contact › Phone | overwrite |
| `fields.dateOfBirth` | General Info › Date of Birth | always overwrite |
| `fields.mailingStreet` | General Info › Address – Street | always overwrite |
| `fields.mailingCity` | General Info › Address – City | always overwrite |
| `fields.mailingState` | General Info › Address – State | always overwrite |
| `fields.mailingZip` | General Info › Address – Postal Code | always overwrite |
| (country) | General Info › Country | always set to "US" |
| `fields.preferredContact` | Contact › Preferred Contact Method | always overwrite |
| contactTimeMorning/Evening/Night → | Contact › Preferred Contact Time | always overwrite (multi-select) |
| `fields.team_name_1` | Contact › Secondary Contact Name | overwrite |
| `fields.team_role_1` | Contact › Secondary Contact Title/Relation | overwrite |
| `fields.team_phone_1` | Contact › Secondary Contact Phone | overwrite |
| `fields.team_email_1` | Contact › Secondary Contact Email | overwrite |
| `fields.legalFirstName` | BDCap Portal › Legal First Name | overwrite |
| `fields.legalLastName` | BDCap Portal › Legal Last Name | overwrite |
| team rows 2-5 (JSON) | BDCap Portal › Additional Contacts | overwrite |
| `fields.bizNameInput` | BDCap Portal › Business Name | overwrite |
| `fields.backupName1` | BDCap Portal › Business Name Backup 1 | overwrite |
| `fields.backupName2` | BDCap Portal › Business Name Backup 2 | overwrite |
| `fields.themeSelect` | BDCap Portal › Business Theme | overwrite |
| `fields.purposeText` | BDCap Portal › Business Purpose | overwrite |
| `fields.naicsField` | BDCap Portal › NAICS Code | overwrite |
| `fields.sicField` | BDCap Portal › SIC Code | overwrite |
| `fields.domainInput` | BDCap Portal › Domain Choice | overwrite |
| `fields.taglineInput` | BDCap Portal › Site Tagline | overwrite |
| `fields.ctaSel` | BDCap Portal › Contact Button Wording | overwrite |
| `sel` (JSON string) | BDCap Portal › Site Config | overwrite |
| ❌ Contact › First Name | **NEVER written** |
| ❌ Contact › Last Name | **NEVER written** |

**On submit only:**
| Payload key | GHL field |
|---|---|
| `sel.completedOn` | BDCap Portal › Portal Completed On |
| `sel.lockedOn` | BDCap Portal › Locked On |
| (set value) | Sales Activities › Contact Type = "Client" |

#### Action 2: Add Note
```
Client updated their details in the portal on {{current_date}}.
```
On submit:
```
Client submitted their portal on {{current_date}}. Portal locked.
```

### Test with curl
```bash
curl -X POST "{{GHL_INBOUND_WEBHOOK_URL}}" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: {{GHL_INBOUND_WEBHOOK_SECRET}}" \
  -d '{"email":"test@example.com","fields":{"bizNameInput":"Test Corp","legalFirstName":"Test"},"sel":{"tpl":"editorial"}}'
```

---

## Workflow 2: Change Request

### Trigger
**Inbound Webhook** at `{{GHL_CHANGE_REQUEST_WEBHOOK_URL}}`

### Sample payload
```json
{
  "email": "bobby.evans@example.com",
  "type": "change_request",
  "part": "website",
  "text": "I'd like to change my tagline to 'Building futures'",
  "at": "2026-09-29T16:00:00.000Z"
}
```

### Actions (exactly three, nothing else)

#### Action 1: Add Note
```
Change request ({{part}}): {{text}}
Submitted: {{at}}
```

#### Action 2: Create Task
- **Assigned to:** `{{CSM_USER_ID}}`
- **Title:** Change request from {{contact_name}}: {{part}}
- **Body:** {{text}}
- **Due:** 24 hours from now

#### Action 3: Send Email
- **To:** `{{CSM_EMAIL}}`
- **Subject:** Client change request: {{part}}
- **Body:** {{contact_name}} has requested a change to their {{part}}. Details: {{text}}

**This workflow writes NO fields and NEVER clears Locked On.**

---

## Workflow 3: Scheduled Lock (when reopened window passes)

### Trigger
**Scheduled / recurring** — check daily or on a timer

### Condition
Contact has:
- `Changes Allowed Until` is in the past (< now)
- `Locked On` is empty

### Action
Set `Locked On` = current date/time

This handles the case where a CSM reopened the portal (cleared Locked On, set Changes Allowed Until to 24h out) and the client did not re-submit before the window closed.

---

## Workflow 4: Outbound Lock → Generator (Phase 4)

### Trigger
**Contact field changed:** `Locked On` is set (not empty)

### Action
**Outbound Webhook** POST to `{{GENERATOR_HOST_SSH_OR_URL}}/api/generator/on-lock`

Headers:
```
Content-Type: application/json
X-Generator-Secret: {{GENERATOR_WEBHOOK_SECRET}}
```

Body:
```json
{
  "contactId": "{{contact_id}}"
}
```
