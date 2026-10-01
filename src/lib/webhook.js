// Best-effort POST to a GHL workflow webhook. Never throws: GHL being slow or
// down must not fail a save the client already made to the GHL API directly.
async function postWebhook(url, body, secret) {
  if (!url) return { sent: false, reason: 'not_configured' };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Webhook-Secret'] = secret;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    console.error('Webhook error:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { postWebhook };
