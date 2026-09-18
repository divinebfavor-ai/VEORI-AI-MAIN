// ─── Veori Ads API ───────────────────────────────────────────────────────────
// Every query is scoped to req.user.id. Creative generation cannot be reached
// without a live pre-flight brief for the market; that gate lives in the agent,
// not here, so no route can be added later that skips it.

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { UUID_RE } = require('../utils/ownership');
const preflight = require('../ads/preflight');
const creative = require('../ads/creative');
const learning = require('../ads/learning');
const compliance = require('../ads/compliance');
const connectors = require('../ads/connectors');
const catalog = require('../ads/catalog');
const marketPulse = require('../ads/marketPulse');

const router = express.Router();
router.use(requireAuth);

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e.status && e.status < 500) return res.status(e.status).json({ success: false, error: e.message, code: e.code || null });
      next(e);
    }
  };
}

// ── What Veori knows and does not ───────────────────────────────────────────
router.get('/connectors', wrap(async (req, res) => {
  res.json({ success: true, data: { sources: connectors.status(), note: 'No external advertising data source is connected. Every capability below is recorded as a gap in each brief rather than estimated.' } });
}));

router.get('/catalog', wrap(async (req, res) => {
  res.json({ success: true, data: { drivers: catalog.DRIVERS, angles: catalog.ANGLES, hook_styles: catalog.HOOK_STYLES, image_formats: catalog.IMAGE_FORMATS, do_not_use: catalog.SATURATED } });
}));

// ── Operator ad profile ─────────────────────────────────────────────────────
const NUMS = ['business_years', 'price_min', 'price_max', 'monthly_ad_budget'];
const INTS = ['target_leads_per_month'];
const TEXTS = ['good_lead_definition', 'bad_lead_definition', 'biggest_frustration'];
const ARRAYS = ['markets', 'property_types', 'exit_strategies', 'channels_tried', 'markets_that_worked'];
const VOICE_FIELDS = ['tone', 'phrases_they_use', 'phrases_to_avoid', 'reading_level', 'signs_off_as'];

function profilePayload(body) {
  const row = {};
  for (const f of NUMS) {
    if (body[f] === undefined) continue;
    if (body[f] === null) { row[f] = null; continue; }
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw bad(`${f} must be a positive number`);
    row[f] = n;
  }
  for (const f of INTS) {
    if (body[f] === undefined) continue;
    if (body[f] === null) { row[f] = null; continue; }
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < 0 || n > 1e6) throw bad(`${f} must be a whole number`);
    row[f] = n;
  }
  for (const f of TEXTS) if (body[f] !== undefined) row[f] = body[f] === null ? null : String(body[f]).slice(0, 2000);
  for (const f of ARRAYS) {
    if (body[f] === undefined) continue;
    if (body[f] === null) { row[f] = null; continue; }
    if (!Array.isArray(body[f])) throw bad(`${f} must be a list`);
    if (body[f].length > 50) throw bad(`${f} can hold at most 50 entries`);
    row[f] = body[f].map(v => String(v).slice(0, 120));
  }
  if (body.has_call_team !== undefined) {
    if (body.has_call_team !== null && typeof body.has_call_team !== 'boolean') throw bad('has_call_team must be true or false');
    row.has_call_team = body.has_call_team;
  }
  if (body.voice !== undefined) {
    if (body.voice === null) { row.voice = {}; }
    else {
      if (typeof body.voice !== 'object' || Array.isArray(body.voice)) throw bad('voice must be an object');
      const v = {};
      for (const f of VOICE_FIELDS) {
        if (body.voice[f] === undefined) continue;
        v[f] = Array.isArray(body.voice[f]) ? body.voice[f].slice(0, 30).map(x => String(x).slice(0, 200)) : String(body.voice[f]).slice(0, 500);
      }
      const unknown = Object.keys(body.voice).filter(k => !VOICE_FIELDS.includes(k));
      if (unknown.length) throw bad(`voice accepts only: ${VOICE_FIELDS.join(', ')}`);
      row.voice = v;
      row.voice_source = 'operator';
      row.voice_extracted_at = new Date().toISOString();
    }
  }
  if (!Object.keys(row).length) throw bad('Nothing to update');
  return row;
}

router.get('/profile', wrap(async (req, res) => {
  const { data, error } = await supabase.from('operator_ad_profile').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  res.json({ success: true, data: data || null, completeness: preflight.profileCompleteness(data), voice: preflight.voiceOf(data) });
}));

router.put('/profile', wrap(async (req, res) => {
  const row = profilePayload(req.body || {});
  const { data, error } = await supabase.from('operator_ad_profile')
    .upsert({ user_id: req.user.id, ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*').single();
  if (error) throw error;
  res.json({ success: true, data, completeness: preflight.profileCompleteness(data) });
}));

// ── Pre-flight ──────────────────────────────────────────────────────────────
router.post('/preflight', wrap(async (req, res) => {
  const market = req.body?.market;
  if (!market) throw bad('market is required (a city and state, a ZIP, or a state)');
  const { brief, agent_output } = await preflight.generate(req.user.id, market, { actorUserId: req.user.id });
  res.status(201).json({ success: true, data: brief, agent_output });
}));

router.get('/preflight', wrap(async (req, res) => {
  if (!req.query.market) throw bad('market is required');
  const b = await preflight.live(req.user.id, req.query.market);
  if (!b) return res.status(404).json({ success: false, code: 'PREFLIGHT_REQUIRED', error: `No pre-flight brief exists for ${marketPulse.resolveMarket(req.query.market).label}. Run one before anything else in the ads system.` });
  res.json({ success: true, data: b });
}));

router.get('/preflight/history', wrap(async (req, res) => {
  res.json({ success: true, data: await preflight.history(req.user.id, { market: req.query.market || null, limit: req.query.limit }) });
}));

router.get('/preflight/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Brief not found' });
  const { data, error } = await supabase.from('market_preflight_brief').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, error: 'Brief not found' });
  res.json({ success: true, data });
}));

// ── Creative ────────────────────────────────────────────────────────────────
router.post('/creatives', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.market) throw bad('market is required');
  if (b.angle && !catalog.ANGLE_IDS.includes(b.angle)) throw bad(`angle must be one of: ${catalog.ANGLE_IDS.join(', ')}`);
  if (b.psychological_driver && !catalog.DRIVER_IDS.includes(b.psychological_driver)) throw bad(`psychological_driver must be one of: ${catalog.DRIVER_IDS.join(', ')}`);
  if (b.image_format && !catalog.IMAGE_FORMATS.some(f => f.id === b.image_format)) throw bad('image_format is not one Veori produces a brief for');
  if (b.platform && !['meta', 'google', 'tiktok', 'youtube'].includes(b.platform)) throw bad('platform must be meta, google, tiktok or youtube');

  const out = await creative.generate(req.user.id, {
    market: b.market, angle: b.angle || null, psychological_driver: b.psychological_driver || null,
    image_format: b.image_format || null, platform: b.platform || null,
  }, { actorUserId: req.user.id });
  if (!out.creative) return res.status(409).json({ success: false, code: 'NOTHING_USABLE', error: out.agent_output.summary, agent_output: out.agent_output });
  res.status(201).json({ success: true, data: out.creative, creative_brief: out.creative_brief, agent_output: out.agent_output });
}));

router.get('/creatives', wrap(async (req, res) => {
  let q = supabase.from('ad_creatives').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(Math.min(200, Number(req.query.limit) || 50));
  if (req.query.market) q = q.eq('market', marketPulse.resolveMarket(req.query.market).label);
  if (req.query.status) q = q.eq('status', String(req.query.status).slice(0, 30));
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

router.get('/creatives/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Creative not found' });
  const { data, error } = await supabase.from('ad_creatives').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, error: 'Creative not found' });
  let brief = null;
  if (data.creative_brief_id) {
    const { data: cb } = await supabase.from('creative_briefs').select('*').eq('id', data.creative_brief_id).eq('user_id', req.user.id).maybeSingle();
    brief = cb || null;
  }
  res.json({ success: true, data, creative_brief: brief });
}));

// Matches the check constraint on ad_creatives.status.
const CREATIVE_STATUSES = ['draft', 'active', 'paused', 'fatigued', 'archived'];
router.patch('/creatives/:id', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Creative not found' });
  const b = req.body || {};
  const row = {};
  if (b.status !== undefined) {
    if (!CREATIVE_STATUSES.includes(b.status)) throw bad(`status must be one of: ${CREATIVE_STATUSES.join(', ')}`);
    row.status = b.status;
    // The freshness window is measured from the first time a creative was served.
    if (b.status === 'active') row.first_served_at = new Date().toISOString();
  }
  if (!Object.keys(row).length) throw bad('Nothing to update');
  if (row.first_served_at) {
    const { data: existing } = await supabase.from('ad_creatives').select('first_served_at').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (existing?.first_served_at) delete row.first_served_at;   // never reset the clock
  }
  const { data, error } = await supabase.from('ad_creatives').update(row).eq('id', req.params.id).eq('user_id', req.user.id).select('*');
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ success: false, error: 'Creative not found' });
  res.json({ success: true, data: data[0] });
}));

// ── Results and learning ────────────────────────────────────────────────────
router.post('/results', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.creative_id) {
    if (!UUID_RE.test(String(b.creative_id))) return res.status(404).json({ success: false, error: 'Creative not found' });
    const { data } = await supabase.from('ad_creatives').select('id,angle,psychological_driver,hook_style,image_format,market').eq('id', b.creative_id).eq('user_id', req.user.id).maybeSingle();
    if (!data) return res.status(404).json({ success: false, error: 'Creative not found' });
    b.angle = b.angle || data.angle;
    b.psychological_driver = b.psychological_driver || data.psychological_driver;
    b.hook_style = b.hook_style || data.hook_style;
    b.image_format = b.image_format || data.image_format;
    const live = await preflight.live(req.user.id, data.market).catch(() => null);
    b.market_lead_sample = live?.brief?.market_pulse?.lead_sample || 0;
  }
  if (b.platform && !['meta', 'google', 'tiktok', 'youtube'].includes(b.platform)) throw bad('platform must be meta, google, tiktok or youtube');
  const out = await learning.record(req.user.id, b);
  res.status(201).json({ success: true, data: out, note: 'Recorded into the shared pool without your identity, market or copy. Only the shape of the creative and what it produced.' });
}));

router.get('/learning', wrap(async (req, res) => {
  const [network, model] = await Promise.all([
    learning.networkGuidance({ angles: req.query.angle ? [String(req.query.angle)] : [], platform: req.query.platform || null }),
    learning.operatorModel(req.user.id),
  ]);
  res.json({ success: true, data: { network, your_model: model, blend: learning.blend(model?.data_points || 0) } });
}));

router.post('/learning/rebuild', wrap(async (req, res) => {
  res.json({ success: true, data: await learning.rebuildOperatorModel(req.user.id) });
}));

// ── Compliance on demand ────────────────────────────────────────────────────
router.post('/compliance/check', wrap(async (req, res) => {
  const text = req.body?.text;
  if (!text || typeof text !== 'string') throw bad('text is required');
  if (text.length > 20000) throw bad('text is too long (20,000 characters maximum)');
  res.json({ success: true, data: compliance.check(text, { context: String(req.body.context || 'ad copy').slice(0, 60) }) });
}));

module.exports = router;
