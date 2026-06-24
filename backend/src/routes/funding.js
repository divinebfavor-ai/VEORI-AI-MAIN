/**
 * Feature 17 — Transactional Funding Marketplace
 *
 * Wholesalers doing a double-close (A→B then B→C on the same day) often need
 * TRANSACTIONAL FUNDING — short-term capital that funds the A→B leg for a few
 * hours/days until the B→C buyer's funds clear. They also frequently need EMD /
 * earnest-money funding and gap funding. This marketplace surfaces vetted funding
 * partners and lets an operator request funding for a specific deal.
 *
 * Honesty rule (project-wide): we NEVER fabricate lenders. Partners come from the
 * `funding_partners` table (curated/seeded by the platform, optionally
 * operator-shared). An empty table returns an honest empty list — never fake names.
 *
 * Tables used (operator runs the migration manually):
 *   funding_partners (id, name, funding_types[], min_amount, max_amount, states[],
 *                     fee_structure, turnaround, contact_email, contact_phone,
 *                     website, is_active, is_public, user_id)
 *   funding_requests (id, user_id, deal_id, partner_id, funding_type, amount,
 *                     needed_by, status, notes, created_at)
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

const FUNDING_TYPES = ['transactional', 'emd', 'gap', 'rehab', 'private'];

// GET /api/funding/partners — browse the marketplace.
// Optional filters: ?type=transactional&state=NC&amount=120000
// Returns public/platform partners plus the operator's own added partners.
// Empty result = honest empty list (no fabricated lenders).
router.get('/partners', async (req, res) => {
  try {
    const { type, state, amount } = req.query;

    let query = supabase
      .from('funding_partners')
      .select('id, name, funding_types, min_amount, max_amount, states, fee_structure, turnaround, contact_email, contact_phone, website, is_public, user_id')
      .eq('is_active', true)
      .or(`is_public.eq.true,user_id.eq.${req.user.id}`);

    const { data, error } = await query;
    if (error) {
      // Table not provisioned yet → tell the operator plainly instead of 500-ing.
      if (error.code === '42P01') {
        return res.json({ success: true, partners: [], unconfigured: true, message: 'Funding marketplace is not set up yet. Run the funding migration to enable it.' });
      }
      throw error;
    }

    // In-memory filtering keeps the SQL simple and avoids array-operator edge cases.
    let partners = data || [];
    if (type) {
      partners = partners.filter(p => Array.isArray(p.funding_types) && p.funding_types.includes(type));
    }
    if (state) {
      const st = String(state).toUpperCase();
      partners = partners.filter(p => !Array.isArray(p.states) || p.states.length === 0 || p.states.includes(st));
    }
    if (amount) {
      const amt = Number(amount);
      if (!Number.isNaN(amt)) {
        partners = partners.filter(p =>
          (p.min_amount == null || amt >= p.min_amount) &&
          (p.max_amount == null || amt <= p.max_amount)
        );
      }
    }

    res.json({ success: true, partners });
  } catch (err) {
    console.error('[Funding] partners error:', err.message);
    res.status(500).json({ success: false, error: 'Could not load funding partners' });
  }
});

// POST /api/funding/partners — an operator adds their OWN funding partner
// (private by default). Lets a wholesaler keep their personal lender list here.
router.post('/partners', async (req, res) => {
  try {
    const { name, funding_types, min_amount, max_amount, states, fee_structure, turnaround, contact_email, contact_phone, website } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'name is required' });

    const types = Array.isArray(funding_types)
      ? funding_types.filter(t => FUNDING_TYPES.includes(t))
      : [];

    const row = {
      user_id: req.user.id,
      name: String(name).trim(),
      funding_types: types,
      min_amount: min_amount != null ? Number(min_amount) : null,
      max_amount: max_amount != null ? Number(max_amount) : null,
      states: Array.isArray(states) ? states.map(s => String(s).toUpperCase()) : [],
      fee_structure: fee_structure ? String(fee_structure) : null,
      turnaround: turnaround ? String(turnaround) : null,
      contact_email: contact_email ? String(contact_email) : null,
      contact_phone: contact_phone ? String(contact_phone) : null,
      website: website ? String(website) : null,
      is_public: false,
      is_active: true,
    };

    const { data, error } = await supabase.from('funding_partners').insert([row]).select().single();
    if (error) {
      if (error.code === '42P01') return res.status(503).json({ success: false, error: 'Funding marketplace not set up yet. Run the funding migration.' });
      throw error;
    }
    res.json({ success: true, partner: data });
  } catch (err) {
    console.error('[Funding] add partner error:', err.message);
    res.status(500).json({ success: false, error: 'Could not add funding partner' });
  }
});

// POST /api/funding/request — request funding for a specific deal.
// Records the intent; the operator then contacts the partner (we never move money).
router.post('/request', async (req, res) => {
  try {
    const { deal_id, partner_id, funding_type, amount, needed_by, notes } = req.body;
    if (!funding_type || !FUNDING_TYPES.includes(funding_type)) {
      return res.status(400).json({ success: false, error: `funding_type must be one of: ${FUNDING_TYPES.join(', ')}` });
    }
    if (amount == null || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'a positive amount is required' });
    }

    // If a deal_id is given, confirm the operator owns it (no cross-tenant requests).
    if (deal_id) {
      const { data: deal } = await supabase.from('deals').select('id').eq('id', deal_id).eq('user_id', req.user.id).maybeSingle();
      if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    const row = {
      user_id: req.user.id,
      deal_id: deal_id || null,
      partner_id: partner_id || null,
      funding_type,
      amount: Number(amount),
      needed_by: needed_by || null,
      notes: notes ? String(notes) : null,
      status: 'requested',
    };

    const { data, error } = await supabase.from('funding_requests').insert([row]).select().single();
    if (error) {
      if (error.code === '42P01') return res.status(503).json({ success: false, error: 'Funding marketplace not set up yet. Run the funding migration.' });
      throw error;
    }
    res.json({ success: true, request: data });
  } catch (err) {
    console.error('[Funding] request error:', err.message);
    res.status(500).json({ success: false, error: 'Could not submit funding request' });
  }
});

// GET /api/funding/requests — the operator's own funding requests (newest first).
router.get('/requests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funding_requests')
      .select('id, deal_id, partner_id, funding_type, amount, needed_by, status, notes, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code === '42P01') return res.json({ success: true, requests: [], unconfigured: true });
      throw error;
    }
    res.json({ success: true, requests: data || [] });
  } catch (err) {
    console.error('[Funding] requests error:', err.message);
    res.status(500).json({ success: false, error: 'Could not load funding requests' });
  }
});

module.exports = router;
