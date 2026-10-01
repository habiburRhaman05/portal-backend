# Capital Success Manager runbook

You now do most of this in the **admin dashboard**, not in GHL.

## Inviting a client

1. Admin dashboard -> **Invites** -> enter the client's email -> **Send invite**.
2. They get an email with a link. They choose their own password; nobody at Brown Diamond sees it.
3. When they sign in, their account and GHL contact are linked automatically (an existing GHL contact with the same email is reused, never duplicated).

A waiting invite can be **Revoked**. Type the email the client will actually use: it becomes their login.

## Watching progress

**Clients** lists everyone with their status: Not started, In progress, Submitted, Reopened. Open a client to see
everything they filled in, the website design they chose (template, fonts, palette, page names, hero images), their change
requests and an activity log. **View portal as client** shows their real portal with the live site preview, read only.

## When a client sends a change request

The portal is locked after the client submits. A request appears under **Change requests** (and in GHL as a Note, a Task and an email to you).

- **Approve**: the client's portal reopens for 24 hours. They edit it and confirm again, which locks it again. They see "approved" and your note.
- **Reject**: the portal stays locked. They see "rejected" and your note, so write one.

You can also **Reopen portal** yourself from the client page (24 hours to 7 days), **Lock now** to end a window early, or **Edit details** to change a client's answers or design yourself without reopening anything.

## What clients can never change

Lock dates, Client Number, and the site fields. Client Number is typed by you in GHL before the client is invited; nothing reads or writes it.

## Documents

Handled in SharePoint, outside GHL: create the client's folder, share it with them by email. Nothing is connected.

## After the site is generated

When a portal is locked, the generator builds the three-page site and writes the **Site Preview URL** onto the contact (the client sees it on their dashboard).
Review the build report, then follow `publish-runbook.md`. After publishing, **Site Deployed On** and **Site URL** appear on the client's dashboard too.

## When the phone number arrives

Update the contact's Phone in GHL and ask the developer to regenerate the site.
