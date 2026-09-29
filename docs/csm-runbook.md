# Capital Success Manager Runbook

## What the client portal does

The client portal lets your clients fill in their personal and business details, choose a website design (template, fonts, colors, theme, hero images), and submit everything in one place. When they click **Confirm submission**, the portal locks and the site generation process begins.

---

## Reopening a portal after a change request

When a client sends a change request from the locked portal, you'll receive an email and a Task in GHL. To let the client make changes:

1. Open the contact in GHL
2. Go to **BDCap Portal – Status**
3. Set **Changes Allowed Until** to **tomorrow's date** (24 hours from now)
4. **Clear** the **Locked On** field (delete the value, leave it empty)
5. Save the contact

The client will now see a banner: **"Your portal is open until [date]"**. They can edit and submit again. After they confirm, or when the date passes, the portal locks itself again.

**Important:** Never set Changes Allowed Until without clearing Locked On. Both must happen together.

---

## Client Number

Client Number is typed by you (the CSM) by hand before inviting the client to the portal. Format: initials + 4-digit sequence (e.g., BE0001).

No workflow reads or writes this field. It exists only for your reference.

---

## What happens on submission

When a client confirms submission:
1. **Portal Completed On** and **Locked On** are set to the same instant
2. A Note is added to the contact
3. The portal becomes read-only
4. The "Request a change" button appears

---

## Change requests

When a client sends a change request:
1. A **Note** is added to their contact with the request details
2. A **Task** is created and assigned to you
3. You receive an **email** notification
4. **No fields are changed** and the portal stays locked

To act on the request, follow the "Reopening a portal" steps above.

---

## Documents

Client documents are handled entirely in **SharePoint**, not in GHL:
- Create the client's folder in SharePoint by hand
- Share it with the client by email
- The portal's "Your Documents" panel is a static reference list — there's nothing to connect

---

## After the site is generated

When a client's portal is locked, the system generates a 3-page website:
1. The **Site Preview URL** field on the contact will show the staging link
2. Review the staging site and the build report
3. File the build report in SharePoint if needed
4. When ready, follow the publish runbook to put the site live
5. After publishing, **Site Deployed On** and **Site URL** are set on the contact

---

## When the phone number arrives

When a phone number is issued for the client later:
1. Update the contact's **Phone** field in GHL
2. The site will need to be regenerated to include the phone number
3. Contact the developer to re-run the generator for this contact
