# Go-Live Checklist

## Browser tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 1 | `/clients` loads in Chrome | Open https://clients.browndiamondcapital.com | ☐ | Habib |
| 2 | `/clients` loads in Safari | Open same URL in Safari | ☐ | Habib |
| 3 | Sign in reaches our screen | Click "Sign in" → see email/password form | ☐ | Habib |
| 4 | First-time client: email → set password → portal | Enter test email, choose password → lands on `/clients/portal/` | ☐ | Habib |
| 5 | Signed out → redirect to `/clients` | Open `/clients/portal/` without signing in → redirected | ☐ | Automated |
| 6 | Preview renders on all 4 templates at full height | Switch template in portal preview: editorial, split, sidebar, centered | ☐ | Habib |
| 7 | Shuffle works | Click "Shuffle" under Site theme → different template/fonts/palette/images | ☐ | Habib |
| 8 | More options works | Under .com names, click "More options" → clears pick, loads next set | ☐ | Habib |
| 9 | Business name → .com suggestions | Type a business name → suggestions appear within seconds | ☐ | Habib |

## Data tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 10 | Save persists across reloads | Fill fields, reload → data still there (from GHL, not just localStorage) | ☐ | Habib |
| 11 | Submit with all required fields | Fill all required → Save and Submit → Confirm → locked | ☐ | Habib |
| 12 | Portal Completed On = Locked On | Check GHL contact → same instant | ☐ | Habib |
| 13 | Site Config holds JSON | Check BDCap Portal – Your Website › Site Config | ☐ | Habib |
| 14 | Note exists on contact | Check contact's Notes | ☐ | Habib |

## Lock and change request tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 15 | Reopen: values prefill, still locked | Sign in as same client → data there, portal locked | ☐ | Habib |
| 16 | Change request: Note + Task + email | Send a change request → check GHL for Note, Task, and CSM email | ☐ | Habib |
| 17 | No field changed after change request | Verify no portal fields changed on the contact | ☐ | Habib |
| 18 | Portal stays locked after request | Portal still shows locked state | ☐ | Habib |
| 19 | Reopen window works | Set Changes Allowed Until = tomorrow, clear Locked On → "open until" banner | ☐ | Habib |
| 20 | Confirming again locks it | Submit during reopen → portal locks | ☐ | Habib |

## Isolation tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 21 | Second client sees no first client data | Sign in as different email → no data from first client | ☐ | Habib |
| 22 | Identity spoofing fails | Body contains different email → server uses session email only | ☐ | Automated |

## Mobile tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 23 | Phone: no horizontal scroll (Your Information) | Chrome on phone, portrait | ☐ | Habib |
| 24 | Phone: preview shows phone layout | Chrome on phone, preview section | ☐ | Habib |

## Generator tests

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 25 | Lock triggers generation | Set Locked On → generator receives contact id | ☐ | Habib |
| 26 | Generator produces 3 pages + report | Check `sites/<slug>/` output | ☐ | Habib |
| 27 | Report matches contact fields | Compare build-report.html to GHL contact data | ☐ | Habib |

## RDAP / .com suggestions

| # | Test | How | Pass/Fail | Who |
|---|---|---|---|---|
| 28 | .com suggestions from live domain | From browndiamondcapital.com, type business name → suggestions resolve | ☐ | Habib |
| 29 | CORS check: rdap.verisign.com | Confirm Verisign allows requests from our origins (or proxy is working) | ☐ | Habib |

## Items that need a real device (cannot automate)
- Tests 1-9, 10-20, 23-24: require real browser on desktop and phone
- Tests 25-27: require generator host with Python 3 + Playwright
- Test 28-29: require the live domain with DNS configured
