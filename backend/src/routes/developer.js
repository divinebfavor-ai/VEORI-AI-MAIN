// ─── Developer settings (logged-in operator) ─────────────────────────────────
// Backs Settings > Developers: create/revoke API keys and manage webhook
// endpoints. Uses the same services as the public API.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const keys = require('../services/apiKeyService');
const webhooks = require('../services/webhookService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e && e.status && e.status < 500) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

router.get('/meta', (_req, res) => {
  res.json({ success: true, scopes: keys.SCOPES, events: webhooks.EVENTS });
});

router.get('/api-keys', wrap(async (req, res) => {
  res.json({ success: true, data: await keys.listKeys(req.user.id) });
}));

router.post('/api-keys', wrap(async (req, res) => {
  const { key, api_key: apiKey } = await keys.createKey(req.user.id, req.body || {});
  res.status(201).json({ success: true, key, data: apiKey });
}));

router.delete('/api-keys/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'API key not found' });
  const ok = await keys.revokeKey(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'API key not found or already revoked' });
  res.json({ success: true });
}));

router.get('/webhooks', wrap(async (req, res) => {
  res.json({ success: true, data: await webhooks.listEndpoints(req.user.id) });
}));

router.post('/webhooks', wrap(async (req, res) => {
  const { endpoint, secret } = await webhooks.createEndpoint(req.user.id, req.body || {});
  res.status(201).json({ success: true, data: endpoint, secret });
}));

router.patch('/webhooks/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
  res.json({ success: true, data: await webhooks.updateEndpoint(req.user.id, req.params.id, req.body || {}) });
}));

router.delete('/webhooks/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
  await webhooks.deleteEndpoint(req.user.id, req.params.id);
  res.json({ success: true });
}));

router.get('/webhooks/:id/deliveries', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
  res.json({ success: true, data: await webhooks.listDeliveries(req.user.id, req.params.id, 50) });
}));

router.post('/webhooks/:id/test', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Webhook endpoint not found' });
  res.json({ success: true, data: await webhooks.sendTestEvent(req.user.id, req.params.id) });
}));

module.exports = router;
