/**
 * Feature 17 - Live Caller ID Reputation Score
 * Routes: GET /api/caller-reputation, GET /api/caller-reputation/:phone,
 *         POST /api/caller-reputation/refresh, POST /api/caller-reputation/bulk-refresh
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// GET /api/caller-reputation - all tracked numbers for user
router.get('/', async (req, res) => {
  try {
    // Pull user's phone numbers from phones table
    const { data: phones, error: phoneErr } = await supabase
      .from('phones')
      .select('id, number, label, status, calls_made_today, total_calls')
      .eq('user_id', req.user.id);

    if (phoneErr) throw phoneErr;

    // Fetch or create reputation records
    const numbers = phones || [];
    const results = [];

    for (const p of numbers) {
      const { data: rep } = await supabase
        .from('caller_id_reputation')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('phone_number', p.number)
        .single();

      if (rep) {
        results.push({ ...p, reputation: rep });
      } else {
        // No data yet - seed with defaults
        const { data: newRep } = await supabase
          .from('caller_id_reputation')
          .insert({
            user_id:      req.user.id,
            phone_number: p.number,
            spam_score:   0,
            answer_rate:  0,
            total_calls:  p.total_calls || 0,
            flagged_spam: false,
          })
          .select().single();
        results.push({ ...p, reputation: newRep });
      }
    }

    res.json({ success: true, numbers: results });
  } catch (err) {
    console.error('[CallerRep] list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load reputation data' });
  }
});

// GET /api/caller-reputation/:phone - single number score
router.get('/:phone', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);

    // Pull call analytics for this phone from calls table
    const { data: callData } = await supabase
      .from('calls')
      .select('status, duration')
      .eq('user_id', req.user.id)
      .eq('from_number', phone)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

    const totalCalls    = callData?.length || 0;
    const answeredCalls = callData?.filter(c => ['completed', 'answered'].includes(c.status)).length || 0;
    const answerRate    = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    // Score: answer rate <20% with >20 calls = likely flagged as spam
    const spamScore = totalCalls >= 20 && answerRate < 20
      ? Math.min(100, Math.round((1 - answerRate / 100) * 80 + 20))
      : totalCalls >= 10 && answerRate < 30
      ? Math.round((1 - answerRate / 100) * 50)
      : 0;

    const flaggedSpam = spamScore >= 60;

    // Upsert reputation record
    const { data: rep, error } = await supabase
      .from('caller_id_reputation')
      .upsert({
        user_id:       req.user.id,
        phone_number:  phone,
        spam_score:    spamScore,
        answer_rate:   answerRate,
        total_calls:   totalCalls,
        answered_calls: answeredCalls,
        flagged_spam:  flaggedSpam,
        last_checked:  new Date().toISOString(),
      }, { onConflict: 'user_id,phone_number' })
      .select().single();

    if (error) throw error;

    res.json({
      success: true,
      reputation: rep,
      recommendation: flaggedSpam
        ? '🚨 This number may be flagged as spam. Rotate to a fresh number.'
        : spamScore >= 40
        ? '⚠️ Reputation degrading. Monitor closely and consider rotation.'
        : '✅ Number looks healthy. Keep calling.',
    });
  } catch (err) {
    console.error('[CallerRep] single error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load reputation' });
  }
});

// POST /api/caller-reputation/refresh - refresh all user's numbers
router.post('/refresh', async (req, res) => {
  try {
    const { data: phones } = await supabase
      .from('phones')
      .select('number')
      .eq('user_id', req.user.id);

    const updated = [];
    for (const p of phones || []) {
      const { data: callData } = await supabase
        .from('calls')
        .select('status')
        .eq('user_id', req.user.id)
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

      const total    = callData?.length || 0;
      const answered = callData?.filter(c => ['completed', 'answered'].includes(c.status)).length || 0;
      const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;
      const spamScore  = total >= 20 && answerRate < 20 ? Math.min(100, Math.round((1 - answerRate / 100) * 80 + 20)) : 0;

      const { data: rep } = await supabase
        .from('caller_id_reputation')
        .upsert({
          user_id: req.user.id, phone_number: p.number,
          spam_score: spamScore, answer_rate: answerRate,
          total_calls: total, answered_calls: answered,
          flagged_spam: spamScore >= 60,
          last_checked: new Date().toISOString(),
        }, { onConflict: 'user_id,phone_number' })
        .select().single();

      if (rep) updated.push(rep);
    }

    res.json({ success: true, updated: updated.length, numbers: updated });
  } catch (err) {
    console.error('[CallerRep] refresh error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to refresh reputation' });
  }
});

module.exports = router;
