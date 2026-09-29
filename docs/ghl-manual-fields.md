# GHL Custom Fields — Manual Checklist

Use this if the provisioning script cannot create fields via API. Create each folder and field exactly as listed.

## Folder: BDCap Portal – Your Information

| Field name | Type | Options |
|---|---|---|
| Legal First Name | Text | — |
| Legal Last Name | Text | — |
| Additional Contacts | Large Text | — |
| Business Name | Text | — |
| Business Name Backup 1 | Text | — |
| Business Name Backup 2 | Text | — |
| Business Theme | Dropdown | Business Strategy & Operations Consulting, Athlete Career Transition Consulting, Management Consulting, Leadership Development Consulting, NIL Consulting, Real Estate Consultancy |
| Business Purpose | Large Text | — |
| NAICS Code | Text | — |
| SIC Code | Text | — |

## Folder: BDCap Portal – Your Website

| Field name | Type | Options |
|---|---|---|
| Domain Choice | Text | — |
| Site Tagline | Text | — |
| Contact Button Wording | Text | — |
| Site Config | Large Text | — |
| Site Preview URL | Text | — |

## Folder: BDCap Portal – Status

| Field name | Type | Options |
|---|---|---|
| Client Number | Text | — |
| Portal Completed On | Date/Time | — |
| Changes Allowed Until | Date | — |
| Locked On | Date | — |
| Site Deployed On | Date | — |
| Site URL | Text | — |

## Existing fields to verify (correct options)

| Field name | Type | Options (must match exactly) |
|---|---|---|
| Preferred Contact Method | Dropdown | Email, Phone, SMS/Text, In Person, Social Media, Zoom |
| Preferred Contact Time | Multi-select | Morning, Evening, Night |

## After creating all fields
1. Run `node scripts/provision-fields.js` with `GHL_PRIVATE_TOKEN` set
2. It will detect existing fields and output `config/ghl-field-ids.json` with the real IDs
3. Commit the updated JSON file
