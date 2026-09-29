const { ghlToPortalPrefill } = require('../ghl/field-map');

const VALID_TEMPLATES = ['editorial', 'split', 'sidebar', 'centered'];
const VALID_PALETTES = ['Forest', 'Navy', 'Charcoal', 'Oxblood', 'Umber', 'Aubergine', 'Slate', 'Ironstone'];
const VALID_FONTS = ['Classic', 'Contemporary'];
const FILL_TOKENS = new Set(['ink', 'accent', 'accent-dark', 'surface', 'body', 'line', 'tint', 'band']);

function validateSpec(spec) {
  const errors = [];

  if (!spec.client) errors.push('Missing client block');
  if (!spec.site) errors.push('Missing site block');

  if (spec.client) {
    if (!spec.client.entity) errors.push('client.entity is required');
    if (!spec.client.email && !spec.client.domain) errors.push('client.email or client.domain is required');
  }

  if (spec.site) {
    if (!VALID_TEMPLATES.includes(spec.site.tpl)) errors.push(`Invalid template: ${spec.site.tpl}`);
    if (!VALID_FONTS.includes(spec.site.fnt)) errors.push(`Invalid font: ${spec.site.fnt}`);
    if (!VALID_PALETTES.includes(spec.site.pal)) errors.push(`Invalid palette: ${spec.site.pal}`);
    const v = parseInt(spec.site.variant);
    if (isNaN(v) || v < 0 || v > 3) errors.push(`Invalid variant: ${spec.site.variant}`);
    if (!Array.isArray(spec.site.nav) || spec.site.nav.length !== 3) errors.push('nav must be an array of 3');
    if (!Array.isArray(spec.site.heroPg) || spec.site.heroPg.length !== 3) errors.push('heroPg must be an array of 3');

    if (spec.site.heroPg) {
      for (const h of spec.site.heroPg) {
        if (h === '' || h === 'none' || h === 'nohero') continue;
        if (h.startsWith('fill:') && FILL_TOKENS.has(h.slice(5))) continue;
        if (/^[a-z]+-[a-z0-9]+-\d\d$/.test(h)) continue;
        errors.push(`Invalid hero: ${h}`);
      }
    }
  }

  return errors;
}

function buildSpecFromContact(contact, ghlWidgetId) {
  const prefill = ghlToPortalPrefill(contact);
  const { fields, sel } = prefill;

  const entity = fields.bizNameInput || contact.firstName + ' ' + (contact.lastName || '');
  const domain = fields.domainInput || '';
  const email = fields.personalEmail || (domain ? `info@${domain}` : '');

  const spec = {
    client: {
      entity,
      tagline: fields.taglineInput || '',
      cta: fields.ctaSel || '',
      email,
      phone: fields.personalPhone || '',
      address: [
        fields.mailingStreet,
        fields.mailingCity,
        fields.mailingState,
        fields.mailingZip,
      ].filter(Boolean).join(', '),
      domain,
      ghlWidgetId: ghlWidgetId || '',
    },
    site: {
      tpl: sel.tpl || 'editorial',
      fnt: sel.fnt || 'Classic',
      pal: sel.pal || 'Charcoal',
      thm: sel.thm || 'Business Strategy & Operations Consulting',
      variant: sel.variant || 0,
      nav: [sel.nav0 || 0, sel.nav1 || 0, sel.nav2 || 0],
      heroPg: sel.heroPg || ['', '', ''],
    },
  };

  const errors = validateSpec(spec);
  if (errors.length) {
    throw new Error('Invalid spec: ' + errors.join('; '));
  }

  return spec;
}

module.exports = { buildSpecFromContact, validateSpec };
