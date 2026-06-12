const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const vapiService = require('../services/vapiService');
const { callAnthropic } = require('../services/aiService');
const fraudGuard = require('../services/fraudGuard');
const router = express.Router();

const SCRIPT_MODEL = 'claude-haiku-4-5-20251001';

// GET /api/operator/voices — live Vapi voice catalog for the persona picker
router.get('/voices', requireAuth, async (req, res, next) => {
  try {
    const voices = await vapiService.getVapiVoices();
    res.json({ success: true, voices });
  } catch (err) { next(err); }
});

// GET /api/operator/profile
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, ai_caller_name, ai_voice_id, ai_personality_tone, ai_intro_script, ai_voicemail_script, ai_custom_instructions, legal_name, entity_name, entity_type, ein, re_license_number, re_license_state, business_phone, business_email, website, buyer_name_on_contract, earnest_money_default, closing_period_default, inspection_period_default, include_assignment_fee_disclosure, custom_contract_addendum, target_states, target_cities, property_types_preferred, min_property_value, max_property_value')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (err) { next(err); }
});

// PUT /api/operator/profile
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['full_name','company_name','phone','email_from_name','email_reply_to','ai_caller_name','ai_voice_id','ai_personality_tone','ai_intro_script','ai_voicemail_script','ai_custom_instructions','legal_name','entity_name','entity_type','ein','re_license_number','re_license_state','business_phone','business_email','website','buyer_name_on_contract','earnest_money_default','closing_period_default','inspection_period_default','include_assignment_fee_disclosure','custom_contract_addendum','target_states','target_cities','property_types_preferred','min_property_value','max_property_value'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    // Anti-fraud: if a custom script is being saved, scan it (flag-only — the
    // save still proceeds; compliance rules in the call prompt always override).
    let fraudWarning = null;
    if (typeof updates.ai_custom_instructions === 'string' && updates.ai_custom_instructions.trim()) {
      const verdict = await fraudGuard.scanAndLog(req.user.id, updates.ai_custom_instructions, 'profile_save');
      if (verdict.flagged) fraudWarning = verdict.reason;
    }

    const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, profile: data, fraud_warning: fraudWarning });
  } catch (err) { next(err); }
});

// POST /api/operator/generate-script — draft a custom AI speaking-style script
// from the operator's plain-English description. Does NOT save; the operator
// reviews/edits, then saves via PUT /profile. Output is fraud-scanned first.
router.post('/generate-script', requireAuth, async (req, res, next) => {
  try {
    const description = String(req.body.description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    if (description.length > 2000) return res.status(400).json({ error: 'description too long (max 2000 chars)' });

    const prompt = `You write custom speaking-style instructions for an AI voice agent that cold-calls property sellers on behalf of a real estate operator.

The operator describes the kind of leads they have and how they want the AI to talk to them. Turn that into clear, second-person instructions the AI will follow during the call.

OPERATOR'S DESCRIPTION:
"""
${description}
"""

RULES FOR WHAT YOU WRITE:
- Write practical guidance on tone, approach, pacing, what to emphasize, and how to handle this specific kind of lead.
- It must stay legal and compliant: the AI always discloses it is an AI when asked, always honors "remove me"/Do-Not-Call, never threatens, pressures, lies, or impersonates anyone.
- Do NOT write a word-for-word monologue; write reusable style/strategy instructions (5-12 short bullet-style lines).
- Plain text only. No markdown headers, no preamble, no quotes around the output. Just the instructions.`;

    const msg = await callAnthropic(
      { model: SCRIPT_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] },
      { label: 'generate-script' }
    );
    const script = (msg?.content?.[0]?.text || '').trim();

    // Scan the generated draft too (defense in depth — a crafted description
    // could try to coax non-compliant output). Flag-only.
    const verdict = await fraudGuard.scanAndLog(req.user.id, `${description}\n---\n${script}`, 'generate_script');

    res.json({ success: true, script, fraud_warning: verdict.flagged ? verdict.reason : null });
  } catch (err) { next(err); }
});

// GET /api/operator/bank-accounts
router.get('/bank-accounts', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('bank_accounts')
      .select('id, label, bank_name, account_holder_name, account_type, routing_last4, account_last4, bank_address, swift_code, additional_instructions, is_default')
      .eq('user_id', req.user.id)
      .order('is_default', { ascending: false });
    if (error) throw error;
    res.json({ success: true, accounts: data || [] });
  } catch (err) { next(err); }
});

// POST /api/operator/bank-accounts
router.post('/bank-accounts', requireAuth, async (req, res, next) => {
  try {
    const { label, bank_name, account_holder_name, account_type, routing_number, account_number, bank_address, swift_code, additional_instructions, is_default } = req.body;
    if (!bank_name || !account_holder_name) return res.status(400).json({ error: 'bank_name and account_holder_name required' });

    if (is_default) {
      await supabase.from('bank_accounts').update({ is_default: false }).eq('user_id', req.user.id);
    }

    const { data, error } = await supabase.from('bank_accounts').insert({
      user_id: req.user.id,
      label: label || 'Primary',
      bank_name,
      account_holder_name,
      account_type: account_type || 'Checking',
      routing_number_encrypted: routing_number ? `***${routing_number.slice(-4)}` : null,
      account_number_encrypted: account_number ? `***${account_number.slice(-4)}` : null,
      routing_last4: routing_number ? routing_number.slice(-4) : null,
      account_last4: account_number ? account_number.slice(-4) : null,
      bank_address,
      swift_code,
      additional_instructions,
      is_default: !!is_default,
    }).select('id, label, bank_name, account_holder_name, account_type, routing_last4, account_last4, is_default').single();

    if (error) throw error;
    res.status(201).json({ success: true, account: data });
  } catch (err) { next(err); }
});

// DELETE /api/operator/bank-accounts/:id
router.delete('/bank-accounts/:id', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase.from('bank_accounts').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/operator/preferences  — theme, dark mode, contextual tips
router.put('/preferences', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['theme', 'dark_mode', 'contextual_tips_enabled', 'notification_preferences', 'tfa_enabled'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select(
      'theme, dark_mode, contextual_tips_enabled, tfa_enabled'
    ).single();
    if (error) throw error;
    res.json({ success: true, preferences: data });
  } catch (err) { next(err); }
});

// GET /api/operator/preferences
router.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('users')
      .select('theme, dark_mode, contextual_tips_enabled, tfa_enabled, notification_preferences')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ success: true, preferences: data });
  } catch (err) { next(err); }
});

// GET /api/operator/activity  — real AI action log for Command Center
router.get('/activity', requireAuth, async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const { data, error } = await supabase.from('ai_command_log')
      .select('log_id, action_type, contact_name, message_sent, outcome, created_at, deal_id')
      .eq('operator_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (error) throw error;
    res.json({ success: true, activity: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
