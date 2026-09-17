// ─── CRM connectors ───────────────────────────────────────────────────────────
// Connect the workspace's HubSpot or Follow Up Boss and sync leads into it.
// Writes are limited to the owner or a team admin (teamService access rules).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const crm = require('../services/crmService');

const router = express.Router();
router.use(requireAuth);

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e instanceof crm.CrmError) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

router.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await crm.listConnections(req.user.id) });
}));

router.post('/:provider/connect', wrap(async (req, res) => {
  const data = await crm.connect(req.user.id, req.params.provider, req.body?.credential);
  res.json({ success: true, data });
}));

router.patch('/:provider', wrap(async (req, res) => {
  res.json({ success: true, data: await crm.updateSettings(req.user.id, req.params.provider, req.body || {}) });
}));

router.delete('/:provider', wrap(async (req, res) => {
  await crm.disconnect(req.user.id, req.params.provider);
  res.json({ success: true });
}));

router.post('/:provider/backfill', wrap(async (req, res) => {
  const queued = await crm.backfill(req.user.id, req.params.provider);
  res.json({ success: true, queued });
}));

router.get('/:provider/status', wrap(async (req, res) => {
  res.json({ success: true, data: await crm.syncStats(req.user.id, req.params.provider) });
}));

module.exports = router;
