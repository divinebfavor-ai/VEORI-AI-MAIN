/**
 * /api/lead-memory
 * AI Conversation Memory — persistent per-lead call history
 * NEW FILE — does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

// GET /api/lead-memory/:leadId — full conversation history for a lead
router.get('/:leadId', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('conversation_memory')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, history: [] });
      throw error;
    }
    res.json({ success: true, history: data || [] });
  } catch (err) { next(err); }
});

// GET /api/lead-memory/:leadId/prompt-context
// Returns a formatted string ready to inject into the next call prompt
router.get('/:leadId/prompt-context', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('conversation_memory')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(5); // last 5 interactions

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, context: '' });
      throw error;
    }

    if (!data || data.length === 0) {
      return res.json({ success: true, context: '', callCount: 0 });
    }

    // Build context string for the AI prompt
    const lines = ['=== PREVIOUS CALL HISTORY (most recent first) ==='];
    data.forEach((m, i) => {
      const date = new Date(m.created_at).toLocaleDateString();
      lines.push(`\nCall ${i + 1} — ${date}`);
      lines.push(`Outcome: ${m.call_outcome || 'unknown'} | Motivation: ${m.motivation_score || '?'}/100 | Sentiment: ${m.sentiment || 'unknown'}`);
      if (m.key_statements?.length) lines.push(`Key statements: ${m.key_statements.join('; ')}`);
      if (m.objections?.length) lines.push(`Objections raised: ${m.objections.join('; ')}`);
    });
    lines.push('\n=== END CALL HISTORY ===');

    res.json({ success: true, context: lines.join('\n'), callCount: data.length });
  } catch (err) { next(err); }
});

// POST /api/lead-memory — save a new memory entry after a call
router.post('/', async (req, res, next) => {
  try {
    const {
      lead_id, call_id, transcript, motivation_score, sentiment,
      key_statements, objections, follow_up_date, call_outcome,
    } = req.body;

    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    const { data, error } = await supabase.from('conversation_memory').insert({
      lead_id,
      user_id:         req.user.id,
      call_id:         call_id || null,
      transcript:      transcript || null,
      motivation_score: motivation_score || null,
      sentiment:       sentiment || null,
      key_statements:  key_statements || [],
      objections:      objections || [],
      follow_up_date:  follow_up_date || null,
      call_outcome:    call_outcome || null,
    }).select().single();

    if (error) {
      if (tableMissing(error)) return res.status(503).json({ success: false, error: 'Run migrations first — table conversation_memory not found' });
      throw error;
    }
    res.status(201).json({ success: true, memory: data });
  } catch (err) { next(err); }
});

// POST /api/lead-memory/auto-extract
// Given a call transcript + call_id, auto-extract and store memory using simple heuristics
router.post('/auto-extract', async (req, res, next) => {
  try {
    const { lead_id, call_id, transcript, motivation_score, sentiment } = req.body;
    if (!lead_id || !transcript) return res.status(400).json({ success: false, error: 'lead_id and transcript required' });

    // Simple heuristic extraction — key phrases that indicate seller statements
    const lines = transcript.split('\n').filter(l => l.toLowerCase().startsWith('seller:'));
    const sellerText = lines.map(l => l.replace(/^seller:\s*/i, '').trim());

    const objectionKeywords = ['not interested', 'too low', 'listed', 'agent', 'not ready', "don't want", 'no thanks', 'stop calling'];
    const motivationKeywords = ['need to sell', 'want to sell', 'moving', 'divorce', 'foreclosure', 'behind', 'inherited', 'cash'];

    const key_statements = sellerText.filter(s =>
      motivationKeywords.some(kw => s.toLowerCase().includes(kw))
    ).slice(0, 5);

    const objections = sellerText.filter(s =>
      objectionKeywords.some(kw => s.toLowerCase().includes(kw))
    ).slice(0, 5);

    const call_outcome = transcript.toLowerCase().includes('voicemail') ? 'voicemail'
      : transcript.toLowerCase().includes('no answer') ? 'no_answer'
      : sellerText.length > 2 ? 'answered'
      : 'unknown';

    const { data, error } = await supabase.from('conversation_memory').insert({
      lead_id,
      user_id:         req.user.id,
      call_id:         call_id || null,
      transcript,
      motivation_score: motivation_score || null,
      sentiment:       sentiment || null,
      key_statements,
      objections,
      call_outcome,
    }).select().single();

    if (error) {
      if (tableMissing(error)) return res.status(503).json({ success: false, error: 'Run migrations first' });
      throw error;
    }
    res.status(201).json({ success: true, memory: data, extracted: { key_statements, objections, call_outcome } });
  } catch (err) { next(err); }
});

module.exports = router;
