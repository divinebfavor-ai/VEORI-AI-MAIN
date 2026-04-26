const express  = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

// POST /api/waitlist/veori-credits
router.post('/veori-credits', async (req, res, next) => {
  try {
    const { name, email, investment_range, preferred_property_types, preferred_states } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, error: 'name and email required' });

    const { data, error } = await supabase.from('veori_credits_waitlist').upsert({
      name,
      email: email.toLowerCase().trim(),
      investment_range: investment_range || null,
      preferred_property_types: preferred_property_types || null,
      preferred_states: preferred_states || null,
      signed_up_at: new Date().toISOString(),
    }, { onConflict: 'email' }).select().single();

    if (error && error.code !== '23505') throw error;

    const { count } = await supabase.from('veori_credits_waitlist').select('*', { count: 'exact', head: true });

    res.json({ success: true, message: 'You are on the waitlist!', waitlist_count: count || 0 });
  } catch (err) { next(err); }
});

// GET /api/waitlist/count
router.get('/count', async (req, res, next) => {
  try {
    const { count, error } = await supabase.from('veori_credits_waitlist').select('*', { count: 'exact', head: true });
    if (error) throw error;
    res.json({ success: true, count: count || 0 });
  } catch (err) { next(err); }
});

module.exports = router;
