// ─── Books API: profit and loss, Schedule E, 1099s, vendors, CSV exports ─────
// Every query is scoped to req.user.id. Ids that arrive in a request are proven to
// belong to this workspace before they are used.

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const books = require('../services/bookkeepingService');
const { UUID_RE } = require('../utils/ownership');

const router = express.Router();
router.use(requireAuth);

const ENTITY_TYPES = ['individual', 'sole_prop', 'llc', 's_corp', 'c_corp', 'partnership', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e.status && e.status < 500) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

function period(req) {
  const { from, to } = req.query;
  if (from && !DATE_RE.test(from)) throw Object.assign(new Error('from must be a date (YYYY-MM-DD)'), { status: 400 });
  if (to && !DATE_RE.test(to)) throw Object.assign(new Error('to must be a date (YYYY-MM-DD)'), { status: 400 });
  if (from && to && to < from) throw Object.assign(new Error('to cannot be before from'), { status: 400 });
  return { from: from || null, to: to || null };
}

function sendCsv(res, filename, rows, headers) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(books.toCsv(rows, headers));
}

// ── Reports ─────────────────────────────────────────────────────────────────
router.get('/pnl', wrap(async (req, res) => {
  res.json({ success: true, data: await books.profitAndLoss(req.user.id, period(req)) });
}));

router.get('/schedule-e', wrap(async (req, res) => {
  res.json({ success: true, data: await books.scheduleE(req.user.id, req.query.year || new Date().getFullYear()) });
}));

router.get('/vendor-payments', wrap(async (req, res) => {
  res.json({ success: true, data: await books.vendorPayments(req.user.id, req.query.year || new Date().getFullYear()) });
}));

// ── Exports ─────────────────────────────────────────────────────────────────
router.get('/export/ledger.csv', wrap(async (req, res) => {
  const rows = await books.ledgerExport(req.user.id, period(req));
  sendCsv(res, `veori-ledger${req.query.from ? `-${req.query.from}` : ''}.csv`, rows, ['date', 'direction', 'category', 'amount', 'property', 'deal', 'vendor', 'memo']);
}));

router.get('/export/schedule-e.csv', wrap(async (req, res) => {
  const data = await books.scheduleE(req.user.id, req.query.year || new Date().getFullYear());
  const rows = [];
  for (const p of data.properties) {
    rows.push({ property: p.address, line: 3, item: 'Rents received', amount: p.rents_received });
    for (const l of p.expense_lines) rows.push({ property: p.address, line: l.line, item: l.label, amount: l.amount });
    for (const x of p.not_included) rows.push({ property: p.address, line: '', item: `${x.category} (not a Schedule E expense line)`, amount: x.amount });
    rows.push({ property: p.address, line: '', item: 'Net before depreciation', amount: p.net_before_depreciation });
  }
  sendCsv(res, `veori-schedule-e-${data.year}.csv`, rows, ['property', 'line', 'item', 'amount']);
}));

router.get('/export/1099.csv', wrap(async (req, res) => {
  const data = await books.vendorPayments(req.user.id, req.query.year || new Date().getFullYear());
  const rows = data.vendors.filter(v => v.needs_1099).map(v => ({
    vendor: v.name, trade: v.trade || '', entity_type: v.entity_type || '',
    paid: v.paid_this_year, w9_on_file: v.w9_on_file ? 'yes' : 'no', action: v.action || '',
  }));
  sendCsv(res, `veori-1099-${data.year}.csv`, rows, ['vendor', 'trade', 'entity_type', 'paid', 'w9_on_file', 'action']);
}));

// ── Vendors ─────────────────────────────────────────────────────────────────
router.get('/vendors', wrap(async (req, res) => {
  let q = supabase.from('vendors').select('*').eq('user_id', req.user.id).order('name').limit(500);
  if (req.query.active === 'true') q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

function vendorPayload(body) {
  const row = {};
  for (const f of ['name', 'trade', 'phone', 'email', 'address', 'notes']) {
    if (body[f] !== undefined) row[f] = body[f] === null ? null : String(body[f]).slice(0, f === 'notes' ? 2000 : 200);
  }
  for (const f of ['w9_on_file', 'issues_1099', 'is_active']) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== 'boolean') throw Object.assign(new Error(`${f} must be true or false`), { status: 400 });
      row[f] = body[f];
    }
  }
  if (body.entity_type !== undefined) {
    if (body.entity_type !== null && !ENTITY_TYPES.includes(body.entity_type)) {
      throw Object.assign(new Error(`entity_type must be one of ${ENTITY_TYPES.join(', ')}`), { status: 400 });
    }
    row.entity_type = body.entity_type;
  }
  // A tax id must not be stored: keep the W-9 itself in your records.
  if (body.tax_id || body.ein || body.ssn) throw Object.assign(new Error('Do not send a tax id: Veori records only whether a W-9 is on file'), { status: 400 });
  return row;
}

router.post('/vendors', wrap(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !String(body.name).trim()) return res.status(400).json({ success: false, error: 'name is required' });
  const { data, error } = await supabase.from('vendors').insert({ user_id: req.user.id, ...vendorPayload(body) }).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

router.patch('/vendors/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Vendor not found' });
  const row = vendorPayload(req.body || {});
  if (!Object.keys(row).length) return res.status(400).json({ success: false, error: 'Nothing to update' });
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('vendors').update(row).eq('id', req.params.id).eq('user_id', req.user.id).select('*');
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ success: false, error: 'Vendor not found' });
  res.json({ success: true, data: data[0] });
}));

router.delete('/vendors/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Vendor not found' });
  const { data, error } = await supabase.from('vendors').delete().eq('id', req.params.id).eq('user_id', req.user.id).select('id');
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ success: false, error: 'Vendor not found' });
  res.json({ success: true });
}));

// ── Ledger entries that are not tied to a property (deal costs, overhead) ────
router.post('/entries', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.direction !== 'income' && b.direction !== 'expense') return res.status(400).json({ success: false, error: 'direction must be income or expense' });
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return res.status(400).json({ success: false, error: 'amount must be a positive number' });
  const portfolio = require('../services/portfolioService');
  const allowed = b.direction === 'income' ? portfolio.INCOME_CATEGORIES : portfolio.EXPENSE_CATEGORIES;
  if (!allowed.includes(String(b.category || ''))) return res.status(400).json({ success: false, error: `category must be one of: ${allowed.join(', ')}` });
  const occurred = b.occurred_on || new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(occurred)) return res.status(400).json({ success: false, error: 'occurred_on must be a date (YYYY-MM-DD)' });

  const row = { user_id: req.user.id, direction: b.direction, category: b.category, amount, occurred_on: occurred, memo: b.memo ? String(b.memo).slice(0, 500) : null };
  // Each optional link must belong to this workspace.
  for (const [field, table, label] of [['property_id', 'portfolio_properties', 'Property'], ['deal_id', 'deals', 'Deal'], ['vendor_id', 'vendors', 'Vendor']]) {
    if (!b[field]) continue;
    if (!UUID_RE.test(String(b[field]))) return res.status(404).json({ success: false, error: `${label} not found` });
    const { data } = await supabase.from(table).select('id').eq('id', b[field]).eq('user_id', req.user.id).maybeSingle();
    if (!data) return res.status(404).json({ success: false, error: `${label} not found` });
    row[field] = b[field];
  }
  const { data, error } = await supabase.from('portfolio_transactions').insert(row).select('*').single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

module.exports = router;
