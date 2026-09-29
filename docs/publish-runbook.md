# Publish Runbook — "The brillare8.com Method"

## Prerequisites
- Generated site in `sites/<slug>/` with all pages and assets
- Build report reviewed and approved by CSM
- Client signed off on the preview
- Domain purchased and DNS accessible

## Step-by-step

### 1. Create a new GHL code site
1. In GHL, go to **Sites** → **Websites** → **+ New Website**
2. Choose **Start from scratch** (blank)
3. Name it: `<client business name>` (e.g., "Bobby Evans Advisory")

### 2. Upload generated files
1. In the site editor, switch to **Code** view
2. Upload the generated files:
   - `index.html` → root
   - `<page-2-slug>.html` → root
   - `contact.html` → root
   - `assets/*.webp` → `assets/` folder
3. The chat widget script is already in the HTML (if `ghlWidgetId` was provided)

### 3. Attach domain
1. Go to **Settings** → **Domains**
2. Add the client's domain (e.g., `bobbyevansadvisory.com`)
3. In DNS (Bizee/GoDaddy): add `www` CNAME → `vibe.ludicrous.cloud`
4. Wait for DNS propagation (usually 5–30 minutes)
5. Verify the site loads at the domain

### 4. Staging → Approval → Live
1. **Staging:** Share the preview URL with the CSM
2. **CSM approves:** CSM reviews the build report against the contact fields
3. **Client signs off:** CSM shares with the client for final approval
4. **Go live:** Publish the GHL site to the custom domain

### 5. Write back to GHL
Run the mark-deployed script:
```bash
node scripts/mark-deployed.js <contactId> <siteUrl>
```

This sets:
- **Site Deployed On** = current date
- **Site URL** = the live URL

### 6. When a phone number is issued later
1. Update the contact's **Phone** field in GHL
2. Re-run the generator: `python3 generate.py specs/<client>.json sites/<slug>`
3. Re-upload the generated files to the GHL code site
4. Verify the phone number appears on the contact page

## Troubleshooting
- **DNS not resolving:** Check that the CNAME is correct and propagation has completed
- **Site shows old content:** Clear the GHL CDN cache (re-publish the site)
- **Chat widget not loading:** Verify the `ghlWidgetId` in the spec is correct
