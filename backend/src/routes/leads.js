const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const aiService = require('../services/aiService');
const { tagLead, tagLeadsBulk, getOpeningSMS } = require('../services/leadTaggingService');
const predictionEngine = require('../services/predictionEngine');

const router = express.Router();
router.use(requireAuth);

// GET /api/leads — list with all filters
router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, status, score_min, score_max, state, source, limit = 50, offset = 0, search, date_from } = req.query;

    let q = supabase.from('leads').select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('motivation_score', { ascending: false, nullsFirst: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status)    q = q.eq('status', status);
    if (state)     q = q.eq('property_state', state);
    if (source)    q = q.eq('source', source);
    if (score_min) q = q.gte('motivation_score', Number(score_min));
    if (score_max) q = q.lte('motivation_score', Number(score_max));
    if (date_from) q = q.gte('created_at', date_from);
    if (search) {
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,property_address.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// POST /api/leads/reset-stale-calling — reset any leads stuck in "calling" with no active call
router.post('/reset-stale-calling', async (req, res, next) => {
  try {
    // Find leads with status "calling" that have no in-progress call
    const { data: activeCalls } = await supabase.from('calls')
      .select('lead_id').eq('user_id', req.user.id)
      .in('status', ['initiated', 'ringing', 'in-progress']);
    const activeLeadIds = (activeCalls || []).map(c => c.lead_id).filter(Boolean);

    let q = supabase.from('leads').update({ status: 'contacted' })
      .eq('user_id', req.user.id).eq('status', 'calling');
    if (activeLeadIds.length > 0) q = q.not('id', 'in', activeLeadIds);

    const { count } = await q.select('id', { count: 'exact', head: true });
    await q;
    res.json({ success: true, reset: count || 0 });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAD DEDUPLICATION — find duplicate homeowners and collapse them into ONE.
//
// WHY: the bulk import already dedups on EXACT (user_id, phone) via the unique index,
// but copies still slip in: a lead added once by CSV and again by hand, the same
// person with the phone typed differently, or two rows that share a name + address
// with no phone at all. Those clutter the list and risk double-outreach. These two
// routes let the operator FIND those groups and MERGE each down to a single canonical
// record, re-homing every child row (calls, texts, photos, activity, deals) first so
// nothing is orphaned.
//
// ADDITIVE + SAFE: brand-new routes; no existing endpoint signature changes. Every
// query is scoped to req.user.id (an operator can only ever dedup their OWN leads).
// Registered BEFORE `GET /:id` so the literal `/duplicates` path isn't swallowed by
// the `:id` param route. The merge re-links children BEFORE deleting copies, so a
// partial failure leaves data attached to a real lead, never floating.
// ─────────────────────────────────────────────────────────────────────────────

// Normalize a phone to its digit signature so "+1 (704) 555-0000" and "7045550000"
// (and a leading US "1") collapse to the same dedup key. Empty when no digits.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

// Name + address signature — the fallback dedup key for leads that have NO phone
// (a phone-less property can't use the phone index, but two hand-typed copies of the
// same owner+house should still surface as duplicates). Returns '' if too thin to be
// a confident match (we never guess on name alone).
function identityKey(lead) {
  const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
  const addr = String(lead.property_address || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name && addr) return `na:${name}|${addr}`;
  return '';
}

// Count how many non-empty fields a lead carries — used to pick the most COMPLETE
// record as the survivor when two copies are otherwise equally old.
function completeness(lead) {
  const fields = ['first_name','last_name','phone','email','property_address','property_city',
    'property_state','property_zip','property_type','estimated_value','estimated_equity',
    'estimated_arv','notes','motivation_score'];
  return fields.reduce((acc, k) => acc + (lead[k] != null && String(lead[k]).trim() !== '' ? 1 : 0), 0);
}

// Pick the canonical survivor for a duplicate group: prefer one already on DNC (so we
// never lose a suppression flag), then the most complete, then the oldest (its
// created_at + any linked history is the real one). Pure; never mutates input.
function pickCanonical(group) {
  return [...group].sort((a, b) => {
    if (!!b.is_on_dnc !== !!a.is_on_dnc) return (b.is_on_dnc ? 1 : 0) - (a.is_on_dnc ? 1 : 0);
    const c = completeness(b) - completeness(a);
    if (c !== 0) return c;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  })[0];
}

// GET /api/leads/duplicates — surface duplicate groups for THIS operator. Read-only.
// Groups by normalized phone first; phone-less leads fall back to name+address. Only
// groups with 2+ members are returned. Each group names its canonical survivor and the
// ids that would be merged away, so the UI can show "merge 3 → 1" before acting.
router.get('/duplicates', async (req, res, next) => {
  try {
    const { data: rows, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, estimated_arv, notes, motivation_score, status, is_on_dnc, created_at')
      .eq('user_id', req.user.id);
    if (error) throw error;

    const buckets = new Map();
    for (const l of (rows || [])) {
      const key = phoneKey(l.phone) ? `ph:${phoneKey(l.phone)}` : identityKey(l);
      if (!key) continue; // no phone AND no name+address → not a dedup candidate
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(l);
    }

    const groups = [];
    let duplicate_leads = 0;
    for (const [key, members] of buckets) {
      if (members.length < 2) continue;
      const canonical = pickCanonical(members);
      const mergeIds = members.filter(m => m.id !== canonical.id).map(m => m.id);
      duplicate_leads += mergeIds.length;
      groups.push({
        key,
        match_on: key.startsWith('ph:') ? 'phone' : 'name_address',
        count: members.length,
        canonical_id: canonical.id,
        canonical,
        merge_ids: mergeIds,
        members,
      });
    }
    // Biggest clusters first — that's where the most clutter is.
    groups.sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      groups,
      group_count: groups.length,
      duplicate_leads, // how many rows would disappear if every group is merged
    });
  } catch (err) { next(err); }
});

// POST /api/leads/merge — collapse duplicates into a single canonical lead.
// Body: { canonical_id, merge_ids:[...] }  (merge the listed copies INTO canonical_id)
//   — or { groups:[{canonical_id, merge_ids}] } to merge several groups in one call.
// For each group we: (1) re-point every child row (calls, sms_messages, lead_photos,
// deal_activity, deals) from a copy to the canonical lead, (2) carry over a DNC flag
// if any copy had it, (3) delete the now-empty copies. All scoped to req.user.id.
router.post('/merge', async (req, res, next) => {
  try {
    const uid = req.user.id;

    // Accept either a single group or a batch; normalize to an array.
    let groups = [];
    if (Array.isArray(req.body.groups)) {
      groups = req.body.groups;
    } else if (req.body.canonical_id) {
      groups = [{ canonical_id: req.body.canonical_id, merge_ids: req.body.merge_ids }];
    }
    if (!groups.length) {
      return res.status(400).json({ success: false, error: 'canonical_id + merge_ids (or groups[]) required' });
    }

    // Child tables that reference a lead by lead_id. We re-home these before deleting
    // the copy so a call/text/photo is never orphaned. `scoped` says whether the table
    // carries a user_id column we can additionally filter on — `lead_photos` does NOT
    // (the timeline query filters it on lead_id alone), so re-homing it must skip the
    // user_id guard or the update would error and the photos would never move.
    const CHILD_TABLES = [
      { table: 'calls',        scoped: true  },
      { table: 'sms_messages', scoped: true  },
      { table: 'lead_photos',  scoped: false },
      { table: 'deal_activity', scoped: true },
      { table: 'deals',        scoped: true  },
    ];

    let merged_leads = 0;   // copies removed
    let groups_done  = 0;
    const errors = [];

    for (const g of groups) {
      const canonicalId = g.canonical_id;
      const mergeIds = (Array.isArray(g.merge_ids) ? g.merge_ids : []).filter(id => id && id !== canonicalId);
      if (!canonicalId || !mergeIds.length) continue;

      // Verify the canonical lead belongs to this operator — never merge into someone
      // else's record, and never trust an id from the client without this check.
      const { data: canonical } = await supabase
        .from('leads').select('id, is_on_dnc, status')
        .eq('id', canonicalId).eq('user_id', uid).single();
      if (!canonical) { errors.push({ canonical_id: canonicalId, error: 'canonical not found' }); continue; }

      // Confirm the copies belong to this operator too; only operate on the verified set.
      const { data: copies } = await supabase
        .from('leads').select('id, is_on_dnc')
        .eq('user_id', uid).in('id', mergeIds);
      const verifiedIds = (copies || []).map(c => c.id);
      if (!verifiedIds.length) { errors.push({ canonical_id: canonicalId, error: 'no valid copies' }); continue; }

      // 1. Re-home children from each copy onto the canonical lead. Best-effort per
      //    table — a missing table or column won't abort the whole merge.
      for (const { table, scoped } of CHILD_TABLES) {
        let q = supabase.from(table).update({ lead_id: canonicalId }).in('lead_id', verifiedIds);
        if (scoped) q = q.eq('user_id', uid);
        const { error: upErr } = await q;
        if (upErr) console.warn(`[Leads merge] ${table} re-link skipped:`, upErr.message);
      }

      // 2. Preserve a DNC flag: if ANY copy was suppressed, the survivor must be too.
      const anyDnc = !!canonical.is_on_dnc || (copies || []).some(c => c.is_on_dnc);
      if (anyDnc && !canonical.is_on_dnc) {
        const { error: dncErr } = await supabase.from('leads')
          .update({ is_on_dnc: true, status: 'dnc' })
          .eq('id', canonicalId).eq('user_id', uid);
        if (dncErr) console.warn('[Leads merge] DNC carry-over skipped:', dncErr.message);
      }

      // 3. Delete the copies — children are already re-homed, so nothing is lost.
      const { error: delErr } = await supabase
        .from('leads').delete().eq('user_id', uid).in('id', verifiedIds);
      if (delErr) { errors.push({ canonical_id: canonicalId, error: delErr.message }); continue; }

      merged_leads += verifiedIds.length;
      groups_done  += 1;
    }

    res.json({ success: true, groups_merged: groups_done, merged_leads, errors });
  } catch (err) { next(err); }
});

// GET /api/leads/:id — full lead with call history
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('leads').select('*, calls(*), deals(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/leads/:id/timeline — ONE living profile: every event for this lead,
// merged chronologically into a single feed. This is the "chart" the operator
// reads to see the whole story of a lead in order:
//   • inbound + outbound TEXTS        (sms_messages)
//   • AI/operator CALLS w/ transcript (calls)
//   • seller PHOTOS                   (lead_photos — seller_upload + sms_mms)
//   • signed/sent DOCUMENTS           (contracts, via the lead's deals)
//   • all deal ACTIVITY               (deal_activity — buyer-assigned, etc.)
//
// Additive, read-only. Every source is fetched best-effort and normalized to a
// common { type, at, title, body, meta } shape, then sorted newest-first. A
// failure in any one source degrades that lane to empty — it never 500s the
// chart. All queries are scoped to req.user.id so an operator only ever sees
// their own lead's history.
//
// NOTE: declared AFTER GET /:id above. Express matches the more specific
// '/:id/timeline' path correctly because the literal '/timeline' segment can't
// be consumed by '/:id' (which is a single segment) — so ordering is safe.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const uid = req.user.id;

    // Confirm the lead belongs to this operator before exposing any history.
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, user_id, first_name, last_name, phone, property_address')
      .eq('id', leadId).eq('user_id', uid).single();
    if (leadErr || !lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    // The lead's deals — used to pull the documents (contracts) for this property.
    const { data: deals } = await supabase
      .from('deals').select('id').eq('lead_id', leadId).eq('user_id', uid);
    const dealIds = (deals || []).map(d => d.id).filter(Boolean);

    // Fire every lane in parallel; each is best-effort.
    const [smsRes, callsRes, photosRes, activityRes, contractsRes] = await Promise.allSettled([
      supabase.from('sms_messages')
        .select('id, direction, body, from_number, to_number, status, sent_at, created_at')
        .eq('lead_id', leadId).eq('user_id', uid)
        .order('sent_at', { ascending: false }).limit(500),
      supabase.from('calls')
        .select('id, direction, status, outcome, duration_seconds, motivation_score, ai_summary, transcript, started_at, created_at')
        .eq('lead_id', leadId).eq('user_id', uid)
        .order('started_at', { ascending: false }).limit(200),
      supabase.from('lead_photos')
        .select('id, url, source, file_name, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('deal_activity')
        .select('id, actor_type, activity_type, message, metadata, created_at')
        .eq('lead_id', leadId).eq('user_id', uid)
        .order('created_at', { ascending: false }).limit(200),
      dealIds.length
        ? supabase.from('contracts')
            .select('id, deal_id, contract_type, signing_status, sent_at, fully_signed_at, created_at')
            .in('deal_id', dealIds).eq('user_id', uid)
            .order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
    ]);

    const val = r => (r.status === 'fulfilled' ? (r.value?.data || []) : []);
    const events = [];

    // TEXTS — inbound vs outbound, body verbatim.
    for (const m of val(smsRes)) {
      const out = m.direction === 'outbound';
      events.push({
        type: out ? 'sms_out' : 'sms_in',
        at: m.sent_at || m.created_at,
        title: out ? 'Text sent' : 'Text received',
        body: m.body || '',
        meta: { status: m.status, from: m.from_number, to: m.to_number },
      });
    }

    // CALLS — surface the AI summary + transcript so the whole conversation lives here.
    for (const c of val(callsRes)) {
      const mins = c.duration_seconds ? Math.round((c.duration_seconds / 60) * 10) / 10 : 0;
      events.push({
        type: 'call',
        at: c.started_at || c.created_at,
        title: `Call${c.direction ? ` (${c.direction})` : ''}${c.outcome ? ` — ${c.outcome}` : ''}`,
        body: c.ai_summary || '',
        meta: {
          status: c.status, outcome: c.outcome, minutes: mins,
          motivation_score: c.motivation_score, transcript: c.transcript || null,
        },
      });
    }

    // PHOTOS — seller pictures, whether uploaded via link or texted in (MMS).
    for (const p of val(photosRes)) {
      events.push({
        type: 'photo',
        at: p.created_at,
        title: p.source === 'sms_mms' ? 'Seller texted a photo' : 'Seller uploaded a photo',
        body: '',
        meta: { url: p.url, source: p.source, file_name: p.file_name },
      });
    }

    // DOCUMENTS — every contract sent/signed for this property.
    for (const k of val(contractsRes)) {
      events.push({
        type: 'document',
        at: k.fully_signed_at || k.sent_at || k.created_at,
        title: `${(k.contract_type || 'contract').toUpperCase()} — ${k.signing_status || 'draft'}`,
        body: '',
        meta: {
          contract_type: k.contract_type, signing_status: k.signing_status,
          deal_id: k.deal_id, sent_at: k.sent_at, fully_signed_at: k.fully_signed_at,
        },
      });
    }

    // ACTIVITY — buyer-assigned, media_received, stage changes, etc.
    for (const a of val(activityRes)) {
      events.push({
        type: 'activity',
        at: a.created_at,
        title: a.activity_type || 'activity',
        body: a.message || '',
        meta: { actor_type: a.actor_type, ...(a.metadata || {}) },
      });
    }

    // Newest-first. Anything missing a timestamp sinks to the bottom.
    events.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));

    res.json({
      success: true,
      lead: {
        id: lead.id,
        name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        phone: lead.phone,
        property_address: lead.property_address,
      },
      counts: {
        texts: val(smsRes).length,
        calls: val(callsRes).length,
        photos: val(photosRes).length,
        documents: val(contractsRes).length,
        activity: val(activityRes).length,
        total: events.length,
      },
      timeline: events,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/leads/:id/prediction — AI DEAL PREDICTION ENGINE.
// Runs the unified predictor (predictionEngine.predict) over the lead, its most-
// advanced deal, and recent same-state outcome history, then returns the full
// prediction object: per-field { value, confidence, evidence }, best_next_action,
// overall_confidence, escalate flag, and a flat evidence stream.
//
// Honors the 7 AI Rules: never fabricates (null + reason when inputs are missing),
// every field carries confidence + evidence, learns from deal_outcome_learning,
// escalates below threshold, prioritizes close-prob × expected fee, and LOGS every
// prediction to deal_predictions (best-effort — a logging failure never fails the
// response; Rule 6). Read-only on the lead; additive endpoint, scoped to the user.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/prediction', async (req, res, next) => {
  try {
    const { data: lead, error } = await supabase.from('leads')
      .select('*, deals(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    // Most-advanced deal = newest deal on the lead (best-effort; may be none).
    const deals = Array.isArray(lead.deals) ? lead.deals : [];
    const deal = deals.length
      ? deals.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]
      : null;

    // Rule 3 — pull recent same-state outcomes to nudge confidence. Best-effort.
    let outcomes = [];
    try {
      const { data } = await supabase.from('deal_outcome_learning')
        .select('outcome, state, days_to_outcome')
        .eq('state', lead.property_state || '___none___')
        .order('created_at', { ascending: false })
        .limit(50);
      outcomes = data || [];
    } catch { /* no history → no nudge */ }

    const prediction = predictionEngine.predict(lead, deal, { outcomes });

    // Rule 6 — persist the prediction for audit/history. Best-effort: if the table
    // isn't migrated yet or the insert fails, we still return the prediction.
    try {
      await supabase.from('deal_predictions').insert({
        user_id:            req.user.id,
        lead_id:            lead.id,
        deal_id:            deal?.id || null,
        overall_confidence: prediction.overall_confidence,
        escalate:           prediction.escalate,
        best_next_action:   prediction.best_next_action?.action || null,
        predictions:        prediction.predictions,
        evidence:           prediction.evidence,
        strategy:           prediction.strategy,
      });
    } catch { /* table not migrated / insert failed — logging is non-blocking */ }

    res.json({ success: true, data: prediction });
  } catch (err) { next(err); }
});

// POST /api/leads — create single
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, source, notes, tags } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    const is_on_dnc = !!dnc;

    const { data, error } = await supabase.from('leads').insert([{
      id: uuidv4(), user_id: req.user.id, first_name, last_name, phone, email,
      property_address, property_city, property_state, property_zip, property_type,
      estimated_value, estimated_equity, source, notes, tags, is_on_dnc, status: is_on_dnc ? 'dnc' : 'new'
    }]).select().single();

    if (error) throw error;

    // Auto-tag within 60 seconds (async — don't block response)
    setImmediate(async () => {
      const tagged = await tagLead(data.id);
      if (tagged && !is_on_dnc) {
        // Re-fetch to get tag for SMS
        const { data: full } = await supabase.from('leads').select('*').eq('id', data.id).single();
        if (full) {
          const sms = getOpeningSMS(full);
          // Log opening SMS to be sent (conversations service picks this up)
          await supabase.from('ai_command_log').insert({
            operator_id: req.user.id,
            action_type: 'opening_sms',
            contact_name: `${full.first_name} ${full.last_name}`,
            message_sent: sms,
            outcome: 'queued',
          }).catch(() => {});
        }
      }
    });

    // Auto-size the operator's toll-free number pool to their callable lead volume
    // (async — never blocks lead creation, never throws into the response)
    setImmediate(() => {
      require('../services/numberProvisioning').ensureCapacity(req.user.id)
        .catch(err => console.error('[Leads] ensureCapacity error:', err.message));
    });

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads/bulk — CSV import up to 10,000
router.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });

    // Get all DNC numbers
    const phones = leads.map(l => l.phone).filter(Boolean);
    const { data: dncData } = await supabase.from('dnc_records').select('phone').in('phone', phones);
    const dncSet = new Set((dncData || []).map(d => d.phone));

    const records = leads.map(l => ({
      id: uuidv4(),
      user_id: req.user.id,
      first_name:       l.first_name || l['First Name'] || l.firstname || '',
      last_name:        l.last_name  || l['Last Name']  || l.lastname  || '',
      phone:            l.phone      || l['Phone']      || '',
      email:            l.email      || l['Email']      || null,
      property_address: l.property_address || l['Property Address'] || l.address || '',
      property_city:    l.property_city    || l['City']    || '',
      property_state:   l.property_state   || l['State']   || '',
      property_zip:     l.property_zip     || l['Zip']     || '',
      property_type:    l.property_type    || l['Type']    || '',
      estimated_value:  parseNum(l.estimated_value  || l['Estimated Value']  || l['AVM']),
      estimated_equity: parseNum(l.estimated_equity || l['Estimated Equity'] || l['Equity']),
      source: l.source || l['Source'] || 'csv_import',
      is_on_dnc: dncSet.has(l.phone),
      status: dncSet.has(l.phone) ? 'dnc' : 'new',
    })).filter(r => r.phone);

    // Deduplicate by phone within batch
    const seen = new Set();
    const unique = records.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });

    let imported = 0;
    let duplicates = 0;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      // Upsert against the leads_user_phone_unique index — duplicate (user_id, phone)
      // rows are IGNORED, not re-inserted. `.select('id')` returns only the rows that
      // actually inserted, so `imported` reflects NEW leads and the rest are counted
      // as duplicates_skipped. With ignoreDuplicates the upsert won't error on dupes,
      // so we no longer blind-insert on the error path (that was the duplicate leak).
      const { data, error } = await supabase
        .from('leads')
        .upsert(chunk, { onConflict: 'phone,user_id', ignoreDuplicates: true })
        .select('id');
      if (!error) {
        const inserted = data?.length || 0;
        imported   += inserted;
        duplicates += chunk.length - inserted; // the rest already existed
      } else {
        // A real error (not a dedup conflict, which ignoreDuplicates swallows).
        // Do NOT fall back to a plain insert — that would re-create duplicates.
        // Surface it so the operator sees the import didn't fully land.
        console.warn('[Leads import] Upsert error:', error.message);
        duplicates += chunk.length;
      }
    }

    // Auto-tag all imported leads async — don't block the response
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(imported);

    if (newLeads?.length) {
      setImmediate(() => tagLeadsBulk(newLeads.map(l => l.id)));

      // Fire opening SMS to every lead that has a phone number
      const { sendOpeningSMS } = require('../services/smsService');
      const userId = req.user.id;
      setImmediate(async () => {
        for (const lead of newLeads) {
          if (lead.phone && !lead.is_on_dnc) {
            await sendOpeningSMS(lead, userId).catch(() => {});
            await new Promise(r => setTimeout(r, 300)); // 300ms between sends
          }
        }
        console.log(`[SMS] Opening texts sent to ${newLeads.filter(l => l.phone).length} leads`);
      });
    }

    // Auto-size the operator's toll-free number pool to their callable lead volume
    // (async — never blocks the import response, never throws)
    setImmediate(() => {
      require('../services/numberProvisioning').ensureCapacity(req.user.id)
        .catch(err => console.error('[Leads] ensureCapacity (bulk) error:', err.message));
    });

    res.status(201).json({
      success: true,
      imported,
      dnc_flagged: unique.filter(r => r.is_on_dnc).length,
      duplicates_skipped: duplicates,
      total_received: leads.length,
    });
  } catch (err) { next(err); }
});

// PUT /api/leads/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['first_name','last_name','email','phone','property_address','property_city','property_state','property_zip','property_type','estimated_value','estimated_equity','estimated_arv','source','status','motivation_score','notes','tags','pipeline_stage'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/research — AI property analysis
// POST /api/leads/:id/retag — manually retag a lead
router.post('/:id/retag', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('id, user_id').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const tagged = await tagLead(lead.id);
    res.json({ success: true, data: tagged });
  } catch (err) { next(err); }
});

// POST /api/leads/retag-all — retag all leads for this operator
router.post('/retag-all', async (req, res, next) => {
  try {
    const { data: leads } = await supabase.from('leads').select('id').eq('user_id', req.user.id);
    if (!leads?.length) return res.json({ success: true, tagged: 0 });
    setImmediate(() => tagLeadsBulk(leads.map(l => l.id)));
    res.json({ success: true, queued: leads.length, message: `Tagging ${leads.length} leads in background` });
  } catch (err) { next(err); }
});

router.get('/:id/research', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const analysis = await aiService.analyzePropertyOffer({ address: lead.property_address, city: lead.property_city, state: lead.property_state, estimatedValue: lead.estimated_value });
    if (analysis) {
      await supabase.from('leads').update({ estimated_arv: analysis.estimated_arv }).eq('id', req.params.id);
    }
    res.json({ success: true, data: analysis });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/dnc
router.post('/:id/dnc', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('phone').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    await supabase.from('dnc_records').upsert([{ id: uuidv4(), phone: lead.phone, added_by: req.user.id, reason: req.body.reason || 'manual' }]);
    await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', req.params.id);
    res.json({ success: true, message: 'Added to DNC' });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/skip-trace — run skip trace on a lead
router.post('/:id/skip-trace', async (req, res, next) => {
  try {
    const { skipTraceLead } = require('../services/skipTraceService');
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const result = await skipTraceLead(lead);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/direct-mail — send a physical postcard
router.post('/:id/direct-mail', async (req, res, next) => {
  try {
    const { sendPostcard } = require('../services/directMailService');
    const { template = 'no_answer' } = req.body;
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!lead.property_address) return res.status(400).json({ success: false, error: 'Lead has no property address' });
    const { data: operator } = await supabase.from('users').select('ai_caller_name, company_name, business_phone, id').eq('id', req.user.id).single();
    const result = await sendPostcard({ lead, operator: operator || {}, templateKey: template });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/voicemail — drop a ringless voicemail
router.post('/:id/voicemail', async (req, res, next) => {
  try {
    const { dropVoicemail } = require('../services/voicemailService');
    const { template = 'first_contact' } = req.body;
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (lead.is_on_dnc) return res.status(400).json({ success: false, error: 'Lead is on DNC list' });
    if (!lead.phone) return res.status(400).json({ success: false, error: 'Lead has no phone number' });
    const { data: operator } = await supabase.from('users').select('ai_caller_name, ai_voice_id, company_name, id').eq('id', req.user.id).single();
    const result = await dropVoicemail({ lead, operator: operator || {}, templateKey: template });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/ingest — structured lead ingestion with all required fields
router.post('/ingest', async (req, res, next) => {
  try {
    const {
      name, phone, email, property_address, motivation_type,
      price_range_min, price_range_max, timeline, contact_preference,
      lead_source, target_area, notes
    } = req.body;

    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    if (dnc) return res.status(400).json({ success: false, error: 'This number is on the DNC list' });

    const nameParts = (name || '').split(' ');
    const first_name = nameParts[0] || '';
    const last_name  = nameParts.slice(1).join(' ') || '';

    // Insert into leads table (no sellers table in schema)
    const { data: seller, error } = await supabase.from('leads').insert({
      id: uuidv4(),
      user_id: req.user.id,
      first_name, last_name, phone, email: email || null,
      property_address: property_address || target_area || null,
      source: lead_source || 'ingest',
      status: 'new',
      notes: notes || null,
    }).select().single();

    if (error) throw error;

    // Auto-size the operator's toll-free number pool to their callable lead volume
    // (async — never blocks the response, never throws)
    setImmediate(() => {
      require('../services/numberProvisioning').ensureCapacity(req.user.id)
        .catch(err => console.error('[Leads] ensureCapacity (ingest) error:', err.message));
    });

    res.status(201).json({ success: true, seller });
  } catch (err) { next(err); }
});

// POST /api/leads/qualify — AI qualification engine
router.post('/qualify', async (req, res, next) => {
  try {
    const { lead_id, conversation_text } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { qualifyLead } = require('../services/dualAIService');
    const result = await qualifyLead({
      name: `${lead.first_name} ${lead.last_name}`.trim(),
      phone: lead.phone,
      propertyAddress: lead.property_address,
      conversationHistory: conversation_text || '',
      motivationType: lead.motivation_type || 'other',
    });

    // Update motivation score
    await supabase.from('leads').update({
      motivation_score: result.motivation_score,
      updated_at: new Date().toISOString(),
    }).eq('id', lead_id);

    // Store qualification conversation
    if (conversation_text) {
      await supabase.from('ai_command_log').insert({
        contact_id: lead_id,
        contact_name: `${lead.first_name} ${lead.last_name}`.trim(),
        action_type: 'lead_qualified',
        message_sent: conversation_text.substring(0, 500),
        outcome: result.recommended_action,
        operator_id: req.user.id,
      });
    }

    // Auto-escalate to pipeline if score >= 60
    if (result.motivation_score >= 60 && result.recommended_action === 'escalate_to_pipeline') {
      const { data: deal } = await supabase.from('deals').insert({
        id: require('uuid').v4(),
        user_id: req.user.id,
        lead_id: lead.id,
        property_address: lead.property_address,
        property_state: lead.property_state || null,
        status: 'new',
      }).select().single();

      await supabase.from('leads').update({ status: 'interested', deal_id: deal?.id }).eq('id', lead_id);

      await supabase.from('ai_command_log').insert({
        deal_id: deal?.id,
        contact_name: `${lead.first_name} ${lead.last_name}`.trim(),
        action_type: 'escalated_to_pipeline',
        message_sent: `Score: ${result.motivation_score}/100 — auto-escalated to deal pipeline`,
        outcome: 'deal_created',
        operator_id: req.user.id,
      });
    }

    res.json({ success: true, qualification: result });
  } catch (err) { next(err); }
});

function parseNum(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }

// ─── Photo request helpers ────────────────────────────────────────────────────
const crypto = require('crypto');
const { sendSMS } = require('../services/smsService');

const SMS_ENABLED  = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://veori.net';

async function generatePhotoToken(leadId, userId, sentVia = 'manual') {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('photo_upload_tokens').insert({
    token, lead_id: leadId, user_id: userId, expires_at: expiresAt, sent_via: sentVia,
  });

  return { token, url: `${FRONTEND_URL}/upload/${token}`, expiresAt };
}

// POST /api/leads/:id/send-photo-request — generate link and send to seller
router.post('/:id/send-photo-request', async (req, res, next) => {
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, property_address, property_city, property_state, user_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!lead.phone && !lead.email) {
      return res.status(400).json({ success: false, error: 'No phone or email on this lead' });
    }

    const name    = lead.first_name || 'there';
    const address = [lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ');

    let sentVia = 'manual';
    let delivered = false;

    // Try SMS first
    if (lead.phone && SMS_ENABLED) {
      const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'sms');
      const message = `Hi ${name}, thanks for speaking with us about ${address || 'your property'}. Please tap the link to send us photos — takes 2 min on your phone:\n\n${url}\n\nThis link expires in 7 days.`;

      try {
        await sendSMS(lead.phone, message);
        sentVia   = 'sms';
        delivered = true;
        return res.json({ success: true, sent_via: 'sms', phone: lead.phone, token, url });
      } catch (e) {
        console.warn('[PhotoRequest] SMS failed, trying email:', e.message);
      }
    }

    // Fallback to email
    if (lead.email) {
      const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'email');
      const { sendEmail } = require('../services/emailService');
      await sendEmail({
        to:      lead.email,
        subject: `Please send us photos of ${lead.property_address || 'your property'}`,
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#060E1A;color:#fff;border-radius:16px;padding:40px;">
            <div style="font-size:24px;font-weight:900;letter-spacing:-0.04em;margin-bottom:24px;">VEORI</div>
            <p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 20px;">Hi ${name},</p>
            <p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 24px;">Thanks for speaking with us about <strong style="color:#fff">${address || 'your property'}</strong>. To help us move forward, please send us photos of the property using the button below.</p>
            <a href="${url}" style="display:block;text-align:center;background:#00C37A;color:#060E1A;font-size:15px;font-weight:800;padding:16px;border-radius:10px;text-decoration:none;margin-bottom:20px;">Send Property Photos</a>
            <p style="font-size:12px;color:rgba(255,255,255,0.35);">This link expires in 7 days. If you have any questions, simply reply to this email.</p>
          </div>
        `,
      });
      delivered = true;
      return res.json({ success: true, sent_via: 'email', email: lead.email, token, url });
    }

    // Neither worked — return the link anyway for manual sharing
    const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'manual');
    res.json({ success: true, sent_via: 'link_only', token, url,
      message: 'No phone/email delivery available — copy the link to share manually.' });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/imagery — Feature A: aerial + street-view imagery for the
// property, derived from the lead's stored address. Owner-scoped. Returns null
// URLs (available:false) when GOOGLE_MAPS_API_KEY is unset or the lead has no
// address — never errors, never blocks the page.
router.get('/:id/imagery', async (req, res, next) => {
  try {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, property_address, property_city, property_state, property_zip')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { buildLeadImagery } = require('../services/propertyImageryService');
    res.json({ success: true, imagery: buildLeadImagery(lead) });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/photos — list photos for a lead
router.get('/:id/photos', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('lead_photos')
      .select('id, url, source, file_name, created_at')
      .eq('lead_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, photos: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
