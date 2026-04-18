const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { ariaChatbot } = require('../services/aiService');
const router = express.Router();

// POST /api/aria/chat — public Aria chatbot
router.post('/chat', optionalAuth, async (req, res, next) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const reply = await ariaChatbot(message, history);
    res.json({ success: true, reply });
  } catch (err) { next(err); }
});

module.exports = router;
