const { portalState } = require('./dates');

// personalEmail is deliberately not counted: creating the GHL contact prefills it with the
// account email, so it says nothing about whether the client has started.
const INFO_KEYS = [
  'legalFirstName', 'legalLastName', 'dateOfBirth', 'personalPhone',
  'mailingStreet', 'mailingCity', 'mailingState', 'mailingZip', 'preferredContact',
  'bizNameInput', 'themeSelect', 'purposeText',
];
const SITE_KEYS = ['domainInput', 'taglineInput', 'ctaSel'];

const filled = (fields, keys) => keys.filter(k => String(fields[k] ?? '').trim()).length;

function progress(prefill) {
  const f = prefill.fields || {};
  return {
    information: { filled: filled(f, INFO_KEYS), total: INFO_KEYS.length },
    website: { filled: filled(f, SITE_KEYS) + (prefill.sel.tpl ? 1 : 0), total: SITE_KEYS.length + 1 },
  };
}

// Display data copied from the portal page (BDCap Client Portal.html): NAV_SETS, the
// .swatch hex values, the template cards and the font pairings in the kit's CLAUDE.md.
const NAV_SETS = [
  ['Why We Exist', 'Our Purpose', 'What We Do', 'How We Work'],
  ['Who We Serve', 'Who It’s For', 'Who We Work With', 'Our Focus'],
  ['Contact', 'Get in Touch', 'Start a Conversation', 'Reach Us'],
];
const PALETTES = {
  Forest: '#1F4A3A', Navy: '#1B2A4A', Charcoal: '#2B2B2B', Oxblood: '#5C1F1F',
  Umber: '#6B4A2F', Aubergine: '#4A2140', Slate: '#20303A', Ironstone: '#4A4A4A',
};
const TEMPLATES = { editorial: 'Editorial', split: 'Split', sidebar: 'Sidebar', centered: 'Centered' };
const FONT_PAIRS = { Classic: 'Lora + Inter', Contemporary: 'Space Grotesk + Manrope' };

function heroLabel(v) {
  if (!v) return 'Theme default';
  if (v === 'none' || v === 'nohero') return 'No image';
  if (v.startsWith('fill:')) return 'Solid colour (' + v.slice(5).replace(/-/g, ' ') + ')';
  return v.replace(/-\d+$/, '').replace(/-/g, ' ') + ' photo';
}

// What the client picked in the website designer, in one flat object for the UI.
function design(sel = {}) {
  const heroes = Array.isArray(sel.heroPg) ? sel.heroPg : [];
  const navs = [sel.nav0, sel.nav1, sel.nav2];
  const variant = Number.isInteger(sel.variant) ? sel.variant : null;
  return {
    template: sel.tpl || '',
    templateLabel: TEMPLATES[sel.tpl] || '',
    fonts: sel.fnt || '',
    fontPair: FONT_PAIRS[sel.fnt] || '',
    palette: sel.pal || '',
    paletteHex: PALETTES[sel.pal] || '',
    theme: sel.thm || '',
    variant,
    variantLabel: variant === null ? '' : 'ABCD'[variant] || '',
    tier: sel.tier || '',
    pageNames: navs.map((n, i) => (NAV_SETS[i] && NAV_SETS[i][n]) || ''),
    heroImages: heroes,
    heroLabels: heroes.map(heroLabel),
    tagline: sel.tagline || '',
    cta: sel.cta || '',
    entity: sel.entity || '',
  };
}

function displayName(profile, fields) {
  const legal = [fields.legalFirstName, fields.legalLastName].filter(Boolean).join(' ').trim();
  const ghl = [fields._contactFirstName, fields._contactLastName].filter(Boolean).join(' ').trim();
  return legal || ghl || profile.email;
}

function summarize(profile, prefill, pendingRequests = 0) {
  const p = progress(prefill);
  const hasData = p.information.filled > 0 || p.website.filled > 0;
  return {
    id: profile.id,
    email: profile.email,
    name: displayName(profile, prefill.fields),
    businessName: prefill.fields.bizNameInput || '',
    theme: prefill.fields.themeSelect || prefill.sel.thm || '',
    template: prefill.sel.tpl || '',
    palette: prefill.sel.pal || '',
    state: portalState(prefill.status, hasData),
    completedOn: prefill.status.completedOn,
    lockedOn: prefill.status.lockedOn,
    changesUntil: prefill.status.changesUntil,
    pendingRequests,
    progress: p,
    site: prefill.site,
    createdAt: profile.created_at,
  };
}

module.exports = { summarize, progress, design, displayName };
