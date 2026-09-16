// ─── Team management ─────────────────────────────────────────────────────────
// Owner/admin: invite, change roles, remove. Anyone signed in: see their team,
// accept an invite, leave a team. Rules live in services/teamService.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const team = require('../services/teamService');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e instanceof team.TeamError) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

router.get('/', wrap(async (req, res) => {
  res.json({ success: true, data: await team.listTeam(req.user) });
}));

router.post('/invites', wrap(async (req, res) => {
  const result = await team.invite(req.user, { email: req.body?.email, role: req.body?.role });
  res.status(201).json({ success: true, data: result });
}));

router.post('/accept', wrap(async (req, res) => {
  const membership = await team.accept(req.user, req.body?.token);
  res.json({ success: true, data: { owner_id: membership.owner_id, role: membership.role } });
}));

router.patch('/members/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Team member not found' });
  await team.changeRole(req.user, req.params.id, req.body?.role);
  res.json({ success: true });
}));

router.delete('/members/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Team member not found' });
  await team.remove(req.user, req.params.id);
  res.json({ success: true });
}));

router.post('/leave', wrap(async (req, res) => {
  if (req.user.teamRole === 'owner' || !req.user.teamMembershipId) {
    return res.status(400).json({ success: false, error: 'You are not a member of another team' });
  }
  await team.remove(req.user, req.user.teamMembershipId);
  res.json({ success: true });
}));

module.exports = router;
