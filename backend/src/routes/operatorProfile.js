const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/operator/profile
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, ai_caller_name, ai_voice_id, ai_personality_tone, ai_intro_script, ai_voicemail_script, legal_name, entity_name, entity_type, ein, re_license_number, re_license_state, business_phone, business_email, website, buyer_name_on_contract, earnest_money_default, closing_period_default, inspection_period_default, include_assignment_fee_disclosure, custom_contract_addendum, target_states, target_cities, property_types_preferred, min_property_value, max_property_value')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (err) { next(err); }
});

// PUT /api/operator/profile
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['full_name','company_name','phone','ai_caller_name','ai_voice_id','ai_personality_tone','ai_intro_script','ai_voicemail_script','legal_name','entity_name','entity_type','ein','re_license_number','re_license_state','business_phone','business_email','website','buyer_name_on_contract','earnest_money_default','closing_period_default','inspection_period_default','include_assignment_fee_disclosure','custom_contract_addendum','target_states','target_cities','property_types_preferred','min_property_value','max_property_value'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, profile: data });
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

module.exports = router;
