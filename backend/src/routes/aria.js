const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { ariaChatbot } = require('../services/aiService');
const router = express.Router();

// POST /api/aria/chat - public Aria chatbot
// Daily usage cushion on the shared AI credits: logged-in users get a full allowance
// (per user), anonymous visitors a small per-IP one (so a bot on the public site can't
// drain the credits every paying operator depends on).
router.post('/chat', optionalAuth, async (req, res, next) => {
  try {
    const { message, history = [] } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
    if (message.length > 2000) return res.status(400).json({ error: 'message must be 2000 characters or fewer' });
    if (!Array.isArray(history) || history.length > 30 || JSON.stringify(history).length > 30000) {
      return res.status(400).json({ error: 'history must be a list of at most 30 recent messages' });
    }

    const { checkAndConsume, LIMITS } = require('../services/usageLimitService');
    const key      = req.user?.id || `ip:${req.ip || req.headers['x-forwarded-for'] || 'unknown'}`;
    const ceiling  = req.user?.id ? LIMITS.aria_chat : LIMITS.aria_chat_anon;
    const quota    = await checkAndConsume(key, 'aria_chat', ceiling);
    if (!quota.allowed) {
      return res.status(429).json({
        success: false,
        error: req.user?.id
          ? `You've reached today's Aria limit (${quota.limit} messages). It resets at midnight UTC.`
          : 'Daily chat limit reached. Sign in to continue the conversation with a bigger allowance.',
      });
    }

    // Only plain user/assistant turns reach the model.
    const cleanHistory = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    const reply = await ariaChatbot(message, cleanHistory);
    res.json({ success: true, reply, quota: { used: quota.used, limit: quota.limit } });
  } catch (err) { next(err); }
});

module.exports = router;
