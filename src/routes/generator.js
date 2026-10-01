const express = require('express');
const { ghlToPortalPrefill } = require('../ghl/field-map');

// Called by a GHL workflow, authenticated by shared secret only (never by a browser session).
function generatorRouter({ config, ghl }) {
  const router = express.Router();

  router.post('/on-lock', async (req, res) => {
    const secret = req.headers['x-webhook-secret'] || req.headers['x-generator-secret'];
    if (!config.GENERATOR_WEBHOOK_SECRET || secret !== config.GENERATOR_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { contactId } = req.body || {};
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    try {
      const contact = (await ghl.getContact(contactId))?.contact;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const prefill = ghlToPortalPrefill(contact);
      if (!prefill.status.lockedOn) return res.status(400).json({ error: 'Contact is not locked' });

      // Queue generation job (in production this would be a job queue)
      console.log(`[Generator] Job queued for contact ${contactId}`);
      res.status(202).json({ ok: true, message: 'Generation job queued', contactId });
    } catch (err) {
      console.error('Generator webhook error:', err.message);
      res.status(500).json({ error: 'Could not process' });
    }
  });

  return router;
}

module.exports = { generatorRouter };
