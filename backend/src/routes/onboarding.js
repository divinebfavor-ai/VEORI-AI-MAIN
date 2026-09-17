// GET /api/onboarding - setup checklist for this workspace; POST /dismiss hides it.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const onboarding = require('../services/onboardingService');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const data = await onboarding.getStatus(req.user.id);
    if (!data) return res.status(404).json({ success: false, error: 'Account not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post('/dismiss', async (req, res, next) => {
  try {
    await onboarding.dismiss(req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
