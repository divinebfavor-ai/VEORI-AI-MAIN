/**
 * VEORI Lead Engine — Autonomous Public Records Sourcing
 *
 * Runs every 24 hours. Pulls from all sources simultaneously,
 * scores every record, skip traces, deduplicates, and pushes
 * directly into the Veori pipeline with AI calling triggered.
 *
 * Sources:
 *   tax_delinquent  — county tax assessor databases (2+ years unpaid)
 *   probate         — county courthouse estate filings
 *   lis_pendens     — pre-foreclosure notices
 *   divorce         — divorce filings with real property
 *   code_violation  — code enforcement violations
 *   usda_land       — USDA vacant/rural absentee parcels
 *   blm_land        — BLM adjacent private absentee land
 *   bankruptcy      — PACER federal bankruptcy with property assets
 */

const { v4: uuidv4 }           = require('uuid');
const supabase                  = require('../config/supabase');
const { calculateSourcingScore } = require('./leadEngineScorer');
const { skipTraceLead }          = require('./skipTraceService');
const { pullTaxDelinquent }      = require('./sources/taxDelinquent');
const { pullCourtRecords }       = require('./sources/courtRecords');
const { pullGovLand }            = require('./sources/govLand');
const { pullBankruptcy }         = require('./sources/pacerBankruptcy');

// Target states — all 50, prioritized by market activity
const TARGET_STATES = [
  'FL','TX','GA','NC','SC','TN','AL','MS','LA',  // Southeast
  'OH','MI','IN','IL','MO','KY','WV','PA',        // Midwest
  'AZ','NV','NM','CO','UT',                       // Southwest
  'CA','OR','WA',                                 // West
  'NY','NJ','CT','MA','MD','VA',                  // Northeast
  'AR','OK','KS','IA','MN','WI','ND','SD','NE',  // Central
  'ID','MT','WY','AK','HI','DE','NH','VT','RI','ME', // Rest
];

const COURT_SOURCES = ['probate', 'lis_pendens', 'divorce', 'code_violation'];
const GOV_SOURCES   = ['usda_land', 'blm_land'];

// ─── Deduplication ────────────────────────────────────────────────────────────

async function isExistingLead(userId, address, phone) {
  if (!address && !phone) return false;

  const queries = [];
  if (address) {
    queries.push(
      supabase.from('leads').select('id').eq('user_id', userId)
        .ilike('property_address', `%${address.split(' ').slice(0, 3).join(' ')}%`)
        .limit(1)
    );
  }
  if (phone) {
    queries.push(
      supabase.from('leads').select('id').eq('user_id', userId).eq('phone', phone).limit(1)
    );
  }

  const results = await Promise.all(queries);
  return results.some(r => (r.data || []).length > 0);
}

// ─── Process a single raw record ─────────────────────────────────────────────

async function processRecord(record, userId) {
  try {
    const { score, signals, lead_type } = calculateSourcingScore(record);

    // Only import leads scoring 25+ (filters garbage records)
    if (score < 25) return { status: 'skipped', reason: 'low_score' };

    // Auto skip trace if no phone/email
    let phone = record.phone || '';
    let email = record.email || '';

    if (!phone || !email) {
      try {
        const traced = await skipTraceLead({
          first_name:       record.first_name,
          last_name:        record.last_name,
          property_address: record.property_address,
          property_city:    record.property_city,
          property_state:   record.property_state,
          property_zip:     record.property_zip,
        });
        if (traced?.phones?.[0]?.number) phone = traced.phones[0].number;
        if (traced?.emails?.[0]?.address) email = traced.emails[0].address;
      } catch (_) {}
    }

    // Dedup check
    const exists = await isExistingLead(userId, record.property_address, phone);
    if (exists) return { status: 'skipped', reason: 'duplicate' };

    // Build tags
    const tags = [
      `auto-sourced`,
      `source:${record.source_key}`,
      ...signals.map(s => `signal:${s}`),
      ...(record.county ? [`county:${record.county.toLowerCase()}`] : []),
    ];

    // Insert into leads
    const { data: lead, error } = await supabase.from('leads').insert({
      id:               uuidv4(),
      user_id:          userId,
      first_name:       record.first_name || 'Property',
      last_name:        record.last_name  || 'Owner',
      phone:            phone || null,
      email:            email || null,
      property_address: record.property_address || '',
      property_city:    record.property_city    || '',
      property_state:   record.property_state   || '',
      property_zip:     record.property_zip     || '',
      property_type:    record.property_type    || 'Single Family',
      estimated_value:  record.estimated_value  || null,
      county:           record.county           || null,
      parcel_id:        record.parcel_id        || null,
      years_delinquent: record.years_delinquent || null,
      tax_owed:         record.tax_owed         || null,
      case_number:      record.case_number      || null,
      filing_date:      record.filing_date      || null,
      source:           'lead_engine',
      sourcing_source:  record.source_key,
      sourcing_score:   score,
      distress_signals: signals,
      lead_type,
      auto_sourced:     true,
      sourced_at:       new Date().toISOString(),
      status:           'new',
      motivation_score: score, // sourcing score as initial motivation estimate
      tags,
      notes:            record.notes || `Auto-sourced via Lead Engine — ${signals.join(', ')}`,
    }).select().single();

    if (error) {
      console.error('[LeadEngine] Insert error:', error.message);
      return { status: 'error', reason: error.message };
    }

    // Trigger motivation scoring + AI calling for high-score leads
    if (score >= 60 && phone) {
      try {
        const { enrollLeadInSequence } = require('./sequenceEngine');
        await enrollLeadInSequence(lead.id, userId, 'auto_sourced').catch(() => {});
      } catch (_) {}
    }

    return { status: 'imported', lead_id: lead.id, score };
  } catch (err) {
    console.error('[LeadEngine] processRecord error:', err.message);
    return { status: 'error', reason: err.message };
  }
}

// ─── Run one source for one state ────────────────────────────────────────────

async function runSource(sourceKey, state, userId) {
  const jobId = uuidv4();
  const startedAt = new Date().toISOString();

  // Log job start
  await supabase.from('lead_engine_jobs').insert({
    id: jobId, source_key: sourceKey, state, started_at: startedAt, status: 'running',
  }).catch(() => {});

  console.log(`[LeadEngine] Starting ${sourceKey} | ${state}`);

  let rawRecords = [];
  try {
    if (sourceKey === 'tax_delinquent') {
      rawRecords = await pullTaxDelinquent(state, null);
    } else if (COURT_SOURCES.includes(sourceKey)) {
      rawRecords = await pullCourtRecords(sourceKey, state, null);
    } else if (GOV_SOURCES.includes(sourceKey)) {
      rawRecords = await pullGovLand(sourceKey, state);
    } else if (sourceKey === 'bankruptcy') {
      rawRecords = await pullBankruptcy(state);
    }
  } catch (err) {
    await supabase.from('lead_engine_jobs').update({
      status: 'error', completed_at: new Date().toISOString(), error_message: err.message,
    }).eq('id', jobId).catch(() => {});
    return { imported: 0, skipped: 0, errors: 0 };
  }

  let imported = 0, skipped = 0, errors = 0;

  // Process records concurrently (batches of 5 to avoid rate limits)
  const BATCH = 5;
  for (let i = 0; i < rawRecords.length; i += BATCH) {
    const batch = rawRecords.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(r => processRecord(r, userId)));
    for (const r of results) {
      if (r.status === 'imported') imported++;
      else if (r.status === 'skipped') skipped++;
      else errors++;
    }
  }

  // Update coverage map
  await supabase.from('lead_engine_coverage').upsert({
    state,
    source_key:  sourceKey,
    is_covered:  rawRecords.length > 0,
    last_updated: new Date().toISOString(),
    total_leads:  imported,
  }, { onConflict: 'state,county,source_key' }).catch(() => {});

  // Mark job complete
  await supabase.from('lead_engine_jobs').update({
    status:         errors > 0 && imported === 0 ? 'error' : 'success',
    completed_at:   new Date().toISOString(),
    records_found:  rawRecords.length,
    records_new:    imported,
    records_skipped: skipped,
  }).eq('id', jobId).catch(() => {});

  // Update source stats
  await supabase.from('lead_engine_sources').upsert({
    user_id:         userId,
    source_key:      sourceKey,
    source_label:    SOURCE_LABELS[sourceKey] || sourceKey,
    state,
    last_run_at:     new Date().toISOString(),
    last_run_status: imported > 0 ? 'success' : 'partial',
    last_run_count:  imported,
  }, { onConflict: 'user_id,source_key,state' }).catch(() => {});

  console.log(`[LeadEngine] ${sourceKey}/${state} → ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, errors };
}

const SOURCE_LABELS = {
  tax_delinquent:  'Tax Delinquent',
  probate:         'Probate / Estate',
  lis_pendens:     'Lis Pendens / Pre-Foreclosure',
  divorce:         'Divorce with Property',
  code_violation:  'Code Violations',
  usda_land:       'USDA Rural / Vacant Land',
  blm_land:        'BLM Adjacent Land',
  bankruptcy:      'Bankruptcy (PACER)',
};

// ─── Full engine run ──────────────────────────────────────────────────────────

async function runLeadEngine(userId, options = {}) {
  const {
    states     = TARGET_STATES,
    sources    = Object.keys(SOURCE_LABELS),
    maxPerRun  = 500,   // total leads cap per run to avoid spam
  } = options;

  console.log(`[LeadEngine] Starting full run for user ${userId} — ${sources.length} sources × ${states.length} states`);
  const summary = { total_imported: 0, total_skipped: 0, by_source: {} };

  // Run all sources in parallel per state (staggered to be respectful)
  let totalImported = 0;
  for (const state of states) {
    if (totalImported >= maxPerRun) break;

    const stateResults = await Promise.all(
      sources.map(src => runSource(src, state, userId))
    );

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const res = stateResults[i];
      summary.by_source[src] = (summary.by_source[src] || 0) + res.imported;
      summary.total_imported += res.imported;
      summary.total_skipped  += res.skipped;
      totalImported          += res.imported;
    }

    // Brief pause between states to be a good API citizen
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[LeadEngine] Run complete — ${summary.total_imported} leads imported`);
  return summary;
}

// ─── Scheduler: runs automatically every 24 hours ───────────────────────────

let engineTimer = null;

function startLeadEngineScheduler() {
  if (engineTimer) return; // already running

  console.log('[LeadEngine] Scheduler started — runs every 24h');

  const runForAllUsers = async () => {
    try {
      // Get all users with active subscriptions (they get the engine)
      const { data: users } = await supabase
        .from('users')
        .select('id, subscription_status')
        .in('subscription_status', ['active', 'trialing'])
        .limit(100);

      for (const user of users || []) {
        await runLeadEngine(user.id).catch(err =>
          console.error(`[LeadEngine] Error for user ${user.id}:`, err.message)
        );
        // Stagger user runs by 30 seconds each
        await new Promise(r => setTimeout(r, 30000));
      }
    } catch (err) {
      console.error('[LeadEngine] Scheduler error:', err.message);
    }
  };

  // Run immediately on start, then every 24 hours
  runForAllUsers();
  engineTimer = setInterval(runForAllUsers, 24 * 60 * 60 * 1000);
}

function stopLeadEngineScheduler() {
  if (engineTimer) { clearInterval(engineTimer); engineTimer = null; }
}

module.exports = {
  runLeadEngine,
  runSource,
  startLeadEngineScheduler,
  stopLeadEngineScheduler,
  SOURCE_LABELS,
  TARGET_STATES,
};
