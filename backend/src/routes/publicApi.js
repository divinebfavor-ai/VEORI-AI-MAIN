// ─── Public REST API v1 ──────────────────────────────────────────────────────
// Authenticated with an operator API key (see services/apiKeyService.js). Every
// query is scoped to that key's operator. Errors: { error: { code, message } }.
// The machine-readable contract is GET /api/v1/openapi.json.

const express = require('express');
const supabase = require('../config/supabase');
const { requireApiKey, requireScope, apiKeyRateLimit } = require('../middleware/apiKeyAuth');
const { toE164 } = require('../utils/phone');
const { normalizeBuyer } = require('../utils/buyerFields');
const webhooks = require('../services/webhookService');
const recordingStorage = require('../services/recordingStorage');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATE_RE = /^[A-Z]{2}$/;

const LEAD_FIELDS = 'id, first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, source, status, pipeline_stage, motivation_score, is_on_dnc, consent, consent_source, consent_at, primary_tag, last_call_date, last_call_outcome, notes, tags, created_at, updated_at';
const DEAL_FIELDS = 'id, lead_id, status, stage_changed_at, property_address, property_city, property_state, property_zip, arv, repair_estimate, mao, offer_price, seller_agreed_price, buyer_price, assignment_fee, buyer_id, contract_status, closing_date, emd_status, emd_amount, deal_type, created_at, updated_at';
const BUYER_FIELDS = 'id, name, phone, email, buyer_type, buy_box_states, buy_box_types, property_cities, buy_box_zips, min_price, max_price, repair_tolerance, cash_only, proof_of_funds, is_active, notes, created_at';
const CALL_FIELDS = 'id, lead_id, direction, status, duration_seconds, outcome, motivation_score, ai_summary, key_signals, objections, offer_made, started_at, ended_at, created_at';

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

function paging(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { limit, page, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
}

function sinceFilter(req) {
  if (req.query.updated_since === undefined) return { ok: true, value: null };
  const d = new Date(String(req.query.updated_since));
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

function listResponse(res, { data, count, limit, page }) {
  res.json({ data: data || [], page, limit, total: count ?? null, has_more: count != null ? page * limit < count : (data || []).length === limit });
}

function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      if (e && e.status && e.status < 500) return fail(res, e.status, 'invalid_request', e.message);
      console.error('[PublicAPI]', req.method, req.path, e.message);
      fail(res, 500, 'internal_error', 'Something went wrong. Try again.');
    }
  };
}

// ── Spec (no key required) ────────────────────────────────────────────────────
router.get('/openapi.json', (_req, res) => res.json(require('../docs/openapi')));

// Anything below needs a valid key; the per-key limit counts after authentication.
router.use(requireApiKey, apiKeyRateLimit);

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', requireScope('leads:read'), wrap(async (req, res) => {
  const p = paging(req);
  const since = sinceFilter(req);
  if (!since.ok) return fail(res, 400, 'invalid_request', 'updated_since must be an ISO 8601 date');
  let q = supabase.from('leads').select(LEAD_FIELDS, { count: 'exact' })
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).range(p.from, p.to);
  if (req.query.status) q = q.eq('status', String(req.query.status).slice(0, 50));
  if (since.value) q = q.gte('updated_at', since.value);
  if (req.query.phone) {
    const phone = toE164(req.query.phone);
    if (!phone) return fail(res, 400, 'invalid_request', 'phone must be a valid US number');
    q = q.eq('phone', phone);
  }
  const { data, error, count } = await q;
  if (error) throw error;
  listResponse(res, { data, count, ...p });
}));

router.get('/leads/:id', requireScope('leads:read'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Lead not found');
  const { data, error } = await supabase.from('leads').select(LEAD_FIELDS)
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'not_found', 'Lead not found');
  res.json({ data });
}));

function leadInput(body, { partial }) {
  const out = {};
  const errors = [];
  const str = (k, max) => {
    if (body[k] === undefined) return;
    if (body[k] !== null && typeof body[k] !== 'string') { errors.push(`${k} must be a string`); return; }
    out[k] = body[k] == null ? null : body[k].trim().slice(0, max) || null;
  };
  ['first_name', 'last_name'].forEach(k => str(k, 100));
  ['property_address', 'property_city'].forEach(k => str(k, 200));
  str('property_type', 50); str('source', 100); str('notes', 5000);
  if (body.property_state !== undefined) {
    const st = String(body.property_state || '').trim().toUpperCase();
    if (st && !STATE_RE.test(st)) errors.push('property_state must be a 2-letter code');
    else out.property_state = st || null;
  }
  if (body.property_zip !== undefined) {
    const z = String(body.property_zip || '').trim();
    if (z && !/^\d{5}(-\d{4})?$/.test(z)) errors.push('property_zip must be a 5-digit zip');
    else out.property_zip = z || null;
  }
  if (body.email !== undefined) {
    const e = String(body.email || '').trim().toLowerCase();
    if (e && !EMAIL_RE.test(e)) errors.push('email is not valid');
    else out.email = e || null;
  }
  for (const k of ['estimated_value', 'estimated_equity']) {
    if (body[k] === undefined) continue;
    if (body[k] === null) { out[k] = null; continue; }
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0) errors.push(`${k} must be a positive number`);
    else out[k] = n;
  }
  if (!partial || body.phone !== undefined) {
    const phone = toE164(body.phone);
    if (!phone) errors.push('phone must be a valid 10-digit US number');
    else out.phone = phone;
  }
  return { out, errors };
}

router.post('/leads', requireScope('leads:write'), wrap(async (req, res) => {
  const body = req.body || {};
  const { out, errors } = leadInput(body, { partial: false });
  if (body.sms_consent !== undefined && typeof body.sms_consent !== 'boolean') errors.push('sms_consent must be true or false');
  if (errors.length) return fail(res, 400, 'invalid_request', errors.join('; '));

  const { data: existing } = await supabase.from('leads').select('id')
    .eq('user_id', req.user.id).eq('phone', out.phone).limit(1);
  if ((existing || []).length) {
    return res.status(409).json({ error: { code: 'duplicate', message: 'A lead with this phone already exists', lead_id: existing[0].id } });
  }

  const isOnDnc = await require('../services/dncCheck').isOnInternalDnc(out.phone);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('leads').insert({
    ...out,
    user_id: req.user.id,
    source: out.source || 'api',
    status: isOnDnc ? 'dnc' : 'new',
    is_on_dnc: isOnDnc,
    ...(body.sms_consent === true ? { consent: true, consent_source: 'api_attestation', consent_at: now } : {}),
  }).select(LEAD_FIELDS).single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'duplicate', 'A lead with this phone already exists');
    throw error;
  }
  webhooks.emitEvent(req.user.id, 'lead.created', { lead: data, via: 'api' });
  res.status(201).json({ data });
}));

router.patch('/leads/:id', requireScope('leads:write'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Lead not found');
  const { out, errors } = leadInput(req.body || {}, { partial: true });
  if (errors.length) return fail(res, 400, 'invalid_request', errors.join('; '));
  if (!Object.keys(out).length) return fail(res, 400, 'invalid_request', 'No updatable fields sent');
  const { data, error } = await supabase.from('leads').update({ ...out, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('user_id', req.user.id).select(LEAD_FIELDS).maybeSingle();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'duplicate', 'Another lead already has this phone');
    throw error;
  }
  if (!data) return fail(res, 404, 'not_found', 'Lead not found');
  res.json({ data });
}));

// ── Deals ─────────────────────────────────────────────────────────────────────
router.get('/deals', requireScope('deals:read'), wrap(async (req, res) => {
  const p = paging(req);
  const since = sinceFilter(req);
  if (!since.ok) return fail(res, 400, 'invalid_request', 'updated_since must be an ISO 8601 date');
  let q = supabase.from('deals').select(DEAL_FIELDS, { count: 'exact' })
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).range(p.from, p.to);
  if (req.query.status) q = q.eq('status', String(req.query.status).slice(0, 50));
  if (since.value) q = q.gte('updated_at', since.value);
  const { data, error, count } = await q;
  if (error) throw error;
  listResponse(res, { data, count, ...p });
}));

router.get('/deals/:id', requireScope('deals:read'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Deal not found');
  const { data, error } = await supabase.from('deals').select(DEAL_FIELDS)
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'not_found', 'Deal not found');
  res.json({ data });
}));

router.post('/deals/:id/stage', requireScope('deals:write'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Deal not found');
  const { changeDealStage, StageError } = require('../services/dealStageService');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null;
  try {
    const { deal, changed, from } = await changeDealStage({
      dealId: req.params.id, userId: req.user.id, stage: req.body?.stage, actor: 'api', reason,
    });
    const picked = {};
    DEAL_FIELDS.split(', ').forEach(k => { picked[k] = deal[k]; });
    res.json({ data: picked, changed, from });
  } catch (e) {
    if (e instanceof StageError) return fail(res, e.status, e.status === 404 ? 'not_found' : 'invalid_request', e.message);
    throw e;
  }
}));

// ── Buyers ────────────────────────────────────────────────────────────────────
router.get('/buyers', requireScope('buyers:read'), wrap(async (req, res) => {
  const p = paging(req);
  let q = supabase.from('buyers').select(BUYER_FIELDS, { count: 'exact' })
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).range(p.from, p.to);
  if (req.query.state) q = q.contains('buy_box_states', [String(req.query.state).toUpperCase().slice(0, 2)]);
  const { data, error, count } = await q;
  if (error) throw error;
  listResponse(res, { data, count, ...p });
}));

router.post('/buyers', requireScope('buyers:write'), wrap(async (req, res) => {
  const { row, errors } = normalizeBuyer({ repair_tolerance: 'any', ...(req.body || {}) });
  if (errors.length) return fail(res, 400, 'invalid_request', errors.join('; '));
  const record = { ...row, user_id: req.user.id, source: 'api' };
  const query = record.phone
    ? supabase.from('buyers').upsert(record, { onConflict: 'user_id,phone' })
    : supabase.from('buyers').insert([record]);
  const { data, error } = await query.select(BUYER_FIELDS).single();
  if (error) throw error;
  res.status(201).json({ data });
}));

// ── Calls ─────────────────────────────────────────────────────────────────────
router.get('/calls', requireScope('calls:read'), wrap(async (req, res) => {
  const p = paging(req);
  let q = supabase.from('calls').select(CALL_FIELDS, { count: 'exact' })
    .eq('user_id', req.user.id).order('created_at', { ascending: false }).range(p.from, p.to);
  if (req.query.lead_id) {
    if (!UUID_RE.test(String(req.query.lead_id))) return fail(res, 400, 'invalid_request', 'lead_id must be a UUID');
    q = q.eq('lead_id', String(req.query.lead_id));
  }
  const { data, error, count } = await q;
  if (error) throw error;
  listResponse(res, { data, count, ...p });
}));

router.get('/calls/:id', requireScope('calls:read'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Call not found');
  const { data, error } = await supabase.from('calls').select(`${CALL_FIELDS}, transcript, recording_url`)
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return fail(res, 404, 'not_found', 'Call not found');
  // Recordings are private: hand out a link that expires in an hour.
  data.recording_url = await recordingStorage.playableUrl(data.recording_url);
  res.json({ data });
}));

// ── Webhooks ──────────────────────────────────────────────────────────────────
router.get('/events', (_req, res) => {
  res.json({ data: Object.entries(webhooks.EVENTS).map(([name, description]) => ({ name, description })) });
});

router.get('/webhooks', requireScope('webhooks:manage'), wrap(async (req, res) => {
  res.json({ data: await webhooks.listEndpoints(req.user.id) });
}));

router.post('/webhooks', requireScope('webhooks:manage'), wrap(async (req, res) => {
  const { endpoint, secret } = await webhooks.createEndpoint(req.user.id, req.body || {});
  res.status(201).json({ data: endpoint, secret });
}));

router.patch('/webhooks/:id', requireScope('webhooks:manage'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Webhook endpoint not found');
  res.json({ data: await webhooks.updateEndpoint(req.user.id, req.params.id, req.body || {}) });
}));

router.delete('/webhooks/:id', requireScope('webhooks:manage'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Webhook endpoint not found');
  await webhooks.deleteEndpoint(req.user.id, req.params.id);
  res.status(204).end();
}));

router.get('/webhooks/:id/deliveries', requireScope('webhooks:manage'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Webhook endpoint not found');
  res.json({ data: await webhooks.listDeliveries(req.user.id, req.params.id, parseInt(req.query.limit, 10) || 50) });
}));

router.post('/webhooks/:id/test', requireScope('webhooks:manage'), wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return fail(res, 404, 'not_found', 'Webhook endpoint not found');
  res.json({ data: await webhooks.sendTestEvent(req.user.id, req.params.id) });
}));

router.use((req, res) => fail(res, 404, 'not_found', `No endpoint ${req.method} ${req.baseUrl}${req.path}`));

module.exports = router;
