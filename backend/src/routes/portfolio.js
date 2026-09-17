// ─── Portfolio API ───────────────────────────────────────────────────────────
// Owned properties, units, leases and the money ledger. Every query is scoped to
// req.user.id, and every id that arrives in a request body is proven to belong to
// this workspace before it is used (the backend runs as service role, which
// bypasses RLS).

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const portfolio = require('../services/portfolioService');
const { owns, UUID_RE } = require('../utils/ownership');

const router = express.Router();
router.use(requireAuth);

const STRATEGIES = ['rental', 'flip', 'brrrr', 'short_term', 'land', 'commercial', 'other'];
const STATUSES = ['owned', 'under_rehab', 'listed', 'sold'];
const LEASE_STATUSES = ['active', 'pending', 'ended'];

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e.status && e.status < 500) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}
const bad = (res, msg) => res.status(400).json({ success: false, error: msg });

function money(v, field) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw Object.assign(new Error(`${field} must be a positive amount`), { status: 400 });
  return n;
}
function date(v, field) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw Object.assign(new Error(`${field} must be a date (YYYY-MM-DD)`), { status: 400 });
  return String(v);
}
const text = (v, max = 200) => (v === undefined || v === null ? null : String(v).slice(0, max));

// Only a property this workspace owns can be addressed.
async function ownProperty(req, id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const { data, error } = await supabase.from('portfolio_properties').select('*').eq('id', id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── Overview ────────────────────────────────────────────────────────────────
router.get('/summary', wrap(async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 36);
  res.json({ success: true, data: await portfolio.summary(req.user.id, { months }) });
}));

router.get('/cash-flow', wrap(async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 36);
  const propertyId = req.query.property_id && UUID_RE.test(req.query.property_id) ? req.query.property_id : null;
  if (propertyId && !(await ownProperty(req, propertyId))) return res.status(404).json({ success: false, error: 'Property not found' });
  res.json({ success: true, data: await portfolio.cashFlowSeries(req.user.id, { propertyId, months }) });
}));

router.get('/expiring-leases', wrap(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 365);
  res.json({ success: true, data: await portfolio.expiringLeases(req.user.id, days) });
}));

router.get('/categories', (_req, res) => res.json({
  success: true,
  data: { income: portfolio.INCOME_CATEGORIES, expense: portfolio.EXPENSE_CATEGORIES, non_operating: [...portfolio.NON_OPERATING] },
}));

// ── Properties ──────────────────────────────────────────────────────────────
router.get('/properties', wrap(async (req, res) => {
  let q = supabase.from('portfolio_properties').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(500);
  if (req.query.status && STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

router.get('/properties/:id', wrap(async (req, res) => {
  const property = await ownProperty(req, req.params.id);
  if (!property) return res.status(404).json({ success: false, error: 'Property not found' });
  const [units, leases, tx] = await Promise.all([
    supabase.from('portfolio_units').select('*').eq('property_id', property.id).eq('user_id', req.user.id).order('label'),
    supabase.from('portfolio_leases').select('*').eq('property_id', property.id).eq('user_id', req.user.id).order('start_date', { ascending: false }),
    supabase.from('portfolio_transactions').select('*').eq('property_id', property.id).eq('user_id', req.user.id).order('occurred_on', { ascending: false }).limit(300),
  ]);
  for (const r of [units, leases, tx]) if (r.error) throw r.error;
  const metrics = portfolio.propertyMetrics(property, leases.data || [], tx.data || [], 12);
  res.json({ success: true, data: { property, units: units.data || [], leases: leases.data || [], transactions: tx.data || [], metrics } });
}));

const PROPERTY_FIELDS = ['address', 'city', 'state', 'zip', 'property_type', 'notes', 'value_source'];
const PROPERTY_MONEY = ['purchase_price', 'rehab_cost', 'closing_costs', 'current_value', 'loan_balance', 'loan_payment', 'loan_escrow_monthly', 'annual_taxes', 'annual_insurance', 'monthly_hoa', 'sold_price'];
const PROPERTY_DATES = ['purchase_date', 'value_as_of', 'sold_date'];

function propertyPayload(body) {
  const row = {};
  for (const f of PROPERTY_FIELDS) if (body[f] !== undefined) row[f] = text(body[f], f === 'notes' ? 4000 : 200);
  for (const f of PROPERTY_MONEY) if (body[f] !== undefined) row[f] = money(body[f], f);
  for (const f of PROPERTY_DATES) if (body[f] !== undefined) row[f] = date(body[f], f);
  if (body.units_count !== undefined) {
    const n = parseInt(body.units_count, 10);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw Object.assign(new Error('units_count must be between 1 and 500'), { status: 400 });
    row.units_count = n;
  }
  if (body.strategy !== undefined) {
    if (!STRATEGIES.includes(body.strategy)) throw Object.assign(new Error(`strategy must be one of ${STRATEGIES.join(', ')}`), { status: 400 });
    row.strategy = body.strategy;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw Object.assign(new Error(`status must be one of ${STATUSES.join(', ')}`), { status: 400 });
    row.status = body.status;
  }
  if (body.loan_rate_pct !== undefined) {
    const n = Number(body.loan_rate_pct);
    if (body.loan_rate_pct !== null && body.loan_rate_pct !== '' && (!Number.isFinite(n) || n < 0 || n > 100)) throw Object.assign(new Error('loan_rate_pct must be between 0 and 100'), { status: 400 });
    row.loan_rate_pct = body.loan_rate_pct === '' || body.loan_rate_pct === null ? null : n;
  }
  return row;
}

router.post('/properties', wrap(async (req, res) => {
  const body = req.body || {};
  if (!body.address || !String(body.address).trim()) return bad(res, 'address is required');
  const row = propertyPayload(body);
  // A property may be linked to a deal or lead, but only this workspace's own.
  for (const [field, table] of [['deal_id', 'deals'], ['lead_id', 'leads']]) {
    if (body[field]) {
      if (!(await owns(req.user.id, table, body[field]))) return res.status(404).json({ success: false, error: `${table === 'deals' ? 'Deal' : 'Lead'} not found` });
      row[field] = body[field];
    }
  }
  const { data, error } = await supabase.from('portfolio_properties').insert({ user_id: req.user.id, ...row }).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

router.patch('/properties/:id', wrap(async (req, res) => {
  if (!(await ownProperty(req, req.params.id))) return res.status(404).json({ success: false, error: 'Property not found' });
  const row = propertyPayload(req.body || {});
  if (!Object.keys(row).length) return bad(res, 'Nothing to update');
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('portfolio_properties').update(row).eq('id', req.params.id).eq('user_id', req.user.id).select('*').single();
  if (error) throw error;
  res.json({ success: true, data });
}));

router.delete('/properties/:id', wrap(async (req, res) => {
  if (!(await ownProperty(req, req.params.id))) return res.status(404).json({ success: false, error: 'Property not found' });
  const { error } = await supabase.from('portfolio_properties').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) throw error;
  res.json({ success: true });
}));

// Add a closed deal to the portfolio, carrying its numbers across.
router.post('/from-deal/:dealId', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.dealId)) return res.status(404).json({ success: false, error: 'Deal not found' });
  res.status(201).json({ success: true, data: await portfolio.fromDeal(req.user.id, req.params.dealId) });
}));

// ── Units ───────────────────────────────────────────────────────────────────
router.post('/properties/:id/units', wrap(async (req, res) => {
  if (!(await ownProperty(req, req.params.id))) return res.status(404).json({ success: false, error: 'Property not found' });
  const b = req.body || {};
  if (!b.label || !String(b.label).trim()) return bad(res, 'label is required');
  const row = {
    user_id: req.user.id, property_id: req.params.id, label: text(b.label, 60),
    beds: money(b.beds, 'beds'), baths: money(b.baths, 'baths'),
    sqft: b.sqft === undefined || b.sqft === null || b.sqft === '' ? null : parseInt(b.sqft, 10) || null,
    market_rent: money(b.market_rent, 'market_rent'),
  };
  const { data, error } = await supabase.from('portfolio_units').insert(row).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

router.delete('/units/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Unit not found' });
  const { data, error } = await supabase.from('portfolio_units').delete().eq('id', req.params.id).eq('user_id', req.user.id).select('id');
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ success: false, error: 'Unit not found' });
  res.json({ success: true });
}));

// ── Leases ──────────────────────────────────────────────────────────────────
router.get('/leases', wrap(async (req, res) => {
  let q = supabase.from('portfolio_leases').select('*').eq('user_id', req.user.id).order('end_date', { ascending: true }).limit(500);
  if (req.query.status && LEASE_STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

async function leasePayload(req, body, propertyId) {
  const row = {};
  for (const f of ['tenant_name', 'tenant_phone', 'tenant_email', 'notes']) if (body[f] !== undefined) row[f] = text(body[f], f === 'notes' ? 2000 : 120);
  for (const f of ['start_date', 'end_date']) if (body[f] !== undefined) row[f] = date(body[f], f);
  for (const f of ['monthly_rent', 'deposit']) if (body[f] !== undefined) row[f] = money(body[f], f);
  if (body.status !== undefined) {
    if (!LEASE_STATUSES.includes(body.status)) throw Object.assign(new Error(`status must be one of ${LEASE_STATUSES.join(', ')}`), { status: 400 });
    row.status = body.status;
  }
  if (body.unit_id) {
    const { data } = await supabase.from('portfolio_units').select('id').eq('id', body.unit_id).eq('user_id', req.user.id).eq('property_id', propertyId).maybeSingle();
    if (!data) throw Object.assign(new Error('Unit not found'), { status: 404 });
    row.unit_id = body.unit_id;
  }
  if (row.start_date && row.end_date && row.end_date < row.start_date) throw Object.assign(new Error('end_date cannot be before start_date'), { status: 400 });
  return row;
}

router.post('/properties/:id/leases', wrap(async (req, res) => {
  if (!(await ownProperty(req, req.params.id))) return res.status(404).json({ success: false, error: 'Property not found' });
  const row = await leasePayload(req, req.body || {}, req.params.id);
  const { data, error } = await supabase.from('portfolio_leases')
    .insert({ user_id: req.user.id, property_id: req.params.id, status: row.status || 'active', ...row }).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

router.patch('/leases/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Lease not found' });
  const { data: lease } = await supabase.from('portfolio_leases').select('id, property_id').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!lease) return res.status(404).json({ success: false, error: 'Lease not found' });
  const row = await leasePayload(req, req.body || {}, lease.property_id);
  if (!Object.keys(row).length) return bad(res, 'Nothing to update');
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('portfolio_leases').update(row).eq('id', req.params.id).eq('user_id', req.user.id).select('*').single();
  if (error) throw error;
  res.json({ success: true, data });
}));

// ── Money ledger ────────────────────────────────────────────────────────────
router.get('/transactions', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  let q = supabase.from('portfolio_transactions').select('*').eq('user_id', req.user.id).order('occurred_on', { ascending: false }).limit(limit);
  if (req.query.property_id && UUID_RE.test(req.query.property_id)) q = q.eq('property_id', req.query.property_id);
  if (req.query.direction === 'income' || req.query.direction === 'expense') q = q.eq('direction', req.query.direction);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

router.post('/properties/:id/transactions', wrap(async (req, res) => {
  if (!(await ownProperty(req, req.params.id))) return res.status(404).json({ success: false, error: 'Property not found' });
  const b = req.body || {};
  if (b.direction !== 'income' && b.direction !== 'expense') return bad(res, 'direction must be income or expense');
  const amount = money(b.amount, 'amount');
  if (amount === null) return bad(res, 'amount is required');
  const occurred = date(b.occurred_on, 'occurred_on') || new Date().toISOString().slice(0, 10);
  const allowed = b.direction === 'income' ? portfolio.INCOME_CATEGORIES : portfolio.EXPENSE_CATEGORIES;
  const category = String(b.category || '').trim();
  if (!allowed.includes(category)) return bad(res, `category must be one of: ${allowed.join(', ')}`);
  const row = { user_id: req.user.id, property_id: req.params.id, occurred_on: occurred, direction: b.direction, category, amount, memo: text(b.memo, 500) };
  if (b.lease_id) {
    const { data } = await supabase.from('portfolio_leases').select('id, unit_id').eq('id', b.lease_id).eq('user_id', req.user.id).eq('property_id', req.params.id).maybeSingle();
    if (!data) return res.status(404).json({ success: false, error: 'Lease not found' });
    row.lease_id = b.lease_id;
    row.unit_id = data.unit_id || null;
  }
  const { data, error } = await supabase.from('portfolio_transactions').insert(row).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

router.delete('/transactions/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Entry not found' });
  const { data, error } = await supabase.from('portfolio_transactions').delete().eq('id', req.params.id).eq('user_id', req.user.id).select('id');
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ success: false, error: 'Entry not found' });
  res.json({ success: true });
}));

module.exports = router;
